import assert from "node:assert/strict";
import { ensureNextBuild, findAvailablePort, startNextServer, waitForHttp } from "../_lib/local-next.mjs";
import { launchBrowser } from "../_lib/playwright.mjs";

async function main() {
  Object.assign(process.env, { SITE_ADMIN_STORAGE: "local", CONTENT_SYNC_MODE: "stubs", NEXTAUTH_SECRET: "public-acceptance-fixture", CLOUDFLARE_API_TOKEN: "", CLOUDFLARE_ACCOUNT_ID: "" });
  ensureNextBuild();
  const port = await findAvailablePort(), origin = `http://127.0.0.1:${port}`;
  const server = startNextServer({ port });
  let browser, page, searchFailure = false;
  const errors = [], warnings = [];
  try {
    await waitForHttp(origin);
    browser = await launchBrowser();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route("**/*", async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) return route.abort("blockedbyclient");
      assert.equal(request.method(), "GET", "Public acceptance never writes data");
      if (url.pathname === "/api/search" && searchFailure) return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Isolated search failure"}' });
      return route.continue();
    });
    page = await context.newPage(); page.setDefaultTimeout(12_000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") warnings.push(message.text()); });
    await page.goto(`${origin}/blog`);
    assert.match(await page.title(), /Blog/);
    await page.getByRole("navigation", { name: "Main", exact: true }).getByRole("link", { name: "Blog", exact: true }).waitFor();
    await page.locator("#more-trigger").click();
    await page.locator("#more-menu").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.locator("#more-menu").waitFor({ state: "hidden" });
    await page.goto(origin);
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.locator("#search-trigger").click();
      await page.locator("#notion-search.open").waitFor();
      const input = page.locator("#notion-search-input");
      await input.fill("义门陈");
      await page.locator('.notion-search__result-item[href="/chen"]').waitFor();
      await input.fill("Ｔｅａｃｈｉｎｇ");
      await page.locator('.notion-search__result-item[href="/teaching"]').waitFor();
      await input.fill("qa-no-result-291837");
      await page.getByText("No results", { exact: true }).waitFor();
      searchFailure = true;
      await input.fill("Works");
      await page.getByRole("button", { name: "Retry", exact: true }).waitFor();
      searchFailure = false;
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await page.locator('.notion-search__result-item[href="/works"]').waitFor();
      assert.equal(await page.locator(".notion-search__result-item").first().getAttribute("href"), "/works", "Exact navigation matches lead the displayed groups");
      await page.locator("#notion-search.open").waitFor();
      const group = page.locator(".notion-search__group").first();
      await group.click();
      await page.locator("#notion-search.open").waitFor();
      await page.locator(".notion-search__group").first().click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `/tmp/public-acceptance-search-${viewport.width}.png` });
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#search-trigger").evaluate((el) => el === document.activeElement), true);
    }
    const missing = await page.goto(`${origin}/qa-page-that-does-not-exist-291837`);
    assert.equal(missing.status(), 404);
    await page.getByRole("heading", { name: /not found/i }).waitFor();
    await page.getByRole("link", { name: "Back home", exact: true }).click();
    await page.waitForURL(`${origin}/`);
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings.filter((message) => !/ERR_BLOCKED_BY_CLIENT|status of (503|404)/.test(message)), []);
    console.log("[public-acceptance] PASS: desktop/mobile bilingual search, full-width query, no results, real retry, More dismissal, 404 recovery, zero writes");
  } catch (error) {
    console.error({ errors, warnings });
    console.error(server.getLogs());
    if (page) { await page.screenshot({ path: "/tmp/public-acceptance-failure.png" }).catch(() => {}); console.error((await page.locator("body").innerText().catch(() => "")).slice(-1200)); }
    throw error;
  } finally {
    await browser?.close(); await server.stop();
  }
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
