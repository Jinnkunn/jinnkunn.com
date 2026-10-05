#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { once } from "node:events";
import { chromium } from "playwright-core";
import { PNG } from "pngjs";
import { ensureNextBuild, findAvailablePort, startNextServer, waitForHttp } from "../_lib/local-next.mjs";

async function main() {
  console.log("[public-ux] Browser plugin not available; using local Playwright");
  Object.assign(process.env, {
    SITE_ADMIN_STORAGE: "local", CONTENT_SYNC_MODE: "stubs",
    CLOUDFLARE_API_TOKEN: "", CF_API_TOKEN: "", DEPLOY_HOOK_URL: "",
  });
  ensureNextBuild();
  const port = await findAvailablePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = startNextServer({ port });
  let browser;
  try {
    await waitForHttp(origin);
    const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
    for (const [name, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 390, height: 844 }]]) {
      const context = await browser.newContext({ viewport });
      const errors = [];
      const missing = [];
      await context.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === origin || (request.resourceType() === "image" && url.origin === "https://cdn.jinkunchen.com")) return route.continue();
        // Resource-link click targets are isolated: no external paper is fetched.
        if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Isolated resource target</title>" });
        return route.abort("blockedbyclient");
      });
      const page = await context.newPage();
      page.setDefaultTimeout(12_000);
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("response", (response) => { if (response.status() >= 400) missing.push(`${response.status()} ${response.url()}`); });
      const screenshot = async (routeName) => {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${routeName} must not overflow on ${name}`);
        await page.screenshot({ path: `/tmp/public-ux-${routeName}-${name}.png`, animations: "disabled" });
      };

      await page.goto(origin);
      await page.getByRole("heading", { name: "Jinkun Chen", exact: true, level: 1 }).waitFor();
      const intro = page.locator(".home-layout--variant-classicIntro");
      await intro.getByRole("link", { name: "BIO", exact: true }).waitFor();
      assert.equal(await intro.getByRole("link", { name: "Contact", exact: true }).getAttribute("href"), "/connect");
      await page.waitForFunction(() => {
        const image = document.querySelector('.home-layout--variant-classicIntro img');
        return image?.complete && image.naturalWidth > 0;
      });
      const collapse = page.getByRole("button", { name: "Collapse announcement", exact: true });
      if (await collapse.count()) { await collapse.click(); await collapse.waitFor({ state: "hidden" }); }
      await intro.scrollIntoViewIfNeeded();
      const portrait = intro.locator("img").first();
      await portrait.evaluate((image) => image.decode());
      assert.ok((await portrait.boundingBox()).width <= 221, "Portrait stays compact on desktop and mobile");
      const bitmap = PNG.sync.read(await portrait.screenshot());
      let darkPixels = 0;
      for (let i = 0; i < bitmap.data.length; i += 4) {
        if (bitmap.data[i] < 140 && bitmap.data[i + 1] < 140 && bitmap.data[i + 2] < 140) darkPixels += 1;
      }
      assert.ok(darkPixels > 500, `Portrait is visibly painted on ${name}`);
      await screenshot("home");

      await page.locator("#search-trigger").click();
      const search = page.getByRole("dialog", { name: "Search", exact: true });
      await search.getByRole("tab", { name: "Collections", exact: true }).waitFor();
      await search.getByRole("navigation", { name: "Explore pages", exact: true }).waitFor();
      await search.locator("#notion-search-input").fill("no-match-ux-fixture-748239");
      await search.getByText("No results", { exact: true }).waitFor();
      assert.equal(await search.getByRole("link", { name: "Publications", exact: true }).getAttribute("href"), "/publications");
      await screenshot("search");
      await page.keyboard.press("Escape");

      await page.goto(`${origin}/blog`);
      await page.locator(".blog-index-description").first().waitFor();
      await screenshot("blog");
      await page.goto(`${origin}/publications`);
      const resources = page.getByRole("group", { name: "Publication resources", exact: true }).first();
      await resources.waitFor();
      const toggle = resources.locator("xpath=ancestor::div[contains(@class, 'notion-toggle')][1]");
      const before = await toggle.getAttribute("class");
      const popupPromise = context.waitForEvent("page");
      await resources.getByRole("link").first().click();
      const popup = await popupPromise;
      await popup.waitForLoadState();
      assert.equal(await toggle.getAttribute("class"), before, "Paper links do not expand supplementary metadata");
      await popup.close();
      await screenshot("publications");
      await page.getByRole("button", { name: "Toggle color theme", exact: true }).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      await screenshot("publications-dark");
      assert.deepEqual(errors, [], "No public browser runtime errors");
      assert.deepEqual(missing, [], "No missing local pages, assets, or portrait");
      console.log(`[public-ux] PASS ${name}: home image and links, search recovery, blog summaries, direct paper resources, dark theme, no overflow`);
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
    if (server.exitCode === null && server.signalCode === null) await once(server, "exit");
  }
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
