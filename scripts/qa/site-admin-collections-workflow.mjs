#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { once } from "node:events";
import { chromium } from "playwright-core";
import { PNG } from "pngjs";
import { createCollectionsFixture } from "../_lib/site-admin-collections-fixture.mjs";
import { createNextAuthSessionCookie } from "../_lib/site-admin-auth-cookie.mjs";
import { ensureNextBuild, findAvailablePort, startNextServer, waitForHttp } from "../_lib/local-next.mjs";

let origin = "";
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
  log("Browser plugin not available; using the repository's isolated Playwright workflow");
  // Synthetic local authentication; no deployment credentials or production session are used.
  Object.assign(process.env, { SITE_ADMIN_STORAGE: "local", SITE_ADMIN_EMAILS: "collections-qa@example.test",
    NEXTAUTH_SECRET: "isolated-collections-workflow-secret", NEXTAUTH_URL: origin,
    CONTENT_SYNC_MODE: "stubs", CLOUDFLARE_API_TOKEN: "", CF_API_TOKEN: "", CLOUDFLARE_ACCOUNT_ID: "", CF_ACCOUNT_ID: "", DEPLOY_HOOK_URL: "" });
  ensureNextBuild();
  const port = await findAvailablePort();
  const localOrigin = `http://127.0.0.1:${port}`;
  // Pin the staging hostname to loopback, including sandboxed iframe requests
  // that Chromium may send outside Playwright's OOPIF route interception.
  origin = `http://staging.jinkunchen.com:${port}`;
  process.env.NEXTAUTH_URL = origin;
  const server = startNextServer({ port });
  let browser, qaPage, qaFixture;
  let previewFailure = false;
  const blockedRequests = [];
  const missingResources = [];
  try {
    await waitForHttp(localOrigin);
    const auth = await createNextAuthSessionCookie();
    assert.equal(auth.ok, true, auth.reason);
    const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    browser = await chromium.launch({ headless: true, args: ["--host-resolver-rules=MAP staging.jinkunchen.com 127.0.0.1", "--no-proxy-server"], ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies(auth.cookie.split("; ").filter((part) => !part.startsWith("__Secure-")).map((part) => {
      const index = part.indexOf("=");
      return { name: part.slice(0, index), value: part.slice(index + 1), url: origin, secure: false };
    }));
    const fixture = createCollectionsFixture();
    const qaPosts = [
      { slug: "when-an-ai-agent-says-i-who-are-we-trusting", title: "Long title: When an AI Agent Says I, Who Are We Trusting? A publication title that must never overlap the date column", dateText: "October 4, 2026", dateIso: "2026-10-04", href: "/blog/when-an-ai-agent-says-i-who-are-we-trusting", version: "fixture-post-one" },
      { slug: "when-ai-reasoning-starts-to-drift", title: "Another fixture post", dateText: "October 3, 2026", dateIso: "2026-10-03", href: "/blog/when-ai-reasoning-starts-to-drift", version: "fixture-post-two" },
    ];
    qaFixture = fixture;
    // Simulate the staging hostname without ever contacting staging. Only GET assets/document
    // are fetched from the local Next server; every admin API is an in-memory fixture.
    await context.route("**/*", async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) { blockedRequests.push(req.url()); return route.abort("blockedbyclient"); }
      if (["/api/site-admin/preview/page", "/api/site-admin/preview/mdx"].includes(url.pathname)) {
        if (previewFailure) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Fixture preview unavailable" }) });
        const response = await route.fetch({ url: `${localOrigin}${url.pathname}`, headers: { ...req.headers(), cookie: auth.cookie }, maxRedirects: 0 });
        return route.fulfill({ response });
      }
      if (req.method() === "GET" && url.pathname === "/api/site-admin/posts") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ count: qaPosts.length, posts: qaPosts }) });
      if (req.method() === "GET" && url.pathname.startsWith("/api/site-admin/posts/")) {
        const post = qaPosts.find((item) => item.slug === url.pathname.split("/").at(-1));
        if (post) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...post, source: `---\ntitle: ${post.title}\n---\nFixture post body.`, body: "Fixture post body.", frontmatter: { title: post.title, date: post.dateIso, draft: false }, frontmatterKeys: ["title", "date", "draft"] }) });
      }
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
    const consoleMessages = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) consoleMessages.push(message.text());
    });
    page.on("response", (response) => { if (response.status() === 404) missingResources.push(response.url()); });
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto(`${origin}/site-admin`);
    assert.match(await page.title(), /Site Admin/);
    assert.equal(new URL(page.url()).pathname, "/site-admin");
    await page.getByRole("heading", { name: "Content", exact: true, level: 1 }).waitFor();
    const open = async (label) => {
      await page.getByRole("button", { name: new RegExp(`^${label}\\s+\\d+ entr(?:y|ies)$`) }).click();
      await page.getByRole("heading", { name: label, exact: true }).waitFor();
    };
    const panel = () => page.getByRole("region", { name: /^Edit / });
    const saveButton = () => page.getByRole("button", { name: "Save draft", exact: true }).filter({ visible: true }).first();
    const publish = async () => {
      await page.getByRole("button", { name: "Publish updates", exact: true }).filter({ visible: true }).click();
      const review = page.getByRole("dialog", { name: "Review publication" });
      await review.waitFor();
      assert.match(await review.innerText(), /all saved site content/);
      assert.match(await review.innerText(), /Staging/);
      await page.screenshot({ path: "/tmp/collections-workflow-publish-review.png", animations: "disabled" });
      await review.getByRole("button", { name: "Confirm publish", exact: true }).click();
      await review.waitFor({ state: "detached" });
    };
    const entry = (title) => page.locator("[data-entry-trigger]").filter({ hasText: title }).first();
    const saved = async (name, check) => {
      await eventually(() => check(fixture.entries(name)), `${name} saved`);
      await eventually(async () => {
        assert.equal(await page.getByRole("button", { name: "Saving draft", exact: true }).count(), 0);
        assert.equal(await saveButton().isDisabled(), true);
      }, `${name} save reconciled`);
    };

    log("Documents: long title geometry and returning to the filtered list");
    await page.getByRole("button", { name: /^Posts\s+2 items$/ }).click();
    const postRow = page.locator("li button").filter({ hasText: qaPosts[0].title });
    const titleBox = await postRow.locator("strong").boundingBox();
    const dateBox = await postRow.locator("small").boundingBox();
    assert.ok(titleBox && dateBox && titleBox.x + titleBox.width < dateBox.x, "Long post title must not overlap the date");
    await page.getByRole("textbox", { name: "Search posts and pages", exact: true }).fill("Long title");
    await postRow.click();
    await page.getByRole("heading", { name: qaPosts[0].title, exact: true }).waitFor();
    log("Workspace: deep links, page-shell preview, reload, Back and Forward");
    await eventually(() => assert.equal(new URL(page.url()).searchParams.get("id"), qaPosts[0].slug), "document URL persisted");
    await page.getByRole("tab", { name: "Preview", exact: true }).click();
    await page.getByText("Fixture post body.", { exact: true }).waitFor();
    await page.getByRole("tab", { name: "Source", exact: true }).click();
    previewFailure = true;
    await page.getByRole("tab", { name: "Preview", exact: true }).click();
    await page.getByText("Fixture preview unavailable", { exact: true }).waitFor();
    assert.equal(await page.getByText("Fixture post body.", { exact: true }).isVisible(), true, "Failed refresh keeps the last successful preview");
    previewFailure = false;
    await page.getByRole("button", { name: "Retry preview", exact: true }).click();
    await page.getByText("Fixture preview unavailable", { exact: true }).waitFor({ state: "detached" });
    await page.getByRole("tab", { name: "Source", exact: true }).click();
    await page.getByRole("button", { name: "Page preview", exact: true }).click();
    const pagePreview = page.getByRole("dialog", { name: "Page preview", exact: true });
    await pagePreview.locator("iframe").waitFor();
    assert.equal(await pagePreview.locator("iframe").getAttribute("sandbox"), "allow-same-origin", "Preview never enables scripts, forms or top navigation");
    await pagePreview.getByRole("status").filter({ hasText: /^(Draft in|Approximate rendering)/ }).waitFor();
    await pagePreview.frameLocator("iframe").getByRole("heading", { name: qaPosts[0].title, exact: true }).waitFor();
    await eventually(async () => assert.equal(await pagePreview.frameLocator("iframe").locator("body").evaluate(() => {
      const sheets = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
      return sheets.length > 0 && sheets.every((link) => Boolean(link.sheet));
    }), true), "Page-preview styles loaded before capture");
    await pagePreview.frameLocator("iframe").getByText("Fixture post body.", { exact: true }).waitFor();
    assert.equal(await pagePreview.frameLocator("iframe").getByRole("heading", { name: qaPosts[0].title, exact: true }).evaluate((heading) => getComputedStyle(heading).fontSize), "40px", "Preview uses public-page typography");
    const desktopFrame = await pagePreview.locator("iframe").boundingBox();
    assert.ok(desktopFrame.width >= 1000, "Desktop preview uses a desktop-width shell");
    const paintedPreview = PNG.sync.read(await pagePreview.locator("iframe").screenshot());
    let darkPixels = 0;
    for (let i = 0; i < paintedPreview.data.length; i += 4) {
      if (paintedPreview.data[i] < 140 && paintedPreview.data[i + 1] < 140 && paintedPreview.data[i + 2] < 140) darkPixels += 1;
    }
    assert.ok(darkPixels > 500, "Public-shell preview actually paints text, not a blank iframe");
    await page.screenshot({ path: "/tmp/collections-workflow-page-preview-desktop.png", animations: "disabled" });
    await pagePreview.getByRole("button", { name: "Mobile", exact: true }).click();
    const mobileFrame = await pagePreview.locator("iframe").boundingBox();
    assert.ok(mobileFrame.width <= 391, "Mobile preview uses a phone-width shell");
    await page.screenshot({ path: "/tmp/collections-workflow-page-preview-mobile.png", animations: "disabled" });
    await pagePreview.getByRole("button", { name: "Close dialog", exact: true }).click();
    await page.reload();
    await page.getByRole("heading", { name: qaPosts[0].title, exact: true }).waitFor();
    await eventually(async () => assert.equal(await page.getByRole("tab", { name: "Source", exact: true }).getAttribute("aria-selected"), "true"), "editor mode restores after reload");
    await page.goBack();
    await page.getByRole("textbox", { name: "Search posts and pages", exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "Search posts and pages", exact: true }).inputValue(), "Long title");
    await page.goForward();
    await page.getByRole("heading", { name: qaPosts[0].title, exact: true }).waitFor();
    log("Workspace: canceling Back keeps the unsaved document and its URL");
    page.removeAllListeners("dialog");
    page.on("dialog", (dialog) => void dialog.dismiss());
    await page.getByLabel("Title", { exact: true }).fill("Unsaved title");
    await page.goBack();
    await eventually(() => assert.equal(new URL(page.url()).searchParams.get("id"), qaPosts[0].slug), "canceled Back returns to the document URL");
    assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Unsaved title");
    await page.getByLabel("Title", { exact: true }).fill(qaPosts[0].title);
    page.removeAllListeners("dialog");
    page.on("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Back to posts", exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "Search posts and pages", exact: true }).inputValue(), "Long title");
    await page.screenshot({ path: "/tmp/collections-workflow-posts.png", animations: "disabled" });

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

    log("Teaching: term management, safe defaults, continuous creation and navigation context");
    await panel().getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Manage 2026/27 Winter Term" }).click();
    let group = page.getByRole("dialog", { name: "Edit term", exact: true });
    await group.getByLabel("Season", { exact: true }).selectOption("Summer");
    await group.getByLabel("Role", { exact: true }).fill("Assistant ");
    assert.equal(await group.getByLabel("Role", { exact: true }).inputValue(), "Assistant ");
    await group.getByLabel("Start month").fill("2027-05");
    await group.getByLabel("End month").fill("2027-08");
    await group.getByRole("button", { name: "Apply to group", exact: true }).click();
    await saved("teaching", (rows) => {
      assert.equal(rows.filter((row) => row.term === "2026/27 Summer Term").length, 2);
      assert.equal(rows.find((row) => row.courseCode === "CSCI1000").role, "Instructor");
    });
    await page.getByRole("button", { name: "Add entry to 2026/27 Summer Term" }).click();
    assert.equal(await panel().getByLabel("Role", { exact: true }).inputValue(), "Assistant ");
    assert.equal(await panel().getByLabel("Period start month").inputValue(), "2027-05");
    await panel().getByLabel("Course code", { exact: true }).fill("CSCI2002");
    await saved("teaching", (rows) => assert.ok(rows.some((row) => row.courseCode === "CSCI2002")));
    await page.getByRole("button", { name: "Back to collections", exact: true }).click();
    await page.getByRole("heading", { name: "Collections", exact: true }).waitFor();
    await open("Teaching");
    assert.equal(await panel().getByLabel("Course code", { exact: true }).inputValue(), "CSCI2002");
    await panel().getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "New term", exact: true }).click();
    group = page.getByRole("dialog", { name: "New term", exact: true });
    await group.getByLabel("Academic year").selectOption("2027/28");
    await group.getByLabel("Season", { exact: true }).selectOption("Fall");
    await group.getByLabel("Role", { exact: true }).fill("Instructor");
    await group.getByRole("button", { name: "Create term and add course", exact: true }).click();
    assert.equal(await panel().getByLabel("Academic year").inputValue(), "2027/28");
    await panel().getByLabel("Course code", { exact: true }).fill("CSCI3000");
    await saved("teaching", (rows) => assert.ok(rows.some((row) => row.term === "2027/28 Fall Term")));
    await page.getByLabel("Search courses", { exact: true }).fill("CSCI3000");
    await page.getByRole("button", { name: "Back to collections", exact: true }).click();
    await open("Teaching");
    assert.equal(await page.getByLabel("Search courses", { exact: true }).inputValue(), "CSCI3000");
    assert.equal(await panel().getByLabel("Course code", { exact: true }).inputValue(), "CSCI3000");
    await page.getByLabel("Search courses", { exact: true }).fill("");
    await page.setViewportSize({ width: 1280, height: 720 });
    await eventually(async () => {
      const bounds = await panel().boundingBox();
      assert.ok(bounds && bounds.y + bounds.height <= 721, "Desktop panel footer must stay in the viewport");
      assert.ok(bounds.width >= 480, "Editing panel must retain useful width");
    }, "short desktop panel fits");
    await page.screenshot({ path: "/tmp/collections-workflow-short-desktop.png", animations: "disabled" });
    await page.setViewportSize({ width: 1440, height: 1000 });

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
    await entry("Intern").click();
    await panel().getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Manage Past", exact: true }).click();
    await page.getByRole("dialog", { name: "Move work group" }).getByRole("button", { name: "Apply to group", exact: true }).click();
    await saved("works", (rows) => assert.ok(rows.every((row) => row.category === "recent")));
    await page.getByRole("button", { name: "Undo collection edit" }).click();
    await saved("works", (rows) => assert.ok(rows.every((row) => row.category === "passed")));

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
    await panel().getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Manage 2026", exact: true }).click();
    await page.getByRole("dialog", { name: "Edit publication year" }).getByLabel("Year", { exact: true }).fill("2027");
    await page.getByRole("dialog", { name: "Edit publication year" }).getByRole("button", { name: "Apply to group" }).click();
    await saved("publications", (rows) => {
      assert.equal(rows[0].year, "2027");
      assert.equal(rows[0].authorsRich[0].url, "https://example.test/author");
    });

    log("News: local recovery, validation, save failure and conflict resolution");
    await open("News");
    await page.getByRole("button", { name: "Add update", exact: true }).click();
    const body = () => panel().locator('[contenteditable="true"][aria-label="Body"]');
    await body().fill("");
    assert.equal(await saveButton().isDisabled(), true);
    await eventually(async () => {
      const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem("site-admin-content-draft:components:news") || "null"));
      assert.equal(snapshot?.collection.value.items.length, 2);
    }, "incomplete draft recovery written");
    await page.reload();
    await open("News");
    await page.getByRole("button", { name: "Restore local draft", exact: true }).click();
    log("News recovery restored");
    assert.equal(await page.locator("article[data-invalid]").count(), 2);
    const recoveredEntry = page.locator('article[data-invalid="true"] [data-entry-trigger]');
    if (await recoveredEntry.getAttribute("aria-expanded") !== "true") await recoveredEntry.click();
    fixture.failures.set("news", 503);
    await panel().getByLabel("Date", { exact: true }).fill("2026-10-04");
    await body().fill("Recovered news update.");
    await saveButton().click();
    await page.getByText("Fixture save unavailable", { exact: true }).waitFor();
    log("News save failure preserved the editor");
    assert.equal(await panel().isVisible(), true);
    assert.equal(fixture.entries("news").length, 1);
    fixture.failures.delete("news");
    await saveButton().click();
    await saved("news", (rows) => assert.ok(rows.some((row) => row.body.includes("Recovered news update."))));
    log("News save retry reconciled");
    await body().fill("Conflict-preserved news update.");
    fixture.changeRemotely("news", fixture.saved.get("news").replace("Initial news body.", "Remote news body."));
    await saveButton().click();
    await page.getByText("News changed elsewhere", { exact: true }).waitFor();
    log("News optimistic conflict detected");
    assert.equal(fixture.entries("news").some((row) => row.body.includes("Conflict-preserved")), false);
    await page.getByRole("button", { name: "Keep my edits", exact: true }).click();
    await saved("news", (rows) => assert.ok(rows.some((row) => row.body.includes("Conflict-preserved news update."))));
    assert.equal(fixture.jobs.length, 0, "Conflict resolution only saves a draft");
    await page.getByRole("button", { name: "Publish updates", exact: true }).click();
    await page.getByRole("dialog", { name: "Review publication" }).getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(fixture.jobs.length, 0, "Canceling publication does not queue a release");
    log("Publication review: another session's saved changes are included");
    const remoteOriginal = fixture.saved.get("works");
    fixture.changeRemotely("works", remoteOriginal.replace("Recent body.", "Other session's work update."));
    await page.getByRole("button", { name: "Publish updates", exact: true }).click();
    const siteReview = page.getByRole("dialog", { name: "Review publication" });
    await siteReview.locator("summary").filter({ hasText: "Works" }).waitFor();
    await siteReview.locator("summary").filter({ hasText: "Works" }).click();
    assert.match(await siteReview.innerText(), /Other session's work update/);
    fixture.changeRemotely("works", remoteOriginal.replace("Recent body.", "Changed after confirmation preview."));
    await siteReview.getByRole("button", { name: "Confirm publish", exact: true }).click();
    await siteReview.getByRole("alert").filter({ hasText: "Saved content changed after this review" }).waitFor();
    assert.equal(fixture.jobs.length, 0, "A stale review cannot queue publication");
    assert.equal(await siteReview.getByRole("button", { name: "Confirm publish", exact: true }).isDisabled(), true);
    await siteReview.getByRole("button", { name: "Refresh review", exact: true }).click();
    await eventually(async () => assert.equal(await siteReview.getByRole("button", { name: "Confirm publish", exact: true }).isDisabled(), false), "refresh makes the latest review confirmable");
    await siteReview.getByRole("button", { name: "Cancel", exact: true }).click();
    fixture.changeRemotely("works", remoteOriginal);
    await publish();
    await eventually(() => assert.equal(fixture.jobs.length, 1), "confirmed publication queues publish");

    log("Publish: failure stays pending; retry succeeds and updates only captured snapshot");
    fixture.completeRelease("failed");
    await page.getByText("Publish failed: Fixture publish failed", { exact: true }).waitFor({ timeout: 15_000 });
    assert.equal(fixture.published.get("news").includes("Conflict-preserved"), false);
    await publish();
    await eventually(() => assert.equal(fixture.jobs.length, 2), "retry queues another publish");
    if (await entry("Conflict-preserved").getAttribute("aria-expanded") !== "true") await entry("Conflict-preserved").click();
    await body().click();
    await body().fill("Newer draft saved while publishing.");
    await saved("news", (rows) => assert.ok(rows.some((row) => row.body.includes("Newer draft saved while publishing."))));
    fixture.completeRelease();
    await page.getByText("Published successfully. Newer drafts still need publishing.", { exact: true }).waitFor({ timeout: 15_000 });
    assert.notEqual(fixture.published.get("news"), fixture.saved.get("news"));
    assert.ok(fixture.published.get("news").includes("Conflict-preserved"));
    await publish();
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
    const focusSelector = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    await dialog.locator(focusSelector).filter({ visible: true }).last().focus();
    await page.keyboard.press("Tab");
    assert.equal(await dialog.evaluate((el) => el.contains(document.activeElement)), true, "Tab must stay inside modal editor");
    await page.screenshot({ path: "/tmp/collections-workflow-mobile.png", animations: "disabled" });
    await dialog.locator('[contenteditable="true"][aria-label="Body"]').click();
    await dialog.locator('[contenteditable="true"][aria-label="Body"]').fill("Mobile verified draft.");
    await saved("news", (rows) => assert.ok(rows.some((row) => row.body.includes("Mobile verified draft."))));
    await dialog.getByRole("button", { name: "Publish updates", exact: true }).click();
    const mobileReview = page.getByRole("dialog", { name: "Review publication", exact: true });
    const reviewBox = await mobileReview.boundingBox();
    assert.ok(reviewBox && reviewBox.x >= 0 && reviewBox.x + reviewBox.width <= 391 && reviewBox.y >= 0 && reviewBox.y + reviewBox.height <= 845, "Mobile publication dialog fits the viewport");
    await mobileReview.getByRole("button", { name: "Confirm publish", exact: true }).focus();
    await page.keyboard.press("Tab");
    assert.equal(await mobileReview.evaluate((el) => el.contains(document.activeElement)), true);
    await page.keyboard.press("Escape");
    await mobileReview.waitFor({ state: "detached" });
    assert.equal(await dialog.isVisible(), true, "Canceling a review must keep the mobile entry open");
    assert.equal(await dialog.evaluate((el) => el.contains(document.activeElement)), true, "Canceling publication restores focus to the entry editor");
    assert.equal(fixture.jobs.length, 3, "Dismissing mobile review cannot publish");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.deepEqual(fixture.unexpected, [], "All admin requests must remain inside the fixture");
    assert.deepEqual(errors, [], "No browser runtime errors");
    log(`Network diagnostics: ${JSON.stringify({ blockedRequests, missingResources })}`);
    assert.deepEqual(missingResources, [], "No local assets or public-page prefetches may be missing");
    const unexpectedConsole = consoleMessages.filter((message) => !/^Failed to load resource: the server responded with a status of (409|503)\b/.test(message) && !message.startsWith("Failed to load resource: net::ERR_BLOCKED_BY_CLIENT"));
    assert.deepEqual(unexpectedConsole, [], "Only deliberately injected save/conflict HTTP errors may appear in the console");
    log(`Console: only injected save/conflict HTTP errors and ${blockedRequests.length} isolated external-resource blocks; no app warnings or errors`);
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
