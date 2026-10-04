#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { once } from "node:events";
import { chromium } from "playwright-core";
import { createCollectionsFixture } from "../_lib/site-admin-collections-fixture.mjs";
import { createNextAuthSessionCookie } from "../_lib/site-admin-auth-cookie.mjs";
import { ensureNextBuild, findAvailablePort, startNextServer, waitForHttp } from "../_lib/local-next.mjs";

const origin = "https://staging.jinkunchen.com";
const log = (message) => console.log(`[collections-workflow] ${message}`);
async function eventually(check, label, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { await check(); return; } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label}: ${last?.message || "timeout"}`);
}
async function main() {
  // Synthetic local authentication; no deployment credentials or production session are used.
  Object.assign(process.env, { SITE_ADMIN_STORAGE: "local", SITE_ADMIN_EMAILS: "collections-qa@example.test",
    NEXTAUTH_SECRET: "isolated-collections-workflow-secret", NEXTAUTH_URL: origin,
    CONTENT_SYNC_MODE: "stubs", CLOUDFLARE_API_TOKEN: "", CF_API_TOKEN: "", CLOUDFLARE_ACCOUNT_ID: "", CF_ACCOUNT_ID: "", DEPLOY_HOOK_URL: "" });
  ensureNextBuild();
  const port = await findAvailablePort();
  const localOrigin = `http://127.0.0.1:${port}`;
  const server = startNextServer({ port });
  let browser, qaPage, qaFixture;
  try {
    await waitForHttp(localOrigin);
    const auth = await createNextAuthSessionCookie();
    assert.equal(auth.ok, true, auth.reason);
    const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies(auth.cookie.split("; ").map((part) => {
      const index = part.indexOf("=");
      return { name: part.slice(0, index), value: part.slice(index + 1), url: origin, secure: true };
    }));
    const fixture = createCollectionsFixture();
    qaFixture = fixture;
    // Simulate the staging hostname without ever contacting staging. Only GET assets/document
    // are fetched from the local Next server; every admin API is an in-memory fixture.
    await context.route("**/*", async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) return route.abort("blockedbyclient");
      if (url.pathname.startsWith("/api/site-admin/")) return fixture.handle(route);
      if (req.method() !== "GET") throw new Error(`Unexpected write outside fixture: ${req.url()}`);
      const response = await route.fetch({ url: `${localOrigin}${url.pathname}${url.search}`, headers: { ...req.headers(), cookie: auth.cookie }, maxRedirects: 0 });
      await route.fulfill({ response });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    page.setDefaultNavigationTimeout(20_000);
    qaPage = page;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto(`${origin}/site-admin`);
    const open = async (label) => {
      await page.getByRole("button", { name: new RegExp(`^${label}\\s+\\d+ entr(?:y|ies)$`) }).click();
      await page.getByRole("heading", { name: label, exact: true }).waitFor();
    };
    const panel = () => page.getByRole("region", { name: /^Edit / });
    const entry = (title) => page.locator("[data-entry-trigger]").filter({ hasText: title }).first();
    const saved = async (name, check) => {
      await eventually(() => check(fixture.entries(name)), `${name} saved`);
      await eventually(async () => {
        assert.equal(await page.getByRole("button", { name: "Saving draft", exact: true }).count(), 0);
        assert.equal(await page.getByRole("button", { name: "Save draft", exact: true }).first().isDisabled(), true);
      }, `${name} save reconciled`);
    };

    log("Teaching: canonical term, trailing space, inherited term, autosave");
    await open("Teaching");
    await page.getByRole("button", { name: "Add course", exact: true }).click();
    await panel().getByLabel("Academic year").selectOption("2026/27");
    await panel().getByLabel("Season", { exact: true }).selectOption("Winter");
    await panel().getByLabel("Course code", { exact: true }).fill("CSCI ");
    assert.equal(await panel().getByLabel("Course code", { exact: true }).inputValue(), "CSCI ");
    await panel().getByLabel("Course code", { exact: true }).fill("CSCI2000");
    await panel().getByLabel("Course name", { exact: true }).fill("Winter fixture");
    await saved("teaching", (rows) => assert.ok(rows.some((row) => row.courseCode === "CSCI2000" && row.term === "2026/27 Winter Term")));
    await panel().getByRole("button", { name: "Close entry editor" }).click();
    await page.getByRole("button", { name: "Add entry to 2026/27 Winter Term" }).click();
    assert.equal(await panel().getByLabel("Season", { exact: true }).inputValue(), "Winter");
    await panel().getByLabel("Course code", { exact: true }).fill("CSCI2001");
    await saved("teaching", (rows) => assert.ok(rows.some((row) => row.courseCode === "CSCI2001" && row.term === "2026/27 Winter Term")));

    log("Works: cross-group drag, month range, duplicate/delete/undo");
    await open("Works");
    await entry("Intern").locator("..").getByRole("img", { name: "Drag to reorder" }).dragTo(entry("Analyst"));
    await saved("works", (rows) => assert.equal(rows.find((row) => row.role === "Intern").category, "passed"));
    await entry("Intern").click();
    await panel().locator('[contenteditable="true"][aria-label="Body"]').waitFor();
    await panel().getByLabel("Ongoing", { exact: true }).uncheck();
    await panel().getByLabel("Period end month").fill("2026-02");
    await saved("works", (rows) => assert.equal(rows.find((row) => row.role === "Intern").period.replace(/\u2013/g, "-"), "Nov 2025 - Feb 2026"));
    await panel().getByText("Entry actions", { exact: true }).click();
    await panel().getByRole("button", { name: "Duplicate", exact: true }).click();
    assert.equal(await page.locator("article[data-invalid]").count(), 3);
    await panel().getByRole("button", { name: "Delete", exact: true }).click();
    assert.equal(await page.locator("article[data-invalid]").count(), 2);
    await page.getByRole("button", { name: "Undo collection edit" }).click();
    assert.equal(await page.locator("article[data-invalid]").count(), 3);
    await page.getByRole("button", { name: "Redo collection edit" }).click();
    await saved("works", (rows) => assert.equal(rows.length, 2));

    log("Publications: comma-containing author names and metadata preservation");
    await open("Publications");
    await entry("Fixture paper").click();
    await panel().getByLabel("Add authors", { exact: true }).fill("Doe, Jane");
    await panel().getByLabel("Add authors", { exact: true }).press("Enter");
    await saved("publications", (rows) => {
      assert.deepEqual(rows[0].authors, ["Chen, Jinkun", "Doe, Jane"]);
      assert.equal(rows[0].authorsRich[0].isSelf, true);
      assert.equal(rows[0].authorsRich[0].url, "https://example.test/author");
    });

    log("News: local recovery, validation, save failure and conflict resolution");
    await open("News");
    await page.getByRole("button", { name: "Add update", exact: true }).click();
    const body = () => panel().locator('[contenteditable="true"][aria-label="Body"]');
    await body().fill("");
    assert.equal(await panel().getByRole("button", { name: "Save draft", exact: true }).isDisabled(), true);
    await eventually(async () => {
      const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem("site-admin-content-draft:components:news") || "null"));
      assert.equal(snapshot?.collection.value.items.length, 2);
    }, "incomplete draft recovery written");
    await page.reload();
    await open("News");
    await page.getByRole("button", { name: "Restore local draft", exact: true }).click();
    log("News recovery restored");
    assert.equal(await page.locator("article[data-invalid]").count(), 2);
    await page.locator('article[data-invalid="true"] [data-entry-trigger]').click();
    fixture.failures.set("news", 503);
    await panel().getByLabel("Date", { exact: true }).fill("2026-10-04");
    await body().fill("Recovered news update.");
    await panel().getByRole("button", { name: "Save draft", exact: true }).click();
    await page.getByText("Fixture save unavailable", { exact: true }).waitFor();
    log("News save failure preserved the editor");
    assert.equal(await panel().isVisible(), true);
    assert.equal(fixture.entries("news").length, 1);
    fixture.failures.delete("news");
    await panel().getByRole("button", { name: "Save draft", exact: true }).click();
    await saved("news", (rows) => assert.ok(rows.some((row) => row.body.includes("Recovered news update."))));
    log("News save retry reconciled");
    await body().fill("Conflict-preserved news update.");
    fixture.changeRemotely("news", fixture.saved.get("news").replace("Initial news body.", "Remote news body."));
    await panel().getByRole("button", { name: "Save draft", exact: true }).click();
    await page.getByText("News changed elsewhere", { exact: true }).waitFor();
    log("News optimistic conflict detected");
    assert.equal(fixture.entries("news").some((row) => row.body.includes("Conflict-preserved")), false);
    await page.getByRole("button", { name: "Keep my edits", exact: true }).click();
    await saved("news", (rows) => assert.ok(rows.some((row) => row.body.includes("Conflict-preserved news update."))));
    await eventually(() => assert.equal(fixture.jobs.length, 1), "conflict resolution queues publish");

    log("Publish: failure stays pending; retry succeeds and updates only captured snapshot");
    fixture.completeRelease("failed");
    await page.getByText("Publish failed: Fixture publish failed", { exact: true }).waitFor({ timeout: 15_000 });
    assert.equal(fixture.published.get("news").includes("Conflict-preserved"), false);
    await page.getByRole("button", { name: "Publish updates", exact: true }).first().click();
    await eventually(() => assert.equal(fixture.jobs.length, 2), "retry queues another publish");
    await entry("Conflict-preserved").click();
    await body().fill("Newer draft saved while publishing.");
    await saved("news", (rows) => assert.ok(rows.some((row) => row.body.includes("Newer draft saved while publishing."))));
    fixture.completeRelease();
    await page.getByText("Published successfully. Newer drafts still need publishing.", { exact: true }).waitFor({ timeout: 15_000 });
    assert.notEqual(fixture.published.get("news"), fixture.saved.get("news"));
    assert.ok(fixture.published.get("news").includes("Conflict-preserved"));
    await page.getByRole("button", { name: "Publish updates", exact: true }).first().click();
    await eventually(() => assert.equal(fixture.jobs.length, 3), "newer draft remains publishable");
    fixture.completeRelease();
    await page.getByText("Published successfully. The public site is current.", { exact: true }).waitFor({ timeout: 15_000 });
    assert.equal(fixture.published.get("news"), fixture.saved.get("news"));

    log("Responsive panel: desktop/mobile geometry, focus containment and dismissal");
    if (await entry("Newer draft saved").getAttribute("aria-expanded") !== "true") {
      await entry("Newer draft saved").click();
    }
    await page.screenshot({ path: "/tmp/collections-workflow-desktop.png", animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    const dialog = page.getByRole("dialog", { name: /^Edit / });
    await dialog.waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    const box = await dialog.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 391 && box.y >= 0 && box.y + box.height <= 845, "Mobile panel must fit the viewport");
    await dialog.getByRole("button", { name: "Publish updates", exact: true }).focus();
    await page.keyboard.press("Tab");
    assert.equal(await dialog.evaluate((el) => el.contains(document.activeElement)), true, "Tab must stay inside modal editor");
    await page.screenshot({ path: "/tmp/collections-workflow-mobile.png", animations: "disabled" });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.deepEqual(fixture.unexpected, [], "All admin requests must remain inside the fixture");
    assert.deepEqual(errors, [], "No browser runtime errors");
    log(`PASS: all workflows; ${fixture.writes.length} isolated save attempts, ${fixture.jobs.length} simulated releases; no live mutations`);
  } catch (error) {
    if (qaPage) {
      await qaPage.screenshot({ path: "/tmp/collections-workflow-failure.png", timeout: 3000 }).catch(() => {});
      log(`Failure state: ${(await qaPage.locator("main").innerText({ timeout: 3000 }).catch(() => "unavailable")).slice(-5000)}`);
    }
    if (qaFixture) log(`Fixture requests: ${JSON.stringify({ unexpected: qaFixture.unexpected, writes: qaFixture.writes.map(({ name, version }) => ({ name, version })) })}`);
    throw error;
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
    if (server.exitCode === null && server.signalCode === null) await once(server, "exit");
  }
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
