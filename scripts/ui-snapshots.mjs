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

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "output", "ui-snapshots");

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
    env: { ...process.env, PORT: String(port) },
  });
  return child;
}

function safeNameFromPath(p) {
  if (p === "/") return "home";
  return p.replace(/^\/+/, "").replace(/\/+$/, "").replaceAll("/", "__");
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

    const targets = [
      "/", // navbar + hero layout
      "/news", // dated headings + link styles
      "/blog", // blog home (Notion page)
      "/blog/the-effect-of-chunk-retrieval-sequence-in-rag-on-multi-step-inference-performance-of-large-language-models", // long links + toggle + TOC
      "/publications", // long toggle summaries + metadata
      "/works", // toggles
      "/notice", // link styles + lists
    ];

    const viewports = [
      { name: "desktop", width: 1280, height: 800 },
      { name: "mobile", width: 390, height: 844 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      for (const p of targets) {
        const url = `${origin}${p}`;
        await page.goto(url, { waitUntil: "domcontentloaded" });
        // Give client-side behaviors (menus, toggles, TOC spy) time to attach.
        await page.waitForTimeout(650);

        const file = path.join(runDir, `${safeNameFromPath(p)}-${vp.name}.png`);
        await page.screenshot({ path: file, fullPage: true });

        // Search overlay snapshot (helps catch regressions in focus/filters/styling).
        if (p === "/blog") {
          try {
            await page.click("#search-trigger");
            await page.waitForSelector("#notion-search.open", { timeout: 4000 });
            await page.fill("#notion-search-input", "drift");
            await page.waitForTimeout(250);
            const f2 = path.join(runDir, `blog__search-${vp.name}.png`);
            await page.screenshot({ path: f2, fullPage: false });
            await page.keyboard.press("Escape");
            await page.waitForTimeout(150);
          } catch {
            // ignore
          }
        }
      }
    }

    await browser.close();
  } finally {
    server.kill("SIGTERM");
  }

  console.log(`Snapshots saved to: ${runDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
