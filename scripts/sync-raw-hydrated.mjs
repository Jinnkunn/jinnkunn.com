/* Sync hydrated `<main>` HTML from the live site into `content/raw/`.
 *
 * Why:
 * - The raw HTML snapshots under `content/raw/` are SSR fragments and can miss
 *   Notion/Super client-hydration behaviors (some blocks render as inert spans).
 * - Capturing hydrated `<main>` makes the clone more faithful without requiring
 *   us to re-implement Super's full renderer.
 *
 * Usage:
 *   npm run sync:raw
 *
 * Notes:
 * - Uses system Chrome via Playwright `channel: "chrome"` to avoid downloading browsers.
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const ROOT = process.cwd();
const ORIGIN = process.env.SYNC_ORIGIN || "https://jinkunchen.com";

const STATIC_ROUTES = [
  "/",
  "/news",
  "/publications",
  "/works",
  "/teaching",
  "/bio",
  "/notice",
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeFile(filePath, contents) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, contents);
}

function routeToRawPath(route) {
  if (route === "/") return path.join(ROOT, "content", "raw", "index.html");
  const rel = route.replace(/^\/+/, "").replace(/\/+$/, "");
  return path.join(ROOT, "content", "raw", `${rel}.html`);
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "jinnkunn.com raw sync (hydrated)",
      accept: "text/html,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${res.statusText}: ${url}`);
  return await res.text();
}

function extractBlogPostSlugsFromRss(rss) {
  const matches = Array.from(
    rss.matchAll(/<link>(https?:\/\/[^<]*\/blog\/list\/[^<]+)<\/link>/g)
  ).map((m) => m[1]);

  const slugs = new Set();
  for (const u of matches) {
    try {
      const url = new URL(u);
      const parts = url.pathname.split("/").filter(Boolean);
      const idx = parts.indexOf("list");
      if (parts[0] === "blog" && idx === 1 && parts[2]) slugs.add(parts[2]);
    } catch {
      // ignore
    }
  }
  return Array.from(slugs);
}

async function syncFeeds() {
  const rssUrl = `${ORIGIN}/blog.rss`;
  const atomUrl = `${ORIGIN}/blog.atom`;
  console.log(`Fetching ${rssUrl}`);
  const rss = await fetchText(rssUrl);
  writeFile(path.join(ROOT, "public", "blog.rss"), rss);
  console.log(`Fetching ${atomUrl}`);
  const atom = await fetchText(atomUrl);
  writeFile(path.join(ROOT, "public", "blog.atom"), atom);
  return rss;
}

async function getHydratedMainHtml(page, url) {
  const resp = await page.goto(url, { waitUntil: "domcontentloaded" });
  const status = resp?.status?.() ?? 0;
  if (status && status >= 400) throw new Error(`HTTP ${status} for ${url}`);

  await page.waitForSelector("main", { timeout: 30_000 });
  // Wait a tick for client hydration; Super/Next may render blocks after initial DOMContentLoaded.
  await page.waitForTimeout(900);

  const mainHtml = await page.evaluate(() => {
    const m = document.querySelector("main");
    return m ? m.outerHTML : "";
  });

  if (!mainHtml || !/<main\b/i.test(mainHtml) || mainHtml.length < 200) {
    throw new Error(`Failed to capture <main> for ${url} (len=${mainHtml?.length ?? 0})`);
  }
  return mainHtml;
}

async function main() {
  const rss = await syncFeeds();
  const blogSlugs = extractBlogPostSlugsFromRss(rss);

  const blogRoutes = blogSlugs.map((s) => `/blog/list/${s}`);
  const routes = [...STATIC_ROUTES, ...blogRoutes];

  console.log(`Sync origin: ${ORIGIN}`);
  console.log(`Routes: ${routes.length}`);

  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: "jinnkunn.com raw sync (hydrated)",
  });
  const page = await context.newPage();

  try {
    for (const route of routes) {
      const url = `${ORIGIN}${route}`;
      console.log(`Hydrating ${url}`);
      const mainHtml = await getHydratedMainHtml(page, url);

      let outPath;
      if (route.startsWith("/blog/list/")) {
        const post = route.split("/").filter(Boolean)[2];
        outPath = path.join(ROOT, "content", "raw", "blog", "list", `${post}.html`);
      } else {
        outPath = routeToRawPath(route);
      }

      writeFile(outPath, mainHtml);
    }
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exitCode = 1;
});

