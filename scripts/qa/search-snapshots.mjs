/* Search UI regression snapshots.
 *
 * Purpose:
 * - Verify search overlay behavior: type filters, section scope, and snippets.
 *
 * Usage:
 *   npm run snapshot:search
 *
 * Env:
 *   ORIGIN / CLONE_ORIGIN: if set to an http(s) origin, run against that remote site.
 *   Otherwise the script starts a local `next start` server (recommended).
 *
 * Output:
 *   output/playwright/search/<timestamp>/*.png
 */

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
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

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitForHttpOk(url, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (res.ok) return;
    } catch {
      // ignore
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for server: ${url}`);
}

function hasBuild(root) {
  try {
    return fs.existsSync(path.join(root, ".next", "BUILD_ID"));
  } catch {
    return false;
  }
}

function ensureBuild() {
  const r = spawnSync("npm", ["run", "build"], { stdio: "inherit", env: process.env });
  if (r.status !== 0) throw new Error("Build failed; cannot run search snapshots.");
}

function startNext(root, port) {
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  return spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    stdio: "inherit",
    env: { ...process.env, PORT: String(port) },
  });
}

async function launchBrowser() {
  // Prefer system Chrome when available, but fall back for CI runners.
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    return await chromium.launch({ headless: true });
  }
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
  const btn = page.locator(id);
  const disabled = await btn.evaluate((el) => Boolean(el.disabled)).catch(() => true);
  if (disabled) return false;
  await btn.click({ timeout: 3000 });
  await page.waitForTimeout(350);
  return true;
}

async function toggleScope(page) {
  // Scope pill can be hidden on "/" or site-admin pages.
  const scope = page.locator("#notion-search-scope");
  if (!(await scope.isVisible().catch(() => false))) return false;
  await scope.click({ timeout: 3000 });
  await page.waitForTimeout(350);
  return true;
}

async function main() {
  const ROOT = process.cwd();
  const configuredOrigin = normalizeOrigin(process.env.ORIGIN || process.env.CLONE_ORIGIN || "");

  const port = Number(process.env.SNAPSHOT_PORT || 3191);
  const localOrigin = `http://127.0.0.1:${port}`;
  const useRemote = Boolean(configuredOrigin);
  const origin = useRemote ? configuredOrigin : localOrigin;

  const runDir = path.join(OUT_DIR, nowStamp());
  ensureDir(runDir);

  let server = null;
  if (!useRemote) {
    if (!hasBuild(ROOT)) ensureBuild();
    server = startNext(ROOT, port);
    await waitForHttpOk(`${origin}/`, 35_000);
  }

  try {
    const browser = await launchBrowser();
    const ctx = await browser.newContext({ userAgent: "jinnkunn.com search-snapshots" });
    const page = await ctx.newPage();

    try {
      const viewports = [
        { name: "desktop", width: 1280, height: 800 },
        { name: "mobile", width: 390, height: 844 },
      ];

      for (const vp of viewports) {
        await page.setViewportSize({ width: vp.width, height: vp.height });

        // Scenario A: Publications page, query + scope.
        await page.goto(urlFor(origin, "/publications"), { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForTimeout(650);
        await openSearch(page);
        await setQuery(page, "AAAI-26");
        await page.screenshot({ path: path.join(runDir, `search-publications__aaai26-all-${vp.name}.png`) });
        await toggleScope(page);
        await page.screenshot({ path: path.join(runDir, `search-publications__aaai26-scope-${vp.name}.png`) });

        // Scenario B: Home page, blog query + type filters.
        await page.goto(urlFor(origin, "/"), { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForTimeout(650);
        await openSearch(page);
        await setQuery(page, "drift");
        await page.screenshot({ path: path.join(runDir, `search-home__drift-all-${vp.name}.png`) });
        const blogOk = await setType(page, "blog");
        await page.screenshot({
          path: path.join(runDir, `search-home__drift-blog${blogOk ? "" : "-disabled"}-${vp.name}.png`),
        });
        const pagesOk = await setType(page, "pages");
        await page.screenshot({
          path: path.join(runDir, `search-home__drift-pages${pagesOk ? "" : "-disabled"}-${vp.name}.png`),
        });
        const dbOk = await setType(page, "databases");
        await page.screenshot({
          path: path.join(runDir, `search-home__drift-databases${dbOk ? "" : "-disabled"}-${vp.name}.png`),
        });

        // Scenario C: Works page, verify scope pill label.
        await page.goto(urlFor(origin, "/works"), { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForTimeout(650);
        await openSearch(page);
        await setQuery(page, "Instructor");
        await page.screenshot({ path: path.join(runDir, `search-works__instructor-all-${vp.name}.png`) });
        await toggleScope(page);
        await page.screenshot({ path: path.join(runDir, `search-works__instructor-scope-${vp.name}.png`) });
      }
    } finally {
      await ctx.close();
      await browser.close();
    }
  } finally {
    if (server) server.kill("SIGTERM");
  }

  console.log(`Search snapshots saved to: ${runDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
