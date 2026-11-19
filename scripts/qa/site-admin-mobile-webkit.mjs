#!/usr/bin/env node
import assert from "node:assert/strict";
import { devices, webkit } from "playwright-core";
import { createCollectionsFixture } from "../_lib/site-admin-collections-fixture.mjs";
import { createNextAuthSessionCookie } from "../_lib/site-admin-auth-cookie.mjs";
import { ensureNextBuild, findAvailablePort, sleep, startNextServer, waitForHttp } from "../_lib/local-next.mjs";

async function eventually(verify, description) {
  const deadline = Date.now() + 12_000;
  let lastError;
  while (Date.now() < deadline) {
    try { await verify(); return; } catch (error) { lastError = error; }
    await sleep(100);
  }
  throw new Error(`${description}: ${lastError?.message || "timeout"}`);
}

async function main() {
  const port = await findAvailablePort();
  const local = `http://127.0.0.1:${port}`;
  const origin = `http://staging.jinkunchen.com:${port}`;
  Object.assign(process.env, {
    SITE_ADMIN_STORAGE: "local", SITE_ADMIN_EMAILS: "mobile-webkit-qa@example.test",
    NEXTAUTH_SECRET: "isolated-mobile-webkit-secret", NEXTAUTH_URL: origin, CONTENT_SYNC_MODE: "stubs",
    CLOUDFLARE_API_TOKEN: "", CF_API_TOKEN: "", CLOUDFLARE_ACCOUNT_ID: "", CF_ACCOUNT_ID: "", DEPLOY_HOOK_URL: "",
  });
  ensureNextBuild();
  const server = startNextServer({ port });
  let browser, page;
  try {
    await waitForHttp(local);
    const auth = await createNextAuthSessionCookie();
    assert.equal(auth.ok, true, auth.reason);
    browser = await webkit.launch();
    const context = await browser.newContext({ ...devices["iPhone 13"], reducedMotion: "reduce" });
    const fixture = createCollectionsFixture({ includePost: true });
    const browserErrors = [];
    await context.route("**/*", async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) return route.abort("blockedbyclient");
      if (url.pathname.startsWith("/api/site-admin/")) return fixture.handle(route);
      if (request.method() !== "GET") {
        browserErrors.push(`Unexpected ${request.method()} outside the local fixture`);
        return route.abort("blockedbyclient");
      }
      const response = await route.fetch({ url: `${local}${url.pathname}${url.search}`, headers: { ...request.headers(), cookie: auth.cookie }, maxRedirects: 0 });
      return route.fulfill({ response });
    });
    page = await context.newPage();
    page.setDefaultTimeout(12_000);
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto(`${origin}/site-admin`);
    assert.match(await page.title(), /Site Admin/);
    await page.locator('main[data-workspace-ready="true"]').waitFor();
    await page.getByRole("heading", { name: "Content", level: 1, exact: true }).waitFor();
    const button = (name) => page.getByRole("button", { name, exact: typeof name === "string" });
    const editor = () => page.getByRole("dialog", { name: /^Edit / });
    const browse = () => page.locator("label").filter({ has: page.getByText("Browse content", { exact: true }) }).locator("select");
    const collection = async (name) => {
      await browse().selectOption(`component:${name.toLowerCase()}`);
      await page.getByRole("heading", { name, exact: true }).waitFor();
    };

    console.log("[mobile-webkit] Teaching: create a term and keep input accessible in a reduced viewport");
    await collection("Teaching");
    await button("New term").tap();
    const term = page.getByRole("dialog", { name: "New term", exact: true });
    await term.getByLabel("Academic year").selectOption("2026/27");
    await term.getByLabel("Season", { exact: true }).selectOption("Winter");
    await term.getByLabel("Role", { exact: true }).fill("Instructor");
    await term.getByRole("button", { name: "Create term and add course", exact: true }).tap();
    const course = editor().getByLabel("Course code", { exact: true });
    const baseViewport = page.viewportSize();
    assert.ok(baseViewport);
    await course.focus();
    await page.setViewportSize({ width: baseViewport.width, height: 470 });
    await course.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await eventually(async () => {
      const result = await course.evaluate((field) => {
        const { x, y, width, height } = field.getBoundingClientRect();
        const point = document.elementFromPoint(x + width / 2, y + height / 2);
        return { inside: y >= 0 && y + height <= innerHeight + 1, unobscured: point === field,
          pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      assert.deepEqual(result, { inside: true, unobscured: true, pageOverflow: false });
    }, "course field remains interactive under reduced viewport");
    await course.fill("CSCI ");
    assert.equal(await course.inputValue(), "CSCI ");
    await course.fill("CSCI2000");
    await editor().getByLabel("Course name", { exact: true }).fill("Mobile winter course");
    await eventually(() => assert.ok(fixture.entries("teaching").some((item) => item.term === "2026/27 Winter Term" && item.courseCode === "CSCI2000")), "Teaching draft saved");
    await page.screenshot({ path: "/tmp/site-admin-webkit-teaching.png", animations: "disabled" });
    await page.setViewportSize(baseViewport);
    await editor().getByRole("button", { name: "Close entry editor", exact: true }).tap();
    await button("Back to collections").tap();

    console.log("[mobile-webkit] Blog: canceled Back and reload recovery retain unsaved text");
    const path = "posts/mobile-fixture.mdx";
    const originalPost = fixture.published.get(path);
    fixture.failures.set(path, 503);
    await browse().selectOption("posts");
    await button(/^Mobile fixture post/).tap();
    const title = page.getByLabel("Title", { exact: true });
    const changedTitle = "Mobile recovered title";
    // On WebKit, fill can reset a just-opened controlled input before React records it.
    await title.tap();
    await title.selectText();
    await title.pressSequentially(changedTitle);
    const saveDraft = button("Save draft").filter({ visible: true }).first();
    await eventually(async () => {
      assert.equal(await title.inputValue(), changedTitle);
      assert.ok(await saveDraft.isEnabled());
    }, "the edited title is registered as unsaved before Back");
    await page.evaluate(() => history.back());
    const confirm = page.getByRole("dialog", { name: "Unsaved changes", exact: true });
    await confirm.getByRole("button", { name: "Stay here", exact: true }).tap();
    await eventually(async () => {
      assert.equal(new URL(page.url()).searchParams.get("id"), "mobile-fixture");
      assert.equal(await title.inputValue(), changedTitle);
    }, "canceled Back retains the document and typed title");
    await eventually(async () => assert.ok(await page.evaluate((text) => Object.keys(localStorage).some((key) => key.includes("posts:mobile-fixture") && (localStorage.getItem(key) || "").includes(text)), changedTitle)), "local draft survives reload");
    await page.reload();
    await button("Restore local draft").tap();
    assert.equal(await title.inputValue(), changedTitle);
    fixture.failures.delete(path);
    await saveDraft.tap();
    await eventually(() => assert.match(fixture.saved.get(path), /Mobile recovered title/), "restored post is saved without a publish");
    await button("Publish updates").tap();
    const postReview = page.getByRole("dialog", { name: "Review publication" });
    assert.equal(await postReview.getByLabel("Changes to publish", { exact: true }).inputValue(), `document:${path}`);
    await postReview.getByRole("link", { name: "/blog/mobile-fixture", exact: true }).waitFor();
    await postReview.getByRole("button", { name: "Cancel", exact: true }).tap();
    assert.equal(fixture.jobs.length, 0);
    await button("Back to posts").tap();

    console.log("[mobile-webkit] News: composition, scoped publication, wait then verify");
    await collection("News");
    await button("Add update").tap();
    const body = editor().locator('[contenteditable="true"][aria-label="Body"]');
    const news = "\u7f51\u7ad9\u65b0\u95fb Mobile WebKit update";
    await body.focus();
    await body.dispatchEvent("compositionstart");
    await page.keyboard.insertText(news);
    await body.dispatchEvent("compositionend", { data: news });
    await eventually(() => assert.ok(fixture.entries("news").some((item) => item.body.includes(news))), "composed News draft is saved");
    const entry = fixture.entries("news").find((item) => item.body.includes(news));
    fixture.setRunnerOnline(false);
    await editor().getByRole("button", { name: "Publish updates", exact: true }).tap();
    const review = page.getByRole("dialog", { name: "Review publication" });
    assert.equal(await review.getByLabel("Changes to publish", { exact: true }).inputValue(), `news:${entry.id}`);
    await review.getByRole("heading", { name: "Selected changes", exact: true }).waitFor();
    await review.getByRole("button", { name: "Publish selection", exact: true }).tap();
    await review.waitFor({ state: "detached" });
    await editor().getByRole("button", { name: "Close entry editor", exact: true }).tap();
    const receipt = page.getByRole("region", { name: "Publication status" });
    await receipt.getByText("Wait for the runner to reconnect. Do not submit again.", { exact: true }).waitFor();
    assert.equal(await receipt.getByRole("button", { name: "Review and retry" }).count(), 0);
    assert.equal(fixture.jobs.length, 1);
    fixture.setRunnerOnline(true);
    fixture.completeRelease();
    await receipt.getByText(/^Published snapshot [a-f0-9]{8}$/).waitFor({ timeout: 15_000 });
    await page.getByText("Live verified. 2 saved changes still unpublished.", { exact: true }).waitFor({ timeout: 15_000 });
    assert.equal(await page.getByText(/runner did not wake|wait for the runner to reconnect/i).count(), 0);
    assert.ok(fixture.published.get("news").includes(news));
    assert.equal(fixture.published.get(path), originalPost);
    assert.notEqual(fixture.published.get("teaching"), fixture.saved.get("teaching"));
    assert.deepEqual(fixture.unexpected, []);
    assert.deepEqual(browserErrors, []);
    await page.screenshot({ path: "/tmp/site-admin-webkit-publication.png", animations: "disabled" });
    console.log("[mobile-webkit] PASS: teaching, draft recovery, composition, scoped release and viewport checks");
  } catch (error) {
    await page?.screenshot({ path: "/tmp/site-admin-webkit-failure.png", animations: "disabled" }).catch(() => {});
    if (page) console.error((await page.locator("body").innerText().catch(() => "")).slice(-1800));
    throw error;
  } finally {
    await browser?.close();
    await server.stop();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
