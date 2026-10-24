#!/usr/bin/env node
import assert from "node:assert/strict";
import { once } from "node:events";
import { createCollectionsFixture } from "../_lib/site-admin-collections-fixture.mjs";
import { createNextAuthSessionCookie } from "../_lib/site-admin-auth-cookie.mjs";
import { ensureNextBuild, findAvailablePort, startNextServer, waitForHttp } from "../_lib/local-next.mjs";
import { launchBrowser } from "../_lib/playwright.mjs";
import { publicationSnapshot, publicationReview } from "../../lib/shared/publication-snapshot.mjs";
import { describePublicationChange } from "../../lib/shared/publication-review-details.ts";
import { saveCurrentNowData } from "../../lib/site-admin/now-commands.ts";

async function eventually(check, label, timeout = 15_000) {
  const until = Date.now() + timeout;
  let error;
  while (Date.now() < until) {
    try { await check(); return; } catch (next) { error = next; }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`${label}: ${error?.message || "timeout"}`);
}

async function main() {
  console.log("[priority-workflow] Browser plugin not available; using isolated local Playwright");
  Object.assign(process.env, { SITE_ADMIN_STORAGE: "local", CONTENT_SYNC_MODE: "stubs",
    NEXTAUTH_SECRET: "priority-workflow-test-secret", SITE_ADMIN_EMAILS: "priority-qa@example.test",
    CLOUDFLARE_API_TOKEN: "", CF_API_TOKEN: "", CLOUDFLARE_ACCOUNT_ID: "", CF_ACCOUNT_ID: "", DEPLOY_HOOK_URL: "" });
  ensureNextBuild();
  const port = await findAvailablePort();
  const local = `http://127.0.0.1:${port}`;
  const origin = `http://staging.jinkunchen.com:${port}`;
  process.env.NEXTAUTH_URL = origin;
  const server = startNextServer({ port });
  let browser, qaPage;
  try {
    await waitForHttp(local);
    const auth = await createNextAuthSessionCookie();
    assert.equal(auth.ok, true);
    browser = await launchBrowser({ args: ["--host-resolver-rules=MAP staging.jinkunchen.com 127.0.0.1", "--no-proxy-server"] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies(auth.cookie.split("; ").filter((part) => !part.startsWith("__Secure-")).map((part) => ({
      name: part.slice(0, part.indexOf("=")), value: part.slice(part.indexOf("=") + 1), url: origin, secure: false,
    })));
    const fixture = createCollectionsFixture();
    const state = {
      home: { schemaVersion: 4, title: "Original home", bodyMdx: "Original biography." },
      now: { schemaVersion: 1, current: { text: "Original status", updatedAt: "2026-10-24T12:00:00Z" }, updates: [] },
      announcements: { version: 1, items: [{ id: "notice-one", title: "Original notice", status: "draft", scope: "home", routes: [], layout: "prose", initialState: "collapsed", collapsible: true, compactMdx: "Summary", bodyMdx: "Notice body", startsAt: "", endsAt: "", updatedAt: "2026-10-24T12:00:00Z" }] },
    };
    const versions = { home: 1, now: 1, announcements: 1 };
    const failures = {};
    const writes = [];
    let homeDelay = 0;
    const paths = { home: "home.json", now: "now.json", announcements: "filesystem/announcements.json" };
    const sources = () => ({ ...Object.fromEntries([...fixture.saved].map(([name, body]) => [`components/${name}.mdx`, body])), ...Object.fromEntries(Object.entries(paths).map(([name, path]) => [path, JSON.stringify(state[name])])) });
    const baseline = publicationSnapshot(sources());
    await context.route("**/*", async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) return route.abort("blockedbyclient");
      const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
      const name = Object.keys(paths).find((key) => url.pathname === `/api/site-admin/${key}`);
      if (name) {
        const payload = () => ({ data: state[name], sourceVersion: { fileSha: `${name}-${versions[name]}` } });
        if (req.method() === "GET") return json(name === "announcements" ? { ok: true, data: payload() } : payload());
        const body = req.postDataJSON();
        writes.push({ name, body });
        if (failures[name]) return json({ error: "Isolated save failure" }, failures[name]);
        if (body.expectedFileSha !== payload().sourceVersion.fileSha) return json({ error: "A newer server draft exists" }, 409);
        if (name === "home") {
          await new Promise((resolve) => setTimeout(resolve, homeDelay));
          state.home = { ...body.data, title: body.data.title.trim() };
        } else if (name === "now") {
          assert.equal(body.action, "save-current");
          state.now = saveCurrentNowData({ data: state.now, text: body.text, context: { hasValue: true, value: body.context }, location: { hasValue: true, value: body.location }, date: body.date });
        } else if (body.action === "upsert") {
          state.announcements.items = [...state.announcements.items.filter((item) => item.id !== body.announcement.id), body.announcement];
        } else throw new Error("Unexpected announcement write");
        versions[name]++;
        return json(name === "home" ? { sourceVersion: payload().sourceVersion } : name === "announcements" ? { ok: true, data: payload() } : payload());
      }
      if (url.pathname === "/api/site-admin/publication-review") {
        const current = publicationSnapshot(sources());
        const review = publicationReview(current, baseline);
        return json({ ...review, changes: review.changes.map((change) => ({ ...change,
          title: ({ "home.json": "Home", "now.json": "Now", "filesystem/announcements.json": "Announcements" })[change.path] || change.title,
          details: describePublicationChange(change, current, baseline),
        })) });
      }
      if (url.pathname.startsWith("/api/site-admin/")) return fixture.handle(route);
      if (req.method() !== "GET") throw new Error(`Unexpected write: ${url.pathname}`);
      const response = await route.fetch({ url: `${local}${url.pathname}${url.search}`, headers: { ...req.headers(), cookie: auth.cookie }, maxRedirects: 0 });
      return route.fulfill({ response });
    });
    const page = await context.newPage();
    qaPage = page;
    page.setDefaultTimeout(12_000);
    const errors = [];
    page.on("pageerror", (error) => { errors.push(error.message); console.error(error.stack || error.message); });
    page.on("dialog", (dialog) => void dialog.accept());
    const open = async (area) => { await page.goto(`${origin}/site-admin?area=${area}`); await page.getByRole("heading", { level: 1 }).waitFor(); };
    const title = () => page.getByRole("textbox", { name: "Title", exact: true });

    console.log("[priority-workflow] Home: autosave, slow response, recovery and conflict");
    await open("home");
    await title().fill("Edited home ");
    await eventually(() => assert.equal(state.home.title, "Edited home"), "Home autosave");
    assert.equal(await title().inputValue(), "Edited home ", "Autosave never trims the live input");
    homeDelay = 900;
    await title().fill("Captured save");
    await eventually(() => assert.ok(writes.some((write) => write.body.data?.title === "Captured save")), "Slow request starts");
    await title().fill("Newer typing ");
    await eventually(() => assert.equal(state.home.title, "Newer typing"), "Newer input survives an older response");
    assert.equal(await title().inputValue(), "Newer typing ");
    homeDelay = 0; failures.home = 500;
    await title().fill("Offline recovery");
    await page.getByRole("button", { name: "Retry save", exact: true }).waitFor();
    const failedCount = writes.length;
    await page.waitForTimeout(2300);
    assert.equal(writes.length, failedCount, "Failed saves do not spin indefinitely");
    versions.home++; state.home.title = "Newer remote draft during offline editing";
    await page.reload();
    await page.getByRole("button", { name: "Restore local edits", exact: true }).waitFor();
    failures.home = 0;
    await page.getByRole("button", { name: "Restore local edits", exact: true }).click();
    await page.getByText("Review recovered edits before saving", { exact: true }).waitFor();
    await page.waitForTimeout(1900);
    assert.equal(state.home.title, "Newer remote draft during offline editing", "Old recovery copies never autosave over newer drafts");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await eventually(() => assert.equal(state.home.title, "Offline recovery"), "Recovery restores and saves");
    versions.home++; state.home.title = "Other client change";
    await title().fill("Reviewed local version");
    const conflict = page.getByRole("dialog", { name: /Home changed elsewhere/ });
    await conflict.waitFor();
    assert.equal(state.home.title, "Other client change", "Conflict never overwrites the newer server version automatically");
    await conflict.getByRole("button", { name: "Keep my edits", exact: true }).click();
    await eventually(() => assert.equal(state.home.title, "Reviewed local version"), "Explicit conflict decision");
    await conflict.waitFor({ state: "hidden" });
    await page.screenshot({ path: "/tmp/priority-home-desktop.png" });

    console.log("[priority-workflow] Now: stable history and raw input");
    await open("now");
    await page.getByRole("textbox", { name: "Status", exact: true }).fill("Current status one ");
    await eventually(() => assert.equal(state.now.current.text, "Current status one"), "Now autosave");
    const historyCount = state.now.updates.length;
    await page.getByRole("textbox", { name: "Status", exact: true }).fill("Current status two ");
    await eventually(() => assert.equal(state.now.current.text, "Current status two"), "Now edits");
    assert.equal(state.now.updates.length, historyCount, "Now history contains no autosave spam");
    assert.equal(await page.getByRole("textbox", { name: "Status", exact: true }).inputValue(), "Current status two ");

    console.log("[priority-workflow] Announcements: autosave and new draft recovery");
    await open("announcements");
    await title().fill("Edited notice ");
    await eventually(() => assert.equal(state.announcements.items[0].title, "Edited notice"), "Announcement autosave");
    assert.equal(await title().inputValue(), "Edited notice ");
    failures.announcements = 500;
    await page.getByRole("button", { name: "New", exact: true }).click();
    await title().fill("Recovered new announcement");
    await page.getByRole("button", { name: "Retry save", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("button", { name: "Restore local edits", exact: true }).waitFor();
    failures.announcements = 0;
    await page.getByRole("button", { name: "Restore local edits", exact: true }).click();
    await eventually(() => assert.ok(state.announcements.items.some((item) => item.title === "Recovered new announcement")), "New unsaved announcement survives reload");
    await eventually(async () => assert.equal(await page.getByRole("button", { name: "Save draft", exact: true }).isDisabled(), true), "All content saved");
    await page.getByRole("button", { name: "Review publication", exact: true }).click();
    const review = page.getByRole("dialog", { name: "Review publication", exact: true });
    await review.getByText("Advanced source comparison", { exact: true }).first().waitFor();
    await eventually(async () => {
      assert.ok((await review.innerText()).includes("Affects:"));
      assert.equal(await review.getByRole("button", { name: "Confirm publish", exact: true }).isEnabled(), true);
    }, "Publication review finished loading");
    assert.equal(await review.locator("pre:visible").count(), 0, "Code is hidden by default");
    await page.screenshot({ path: "/tmp/priority-publication-review-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "/tmp/priority-publication-review-mobile.png" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Mobile layout has no horizontal overflow");
    assert.equal(fixture.jobs.length, 0, "No save or review publishes automatically");
    assert.deepEqual(errors, []);

    const search = await fetch(`${local}/api/search?q=Vlado`);
    assert.equal(search.status, 200);
    assert.match(search.headers.get("x-publication-snapshot"), /^[a-f0-9]{64}$/);
    assert.ok((await search.json()).items.some((item) => item.routePath === "/"), "Published homepage is searchable");
    const article = await fetch(`${local}/blog/when-an-ai-agent-says-i-who-are-we-trusting`).then((response) => response.text());
    assert.doesNotMatch(article, /class="notion-heading__anchor-link" aria-hidden="true"/);
    console.log("[priority-workflow] PASS: draft autosave, in-flight typing, whitespace, failure pause, local recovery, conflicts, Now history, new-announcement recovery, human publication review, mobile layout, published search and heading accessibility");
    await context.close();
  } catch (error) {
    if (qaPage) {
      await qaPage.screenshot({ path: "/tmp/priority-workflow-failure.png", fullPage: true }).catch(() => {});
      console.error((await qaPage.locator("body").innerText().catch(() => "")).slice(0, 6500));
    }
    throw error;
  } finally {
    await browser?.close(); server.kill("SIGTERM");
    if (server.exitCode === null && server.signalCode === null) await once(server, "exit");
  }
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
