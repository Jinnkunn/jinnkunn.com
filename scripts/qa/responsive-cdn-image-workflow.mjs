import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { LCP_IMAGE_FILENAME } from "../../components/posts-mdx/image-sizes.ts";
import { ensureNextBuild, findAvailablePort, startNextServer, waitForHttp } from "../_lib/local-next.mjs";

const cdn = "https://cdn.jinkunchen.com";
const bitmap = fileURLToPath(new URL("../../public/assets/favicon.png", import.meta.url));
const article = "/blog/do-language-model-embeddings-form-an-approximate-abelian-group";

async function verifyPortraitFallback(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  try {
    const portraitPath = `/notion-assets/${LCP_IMAGE_FILENAME}`;
    const requests = [];
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      if (url.origin === cdn && url.pathname.endsWith(portraitPath)) {
        if (url.pathname.startsWith("/cdn-cgi/image/")) {
          requests.push("variant");
          return route.fulfill({ status: 502, contentType: "text/plain", body: "Variant unavailable" });
        }
        if (url.pathname === portraitPath) {
          requests.push("original");
          return route.fulfill({ path: bitmap, contentType: "image/png" });
        }
      }
      return route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    await page.goto(origin);
    await page.waitForFunction((original) => {
      const image = document.querySelector(".home-layout--variant-classicIntro img[data-cdn-image]");
      return image instanceof HTMLImageElement &&
        !image.hasAttribute("srcset") && image.complete && image.naturalWidth > 0 && image.currentSrc === original;
    }, cdn + portraitPath, { timeout: 12_000 });
    assert.deepEqual(requests, ["variant", "original"], "try the resized portrait, then request the original once");
    console.log("[responsive-images] PASS home portrait recovers from a CDN variant 502");
  } finally {
    await context.close();
  }
}

async function verifyArticleSizes(browser, origin) {
  for (const [viewport, dpr, displayWidth, variantWidth] of [
    [390, 2, 342, 768],
    [880, 1, 784, 1024],
    [1440, 2, 708, 1536],
  ]) {
    const context = await browser.newContext({ viewport: { width: viewport, height: 900 }, deviceScaleFactor: dpr });
    try {
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.origin === origin) return route.continue();
        if (url.origin === cdn && route.request().resourceType() === "image") {
          return route.fulfill({ path: bitmap, contentType: "image/png" });
        }
        return route.abort("blockedbyclient");
      });
      const page = await context.newPage();
      await page.goto(origin + article);
      const image = page.locator('img[data-cdn-image][src$="/axiom_comparison.png"]');
      const actual = await image.evaluate(async (img) => {
        await img.decode();
        const width = new URL(img.currentSrc).pathname.match(/\/cdn-cgi\/image\/width=(\d+)/)?.[1];
        return [Math.round(img.getBoundingClientRect().width), Number(width)];
      });
      assert.deepEqual(actual, [displayWidth, variantWidth], `${viewport}px viewport at ${dpr}x`);
      console.log(`[responsive-images] PASS ${viewport}px at ${dpr}x: ${displayWidth}px slot, ${variantWidth}px image`);
    } finally {
      await context.close();
    }
  }
}

async function main() {
  Object.assign(process.env, { SITE_ADMIN_STORAGE: "local", CONTENT_SYNC_MODE: "stubs" });
  ensureNextBuild();
  const port = await findAvailablePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = startNextServer({ port });
  let browser;
  try {
    await waitForHttp(origin);
    const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
    await verifyPortraitFallback(browser, origin);
    await verifyArticleSizes(browser, origin);
  } finally {
    try { await browser?.close(); }
    finally { await server.stop(); }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
