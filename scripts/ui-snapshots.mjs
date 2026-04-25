/* Lightweight UI regression snapshots.
 *
 * Purpose:
 * - Catch visual regressions when Super/Notion markup changes or when we adjust CSS/behaviors.
 * - Keep it simple: just generate screenshots into output/ for manual diffing.
 *
 * Usage:
 *   npm run snapshot:ui
 *
 * Notes:
 * - Uses system Chrome via Playwright `channel: "chrome"` to avoid downloading browsers.
 * - Starts `next start` on an ephemeral port; runs `npm run build` if needed.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

import { stopProcessTree } from "./_lib/process-tree.mjs";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "output", "ui-snapshots");
const DEFAULT_TARGETS = [
  "/",
  "/blog/context-order-and-reasoning-drift-measuring-order-sensitivity-from-token-probabilities",
  "/blog",
  "/publications",
  "/works",
  "/site-admin",
];
const DEFAULT_THEMES = ["light", "dark"];
const SCRIPT_NEXTAUTH_SECRET =
  process.env.NEXTAUTH_SECRET || "codex-design-system-qa-secret";

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

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitForHttpOk(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (res.ok) return;
    } catch {
      // ignore
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for server: ${url}`);
}

function hasBuild() {
  try {
    return fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"));
  } catch {
    return false;
  }
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", ...opts });
    p.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with ${code}`));
    });
    p.on("error", reject);
  });
}

function startNext(port) {
  // Use node to execute Next directly (more stable than shell scripts).
  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    stdio: "inherit",
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      PORT: String(port),
      NEXTAUTH_SECRET: SCRIPT_NEXTAUTH_SECRET,
      NEXTAUTH_URL: process.env.NEXTAUTH_URL || `http://127.0.0.1:${port}`,
    },
  });
  return child;
}

function safeNameFromPath(p) {
  const url = new URL(p, "http://codex.local");
  if (url.pathname === "/") return "home";
  return url.pathname.replace(/^\/+/, "").replace(/\/+$/, "").replaceAll("/", "__");
}

function parseTargets(raw) {
  return Array.from(
    new Set(
      String(raw || "")
        .split(/[,\s]+/g)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => (s.startsWith("/") ? s : `/${s}`))
        .map((s) => (s === "/" ? s : s.replace(/\/+$/, ""))),
    ),
  );
}

function parseThemes(raw) {
  return Array.from(
    new Set(
      String(raw || "")
        .split(/[,\s]+/g)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s === "light" || s === "dark"),
    ),
  );
}

function withTheme(pathname, theme) {
  const url = new URL(pathname, "http://codex.local");
  url.searchParams.set("theme", theme);
  return `${url.pathname}${url.search}`;
}

async function gotoThemedPage(page, origin, pathname, theme) {
  const url = `${origin}${withTheme(pathname, theme)}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    (expectedTheme) => document.documentElement.dataset.theme === expectedTheme,
    theme,
  );
  return url;
}

async function captureSearchOverlay(page, runDir, theme, viewportName) {
  try {
    await page.click("#search-trigger");
    await page.waitForSelector("#notion-search.open", { timeout: 4000 });
    await page.fill("#notion-search-input", "drift");
    await page.waitForTimeout(250);
    const file = path.join(runDir, `blog__search-${theme}-${viewportName}.png`);
    await page.screenshot({ path: file, fullPage: false });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  } catch {
    // ignore
  }
}

function effectiveTargets() {
  const targets = parseTargets(process.env.SNAPSHOT_TARGETS);
  return targets.length > 0 ? targets : DEFAULT_TARGETS;
}

function effectiveThemes() {
  const themes = parseThemes(process.env.SNAPSHOT_THEMES);
  return themes.length > 0 ? themes : DEFAULT_THEMES;
}

async function launchBrowser() {
  // Prefer system Chrome when available, but fall back for CI runners.
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

async function main() {
  if (!hasBuild()) {
    await run("npm", ["run", "build"], { cwd: ROOT });
  }

  const port = Number(process.env.SNAPSHOT_PORT || 3187);
  const origin = `http://127.0.0.1:${port}`;

  const runDir = path.join(OUT_DIR, nowStamp());
  ensureDir(runDir);

  const server = startNext(port);
  try {
    await waitForHttpOk(`${origin}/`, 20_000);

    const browser = await launchBrowser();

    const ctx = await browser.newContext({
      userAgent: "jinnkunn.com ui-snapshots",
    });
    const page = await ctx.newPage();

    const targets = effectiveTargets();
    const themes = effectiveThemes();

    const viewports = [
      { name: "desktop", width: 1280, height: 800 },
      { name: "mobile", width: 390, height: 844 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      for (const theme of themes) {
        for (const target of targets) {
          await gotoThemedPage(page, origin, target, theme);
          // Give client-side behaviors (menus, toggles, TOC spy) time to attach.
          await page.waitForTimeout(650);

          const file = path.join(runDir, `${safeNameFromPath(target)}-${theme}-${vp.name}.png`);
          await page.screenshot({ path: file, fullPage: true });

          if (target === "/blog") {
            await captureSearchOverlay(page, runDir, theme, vp.name);
          }
        }
      }
    }

    await browser.close();
  } finally {
    await stopProcessTree(server);
  }

  console.log(`Snapshots saved to: ${runDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
