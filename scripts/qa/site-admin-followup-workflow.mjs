#!/usr/bin/env node
import assert from "node:assert/strict";
import { once } from "node:events";
import matter from "gray-matter";
import { createCollectionsFixture } from "../_lib/site-admin-collections-fixture.mjs";
import { createNextAuthSessionCookie } from "../_lib/site-admin-auth-cookie.mjs";
import { ensureNextBuild, findAvailablePort, startNextServer, waitForHttp } from "../_lib/local-next.mjs";
import { launchBrowser } from "../_lib/playwright.mjs";
import { publicationSnapshot, publicationReview } from "../../lib/shared/publication-snapshot.mjs";
import { contentInventory } from "../../lib/shared/content-inventory.ts";
import { publicationValidation } from "../../lib/shared/publication-validation.ts";
import { describePublicationChange } from "../../lib/shared/publication-review-details.ts";

const log = (message) => console.log(`[followup-workflow] ${message}`);
async function eventually(check, label, timeout = 15_000) {
  const until = Date.now() + timeout; let last;
  while (Date.now() < until) { try { await check(); return; } catch (error) { last = error; } await new Promise((resolve) => setTimeout(resolve, 80)); }
  throw new Error(`${label}: ${last?.message || "timeout"}`);
}
async function main() {
  log("Browser plugin not available; using isolated local Playwright");
  Object.assign(process.env, { SITE_ADMIN_STORAGE: "local", CONTENT_SYNC_MODE: "stubs", NEXTAUTH_SECRET: "followup-local-test-secret", SITE_ADMIN_EMAILS: "followup-qa@example.test", CLOUDFLARE_API_TOKEN: "", CF_API_TOKEN: "", CLOUDFLARE_ACCOUNT_ID: "", DEPLOY_HOOK_URL: "" });
  ensureNextBuild();
  const port = await findAvailablePort(), local = `http://127.0.0.1:${port}`, origin = `http://staging.jinkunchen.com:${port}`;
  process.env.NEXTAUTH_URL = origin;
  const server = startNextServer({ port }); let browser, page;
  try {
    await waitForHttp(local);
    const auth = await createNextAuthSessionCookie(); assert.equal(auth.ok, true);
    browser = await launchBrowser({ args: ["--host-resolver-rules=MAP staging.jinkunchen.com 127.0.0.1", "--no-proxy-server"] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies(auth.cookie.split("; ").filter((part) => !part.startsWith("__Secure-")).map((part) => ({ name: part.slice(0, part.indexOf("=")), value: part.slice(part.indexOf("=") + 1), url: origin, secure: false })));
    const fixture = createCollectionsFixture();
    const docs = new Map(Object.entries({
      "posts/pending.mdx": "---\ntitle: Pending post\ndate: 2000-01-01\n---\nChanged post body.",
      "posts/old.mdx": "---\ntitle: Older saved post\ndate: 2026-10-24\n---\nOld saved body.",
      "pages/docs.mdx": "---\ntitle: Documentation\n---\nDocumentation index.",
      "pages/docs/start.mdx": "---\ntitle: Getting started\n---\nUseful guide.",
      "pages/docs/empty.mdx": "---\ntitle: Empty guide\ndraft: true\n---\n",
      "pages/docs/broken.mdx": "---\ntitle: [broken\n---\nDamaged source.",
    }));
    const modified = Object.fromEntries([...docs.keys()].map((path) => [path, path === "posts/old.mdx" ? Date.parse("2000-01-01") : Date.now()]));
    const versions = new Map([...docs.keys()].map((path) => [path, 1]));
    let notice = { id: "qa-notice", title: "Draft notice", status: "draft", scope: "all-public", routes: [], layout: "columns", initialState: "route-aware", collapsible: true, compactMdx: "Short notice", bodyMdx: "## English notice\n\nHello from the draft.\n\n---\n\n## 中文公告\n\n这是一条草稿。", startsAt: "", endsAt: "", updatedAt: "" };
    let noticeVersion = 1, previewFailure = false;
    const writes = [], previews = [], blocked = [], errors = [], consoleWarnings = [];
    const sources = () => ({ ...Object.fromEntries(docs), ...Object.fromEntries([...fixture.saved].map(([name, source]) => [`components/${name}.mdx`, source])), "filesystem/announcements.json": JSON.stringify({ version: 1, items: [notice] }) });
    const baseline = publicationSnapshot({ ...sources(), "posts/pending.mdx": docs.get("posts/pending.mdx").replace("Changed", "Original") });
    function detail(path) {
      const { data, content } = matter(docs.get(path), {}), slug = path.replace(/^(posts|pages)\//, "").replace(/\.mdx$/, "");
      return { slug, title: data.title, href: path.startsWith("posts/") ? `/blog/${slug}` : `/pages/${slug}`, draft: data.draft === true, dateIso: data.date instanceof Date ? data.date.toISOString().slice(0, 10) : String(data.date || ""), version: String(versions.get(path)), source: docs.get(path), body: content.trim(), frontmatter: { ...data, date: data.date instanceof Date ? data.date.toISOString().slice(0, 10) : data.date }, frontmatterKeys: Object.keys(data) };
    }
    await context.route("**/*", async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) { blocked.push(req.url()); return route.abort("blockedbyclient"); }
      const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
      if (["/api/site-admin/preview/page", "/api/site-admin/preview/mdx"].includes(url.pathname)) {
        previews.push(req.postDataJSON());
        if (previewFailure) return json({ error: "Isolated preview failure" }, 503);
        const response = await route.fetch({ url: `${local}${url.pathname}`, headers: { ...req.headers(), cookie: auth.cookie }, maxRedirects: 0 });
        return route.fulfill({ response });
      }
      if (url.pathname === "/api/site-admin/publication-review") {
        const current = publicationSnapshot(sources()), review = publicationReview(current, baseline);
        return json({ ...review, validation: publicationValidation(current.sources), inventory: contentInventory(current.sources, modified), changes: review.changes.map((change) => ({ ...change, details: describePublicationChange(change, current, baseline) })) });
      }
      if (url.pathname === "/api/site-admin/announcements") {
        if (req.method() === "POST") { const body = req.postDataJSON(); writes.push(body); assert.equal(body.action, "upsert"); notice = body.announcement; noticeVersion++; }
        return json({ ok: true, data: { data: { version: 1, items: [notice] }, sourceVersion: { fileSha: `notice-${noticeVersion}` } } });
      }
      if (["/api/site-admin/posts", "/api/site-admin/pages"].includes(url.pathname)) {
        const kind = url.pathname.endsWith("posts") ? "posts" : "pages", items = [];
        for (const path of docs.keys()) if (path.startsWith(`${kind}/`)) { try { items.push(detail(path)); } catch { /* Invalid sources remain in inventory. */ } }
        return json({ count: items.length, [kind]: items });
      }
      const match = /^\/api\/site-admin\/(posts|pages)\/(.+)$/.exec(url.pathname);
      if (match && match[2] !== "tree") {
        const path = `${match[1]}/${decodeURIComponent(match[2])}.mdx`;
        if (docs.has(path)) {
          if (req.method() === "PATCH") { const body = req.postDataJSON(); assert.equal(body.version, String(versions.get(path))); writes.push({ path, ...body }); docs.set(path, body.source); versions.set(path, versions.get(path) + 1); modified[path] = Date.now(); return json({ version: String(versions.get(path)) }); }
          if (url.searchParams.get("raw") === "1") return json({ title: match[2], slug: match[2], version: String(versions.get(path)), source: docs.get(path), raw: true });
          return json(detail(path));
        }
      }
      if (url.pathname.startsWith("/api/site-admin/")) return fixture.handle(route);
      assert.equal(req.method(), "GET", "Only previews may reach the local server as POST");
      const response = await route.fetch({ url: `${local}${url.pathname}${url.search}`, headers: { ...req.headers(), cookie: auth.cookie }, maxRedirects: 0 });
      return route.fulfill({ response });
    });
    log("Shared public presenters: post metadata/outline, page breadcrumbs and unsaved collection context");
    const renderPreview = async (input) => {
      const response = await fetch(`${local}/api/site-admin/preview/page`, { method: "POST", headers: { cookie: auth.cookie, "content-type": "application/json" }, body: JSON.stringify(input) });
      const payload = await response.json();
      assert.equal(response.status, 200, JSON.stringify(payload));
      return payload.data ?? payload;
    };
    const longBody = ["## First section", "word ".repeat(250), "## Second section", "word ".repeat(250), "## Third section", "word ".repeat(250)].join("\n\n");
    const postPreview = await renderPreview({ title: "Ignored title", source: "Ignored body", document: { kind: "posts", slug: "qa-draft", source: `---\ntitle: Unsaved preview title\ndate: 2026-10-25\n---\n${longBody}` } });
    assert.equal(postPreview.context.renderer, "posts");
    assert.equal(postPreview.approximate, false, "Ordinary Markdown must use the real renderer");
    assert.ok(postPreview.html.includes("October 25, 2026"));
    assert.ok(postPreview.html.includes('aria-label="Article contents"'));
    assert.ok(postPreview.html.includes('id="first-section"'));
    const pagePreview = await renderPreview({ title: "Ignored", source: "", document: { kind: "pages", slug: "docs/qa", source: '---\ntitle: Preview child\nupdated: 2026-10-24\n---\nA real page body.' } });
    assert.equal(pagePreview.approximate, false);
    assert.ok(pagePreview.html.includes("October 24, 2026")); assert.ok(pagePreview.html.includes("notion-breadcrumb"));
    const worksPreview = await renderPreview({ title: "Works", routePath: "/works", component: "works", source: '<WorksEntry role="Unsaved preview role" affiliation="QA Labs" period="Jan 2026 - Now">Preview body.</WorksEntry>' });
    assert.equal(worksPreview.approximate, false);
    assert.ok(worksPreview.html.includes("Unsaved preview role"));
    assert.ok(worksPreview.html.includes("For all of my teaching works"));
    const unsafePreview = await renderPreview({ title: "Unsupported", source: '{globalThis.process.exit(93)}', routePath: "/preview" });
    assert.equal(unsafePreview.approximate, true, "Executable expressions are never evaluated");
    page = await context.newPage(); page.setDefaultTimeout(12_000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (["warning", "error"].includes(message.type())) consoleWarnings.push(message.text()); });
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto(`${origin}/site-admin`);
    assert.match(await page.title(), /Site Admin/);
    await page.getByRole("heading", { name: "Content", level: 1, exact: true }).waitFor();
    const task = () => page.getByRole("combobox", { name: "Content task filter", exact: true });
    log("Task lists: pending, hidden, issues, modified time and retained page hierarchy");
    await task().selectOption("pending");
    await page.getByRole("button", { name: /Pending post.*Pending publication/ }).waitFor();
    assert.equal(await page.getByRole("button", { name: /Older saved post/ }).count(), 0);
    await task().selectOption("recent");
    assert.equal(await page.getByRole("button", { name: /Older saved post/ }).count(), 0, "A recent publication date is not a recent save");
    await task().selectOption("all");
    await page.getByRole("button", { name: "Pin Pending post", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "Unpin Pending post", exact: true }).waitFor();
    await task().selectOption("pinned");
    await page.getByRole("button", { name: /^Pending post.*Live current|^Pending post.*Pending publication/ }).click();
    await page.getByRole("button", { name: "Back to posts", exact: true }).click();
    assert.equal(await task().inputValue(), "pinned");
    await page.getByRole("button", { name: /^Pages\s+\d+ items$/ }).click();
    await task().selectOption("hidden");
    await page.getByRole("button", { name: "Empty guide", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Getting started", exact: true }).count(), 0);
    await task().selectOption("issues");
    await page.screenshot({ path: "/tmp/followup-content-tasks-desktop.png" });
    await page.getByRole("button", { name: "Empty guide", exact: true }).click();
    await page.getByRole("button", { name: "Add body content.", exact: true }).click();
    await eventually(async () => assert.equal(await page.locator('.ProseMirror, .cm-content').filter({ visible: true }).first().evaluate((el) => el.contains(document.activeElement)), true), "Issue focuses body editor");
    await page.getByRole("button", { name: "Back to pages", exact: true }).click();
    await page.getByRole("button", { name: "docs/broken", exact: true }).click();
    const raw = page.locator(".cm-content");
    await raw.fill("---\ntitle: Repaired page\n---\nRepaired content.");
    await page.waitForTimeout(1800);
    assert.equal(writes.some((write) => write.path === "pages/docs/broken.mdx"), false, "Source repairs wait for explicit save");
    await page.getByRole("button", { name: "Save draft", exact: true }).first().click();
    await page.getByRole("textbox", { name: "Title", exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "Title", exact: true }).inputValue(), "Repaired page");
    log("Preview: real local renderer, published context, themes, mobile width, failure retention and return position");
    await page.getByRole("button", { name: "Page preview", exact: true }).scrollIntoViewIfNeeded();
    const position = await page.evaluate(() => window.scrollY);
    await page.getByRole("button", { name: "Page preview", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "Page preview", exact: true });
    await preview.getByRole("status").filter({ hasText: /^(Draft in|Approximate rendering)/ }).waitFor();
    await preview.getByRole("combobox", { name: "Preview theme" }).selectOption("dark");
    await preview.getByRole("button", { name: "Mobile", exact: true }).click();
    await eventually(async () => assert.equal(await preview.locator("iframe").contentFrame().locator("html").getAttribute("data-theme"), "dark"), "Dark preview");
    const box = await preview.locator("iframe").boundingBox(); assert.ok(box.width <= 391);
    await page.screenshot({ path: "/tmp/followup-page-preview-desktop.png" });
    await page.keyboard.press("Escape");
    await eventually(async () => assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - position) < 3), "Preview returns to editor position");
    assert.equal(await page.getByRole("textbox", { name: "Title", exact: true }).inputValue(), "Repaired page");
    await page.getByRole("button", { name: /^Posts\s+\d+ items$/ }).click();
    await task().selectOption("all");
    await page.getByRole("button", { name: /Pending post.*Pending publication/ }).click();
    const titleInput = page.getByRole("textbox", { name: "Title", exact: true });
    await titleInput.fill("");
    await eventually(async () => assert.equal(matter(docs.get("posts/pending.mdx"), {}).data.title, ""), "Blank title is saved as an incomplete draft");
    await page.getByRole("button", { name: "Publish updates", exact: true }).first().click();
    const reviewDialog = page.getByRole("dialog", { name: "Review publication", exact: true });
    await reviewDialog.getByRole("heading", { name: "Needs attention before publishing" }).waitFor();
    assert.equal(await reviewDialog.getByRole("button", { name: "Confirm publish", exact: true }).isDisabled(), true);
    await page.screenshot({ path: "/tmp/four-items-publication-validation-desktop.png" });
    await reviewDialog.getByRole("button", { name: /posts\/pending\.mdx · title: Add a title/ }).click();
    await eventually(async () => assert.equal(await titleInput.evaluate((el) => el === document.activeElement), true), "Publication issue returns to the exact field");
    await page.getByRole("button", { name: "Add a title.", exact: true }).click();
    await eventually(async () => assert.equal(await titleInput.evaluate((el) => el === document.activeElement), true), "Issue focuses the title field");
    await titleInput.fill("Pending post");
    await page.getByRole("button", { name: "Inspector", exact: true }).click();
    const date = page.locator('[data-document-field="date"]');
    await date.fill("");
    await eventually(async () => assert.equal(matter(docs.get("posts/pending.mdx"), {}).data.date, ""), "Blank date survives autosave");
    await page.locator("[data-inspector-close]").click();
    await page.getByRole("button", { name: "Choose a valid publication date.", exact: true }).click();
    await eventually(async () => assert.equal(await date.evaluate((el) => el === document.activeElement), true), "Issue focuses metadata inside Inspector");
    await date.fill("2000-01-01");
    await eventually(async () => {
      const savedDate = matter(docs.get("posts/pending.mdx"), {}).data.date;
      assert.equal(savedDate instanceof Date ? savedDate.toISOString().slice(0, 10) : savedDate, "2000-01-01");
    }, "Valid date is saved before navigating away");
    await page.locator("[data-inspector-close]").click();
    await page.getByRole("button", { name: "Back to posts", exact: true }).click();
    await page.getByRole("button", { name: /Announcements/ }).first().click();
    await page.getByRole("button", { name: "Page preview", exact: true }).click();
    await preview.getByRole("status").filter({ hasText: /^(Draft in|Approximate rendering)/ }).waitFor();
    await preview.getByRole("combobox", { name: "Announcement display" }).selectOption("expanded");
    await eventually(async () => assert.equal(await preview.locator("iframe").contentFrame().locator('.site-announcement__layout[data-columns="true"]').count(), 1), "Bilingual draft announcement uses two columns");
    await preview.locator("iframe").contentFrame().getByText("Hello from the draft.", { exact: true }).waitFor();
    previewFailure = true;
    await preview.getByRole("combobox", { name: "Announcement display" }).selectOption("compact");
    await preview.getByRole("alert").waitFor(); assert.equal(await preview.locator("iframe").count(), 1);
    previewFailure = false;
    await preview.getByRole("button", { name: "Retry", exact: true }).click();
    await preview.getByRole("status").filter({ hasText: /^(Draft in|Approximate rendering)/ }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.locator("nextjs-portal").count(), 0, "No framework error overlay");
    await page.screenshot({ path: "/tmp/followup-page-preview-mobile.png" });
    await page.keyboard.press("Escape");
    await page.getByRole("combobox", { name: "Browse content", exact: true }).selectOption("pin:posts:pending");
    await page.getByRole("textbox", { name: "Title", exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "Title", exact: true }).inputValue(), "Pending post", "Pinned content remains reachable on mobile");
    await page.getByRole("button", { name: "Page preview", exact: true }).click();
    await preview.getByRole("status").filter({ hasText: /^Draft in/ }).waitFor();
    await preview.getByRole("checkbox", { name: "Include announcement" }).uncheck();
    await preview.getByRole("status").filter({ hasText: /^Draft in/ }).waitFor();
    await preview.locator("iframe").contentFrame().getByRole("heading", { name: "Pending post", exact: true }).waitFor();
    await preview.locator("iframe").contentFrame().locator('[aria-label="Post metadata"]').scrollIntoViewIfNeeded();
    await preview.locator("iframe").contentFrame().getByText("January 1, 2000", { exact: true }).waitFor();
    await page.screenshot({ path: "/tmp/four-items-page-preview-mobile.png" });
    await page.keyboard.press("Escape");
    log("Public article: accessible outline, active section, deep link, focus and mobile geometry");
    await page.goto(`${origin}/blog/when-an-ai-agent-says-i-who-are-we-trusting`);
    const outline = page.locator("details.mdx-post__outline");
    const summaryHeight = (await outline.locator("summary").boundingBox()).height;
    await outline.locator("summary").click();
    const links = page.getByRole("navigation", { name: "Article contents" }).getByRole("link");
    assert.ok(await links.count() >= 3);
    const target = decodeURIComponent((await links.last().getAttribute("href")).slice(1));
    await links.last().click();
    await eventually(async () => assert.equal(await page.evaluate(() => document.activeElement?.id), target), "Outline focuses the heading");
    assert.equal(await outline.getAttribute("open"), null);
    await eventually(async () => assert.equal(await outline.locator('a[aria-current="true"]').getAttribute("href"), `#${encodeURIComponent(target)}`), "Current section follows scroll");
    assert.equal((await outline.locator("summary").boundingBox()).height, summaryHeight, "Long section titles do not resize the sticky outline");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await outline.locator("summary").click();
    await page.waitForTimeout(500);
    await eventually(async () => assert.equal(await outline.locator('a[aria-current="true"]').getAttribute("href"), `#${encodeURIComponent(target)}`), "Opening the outline does not move the article or change the current section");
    await page.screenshot({ path: "/tmp/followup-article-outline-mobile.png" });
    assert.deepEqual(errors, []);
    assert.deepEqual(fixture.unexpected, []);
    assert.equal(fixture.jobs.length, 0, "These flows never publish");
    const unexpectedConsole = consoleWarnings.filter((message) => !message.startsWith("Failed to load resource: net::ERR_BLOCKED_BY_CLIENT") && !/^Failed to load resource: the server responded with a status of 503/.test(message));
    assert.deepEqual(unexpectedConsole, []);
    log(`PASS: ${writes.length} isolated draft writes, ${previews.length} read-only previews, no live changes; ${blocked.length} external resources intentionally blocked`);
    await context.close();
  } catch (error) {
    if (page) console.error(await page.evaluate(() => ({ scrollY, height: innerHeight, documentHeight: document.documentElement.scrollHeight, nav: document.getElementById("site-nav")?.getBoundingClientRect().toJSON(), headings: [...document.querySelectorAll(".mdx-post__body h2, .mdx-post__body h3")].map((el) => ({ id: el.id, top: el.getBoundingClientRect().top })), active: document.querySelector('.mdx-post__outline a[aria-current="true"]')?.getAttribute("href") })).catch(() => null));
    if (page) { await page.screenshot({ path: "/tmp/followup-workflow-failure.png" }).catch(() => {}); console.error((await page.locator("body").innerText().catch(() => "")).slice(-6500)); }
    throw error;
  } finally {
    await browser?.close(); server.kill("SIGTERM");
    if (server.exitCode === null && server.signalCode === null) await once(server, "exit");
  }
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
