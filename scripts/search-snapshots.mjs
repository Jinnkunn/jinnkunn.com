/* Search UI regression snapshots.
 *
 * Purpose:
 * - Verify search overlay behavior: type filters, section scope, and snippets.
 *
 * Usage:
 *   npm run snapshot:search
 *
 * Env:
 *   CLONE_ORIGIN (default: https://jinnkunn-com.vercel.app)
 *
 * Output:
 *   output/playwright/search/<timestamp>/*.png
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "output", "playwright", "search");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

function normalizeOrigin(origin) {
  const raw = String(origin ?? "").trim();
  if (!raw) return "";
  return raw.replace(/\/+$/g, "");
}

function urlFor(origin, p) {
  const base = normalizeOrigin(origin);
  if (!base) throw new Error("Missing origin");
  return `${base}${p}`;
}

async function openSearch(page) {
  // Click the navbar search trigger (more stable than relying on "/" shortcut).
  try {
    await page.locator("#search-trigger").click({ timeout: 3500, force: true });
  } catch {
    // Some viewports hide the search button inside a menu; fallback to the global shortcut.
    await page.keyboard.press("/");
  }
  await page.waitForSelector("#notion-search-input", { timeout: 7000 });
  await page.waitForTimeout(250);
}

async function setQuery(page, q) {
  const input = page.locator("#notion-search-input");
  await input.fill(q);
  await page.waitForTimeout(500); // debounce + API
  // Wait for either results or empty-state.
  await Promise.race([
    page.waitForSelector(".notion-search__result-item", { timeout: 5000 }).catch(() => null),
    page.waitForSelector(".notion-search__empty-state", { timeout: 5000 }).catch(() => null),
  ]);
}

async function setType(page, type) {
  const id = {
    all: "#notion-search-filter-all",
    pages: "#notion-search-filter-pages",
    blog: "#notion-search-filter-blog",
    databases: "#notion-search-filter-databases",
  }[type];
  await page.click(id, { timeout: 3000 });
  await page.waitForTimeout(350);
}

async function toggleScope(page) {
  // Scope pill can be hidden on "/" or site-admin pages.
  const scope = page.locator("#notion-search-scope");
  if (!(await scope.isVisible().catch(() => false))) return false;
  await scope.click({ timeout: 3000 });
  await page.waitForTimeout(350);
  return true;
}

function safeName(s) {
  return String(s || "")
    .trim()
    .replaceAll("/", "__")
    .replaceAll(" ", "_")
    .replaceAll(":", "")
    .replaceAll(".", "")
    .replaceAll("?", "")
    .replaceAll("#", "");
}

async function main() {
  const origin = normalizeOrigin(process.env.CLONE_ORIGIN || "https://jinnkunn-com.vercel.app");
  const runDir = path.join(OUT_DIR, nowStamp());
  ensureDir(runDir);

  try {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    const ctx = await browser.newContext({ userAgent: "jinnkunn.com search-snapshots" });
    const page = await ctx.newPage();

    const viewports = [
      { name: "desktop", width: 1280, height: 800 },
      { name: "mobile", width: 390, height: 844 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      // Scenario A: Publications page, query + scope.
      await page.goto(urlFor(origin, "/publications"), { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(650);
      await openSearch(page);
      await setQuery(page, "AAAI-26");
      await page.screenshot({ path: path.join(runDir, `search-publications__aaai26-all-${vp.name}.png`) });
      await toggleScope(page);
      await page.screenshot({ path: path.join(runDir, `search-publications__aaai26-scope-${vp.name}.png`) });

      // Scenario B: Home page, blog query + type filters.
      await page.goto(urlFor(origin, "/"), { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(650);
      await openSearch(page);
      await setQuery(page, "drift");
      await page.screenshot({ path: path.join(runDir, `search-home__drift-all-${vp.name}.png`) });
      await setType(page, "blog");
      await page.screenshot({ path: path.join(runDir, `search-home__drift-blog-${vp.name}.png`) });
      await setType(page, "pages");
      await page.screenshot({ path: path.join(runDir, `search-home__drift-pages-${vp.name}.png`) });
      await setType(page, "databases");
      await page.screenshot({ path: path.join(runDir, `search-home__drift-databases-${vp.name}.png`) });

      // Scenario C: Works page, verify scope pill label.
      await page.goto(urlFor(origin, "/works"), { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(650);
      await openSearch(page);
      await setQuery(page, "Instructor");
      await page.screenshot({ path: path.join(runDir, `search-works__instructor-all-${vp.name}.png`) });
      await toggleScope(page);
      await page.screenshot({ path: path.join(runDir, `search-works__instructor-scope-${vp.name}.png`) });
    }

    await ctx.close();
    await browser.close();
  } finally {}

  console.log(`Search snapshots saved to: ${runDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
