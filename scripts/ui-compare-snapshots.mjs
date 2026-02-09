/* Compare UI snapshots between the original Super site and our clone.
 *
 * Usage:
 *   npm run snapshot:compare
 *
 * Env:
 *   ORIG_ORIGIN  (default: https://jinkunchen.com)
 *   CLONE_ORIGIN (default: https://jinnkunn-com.vercel.app)
 *
 * Output:
 *   output/playwright/compare/<timestamp>/
 *     orig__<key>-<viewport>.png
 *     clone__<key>-<viewport>.png
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "output", "playwright", "compare");

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

async function captureSet({ origin, prefix, viewports, targets, runDir }) {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
  });

  const ctx = await browser.newContext({
    userAgent: "jinnkunn.com ui-compare-snapshots",
  });
  const page = await ctx.newPage();

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const t of targets) {
      const p = prefix === "orig" ? t.origPath : t.clonePath;
      const url = urlFor(origin, p);
      await page.goto(url, { waitUntil: "domcontentloaded" });
      // Give any client JS (menus, toggles, hydration) a moment to settle.
      await page.waitForTimeout(900);
      const file = path.join(runDir, `${prefix}__${t.key}-${vp.name}.png`);
      await page.screenshot({ path: file, fullPage: true });
    }
  }

  await browser.close();
}

async function main() {
  const origOrigin = normalizeOrigin(process.env.ORIG_ORIGIN || "https://jinkunchen.com");
  const cloneOrigin = normalizeOrigin(
    process.env.CLONE_ORIGIN || "https://jinnkunn-com.vercel.app",
  );

  const runDir = path.join(OUT_DIR, nowStamp());
  ensureDir(runDir);

  const targets = [
    { key: "home", origPath: "/", clonePath: "/" },
    { key: "news", origPath: "/news", clonePath: "/news" },
    { key: "publications", origPath: "/publications", clonePath: "/publications" },
    { key: "works", origPath: "/works", clonePath: "/works" },
    { key: "blog", origPath: "/blog", clonePath: "/blog" },
    {
      key: "blog-post-rag-order",
      // Original Super site uses `/blog/list/<slug>`; our clone canonicalizes to `/blog/<slug>`.
      origPath:
        "/blog/list/the-effect-of-chunk-retrieval-sequence-in-rag-on-multi-step-inference-performance-of-large-language-models",
      clonePath:
        "/blog/the-effect-of-chunk-retrieval-sequence-in-rag-on-multi-step-inference-performance-of-large-language-models",
    },
    { key: "notice", origPath: "/notice", clonePath: "/notice" },
  ];

  const viewports = [
    { name: "desktop", width: 1280, height: 800 },
    { name: "mobile", width: 390, height: 844 },
  ];

  await captureSet({
    origin: origOrigin,
    prefix: "orig",
    viewports,
    targets,
    runDir,
  });

  await captureSet({
    origin: cloneOrigin,
    prefix: "clone",
    viewports,
    targets,
    runDir,
  });

  console.log(`Compare snapshots saved to: ${runDir}`);
  console.log(`orig:  ${origOrigin}`);
  console.log(`clone: ${cloneOrigin}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
