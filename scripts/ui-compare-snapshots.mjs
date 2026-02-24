/* Compare UI snapshots between the original Super site and our clone.
 *
 * Usage:
 *   npm run snapshot:compare
 *
 * Env:
 *   ORIG_ORIGIN  (default: https://jinkunchen.com)
 *   CLONE_ORIGIN (default: https://jinnkunn-com.vercel.app)
 *   SNAPSHOT_COMPARE_MAX_DIFF_PERCENT   (default: 8)
 *   SNAPSHOT_COMPARE_PIXEL_THRESHOLD    (default: 0.12)
 *   SNAPSHOT_COMPARE_FAIL_ON_DIFF       (default: 1)
 *
 * Output:
 *   output/playwright/compare/<timestamp>/
 *     orig__<key>-<viewport>.png
 *     clone__<key>-<viewport>.png
 *     diff__<key>-<viewport>.png
 *     summary.json
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "output", "playwright", "compare");
const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function envFlag(name, defaultValue = false) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return defaultValue;
  return TRUE_VALUES.has(raw);
}

function envNumber(name, defaultValue) {
  const n = Number.parseFloat(String(process.env[name] ?? ""));
  return Number.isFinite(n) ? n : defaultValue;
}

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

async function launchBrowser() {
  // Prefer system Chrome when available (local dev), but fall back to bundled Chromium
  // (GitHub Actions runners may not expose the "chrome" channel).
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

async function captureSet({ origin, prefix, viewports, targets, runDir }) {
  const browser = await launchBrowser();

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

async function readPng(file) {
  return await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on("error", reject);
    stream
      .pipe(new PNG())
      .on("parsed", function parsed() {
        resolve(this);
      })
      .on("error", reject);
  });
}

async function writePng(file, png) {
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    out.on("finish", resolve);
    out.on("error", reject);
    png.pack().pipe(out);
  });
}

function percent(value) {
  return Math.round(value * 10000) / 100;
}

async function diffSet({
  runDir,
  targets,
  viewports,
  maxDiffPercent,
  pixelThreshold,
}) {
  const pairs = [];
  const failing = [];

  for (const vp of viewports) {
    for (const t of targets) {
      const suffix = `${t.key}-${vp.name}.png`;
      const origFile = path.join(runDir, `orig__${suffix}`);
      const cloneFile = path.join(runDir, `clone__${suffix}`);
      const diffFile = path.join(runDir, `diff__${suffix}`);

      const orig = await readPng(origFile);
      const clone = await readPng(cloneFile);

      let mismatchPixels = 0;
      let totalPixels = 0;
      let diffPercent = 100;
      let sizeMismatch = false;

      if (orig.width !== clone.width || orig.height !== clone.height) {
        sizeMismatch = true;
        totalPixels = Math.max(orig.width * orig.height, clone.width * clone.height);
        mismatchPixels = totalPixels;
      } else {
        const diff = new PNG({ width: orig.width, height: orig.height });
        mismatchPixels = pixelmatch(orig.data, clone.data, diff.data, orig.width, orig.height, {
          threshold: pixelThreshold,
          includeAA: true,
        });
        totalPixels = orig.width * orig.height;
        await writePng(diffFile, diff);
      }

      diffPercent = totalPixels > 0 ? (mismatchPixels / totalPixels) * 100 : 0;
      const pair = {
        key: t.key,
        viewport: vp.name,
        origFile: path.basename(origFile),
        cloneFile: path.basename(cloneFile),
        diffFile: sizeMismatch ? null : path.basename(diffFile),
        mismatchPixels,
        totalPixels,
        diffPercent: percent(diffPercent),
        sizeMismatch,
        pass: !sizeMismatch && diffPercent <= maxDiffPercent,
      };
      pairs.push(pair);
      if (!pair.pass) failing.push(pair);
    }
  }

  return { pairs, failing };
}

async function main() {
  const origOrigin = normalizeOrigin(process.env.ORIG_ORIGIN || "https://jinkunchen.com");
  const cloneOrigin = normalizeOrigin(
    process.env.CLONE_ORIGIN || "https://jinnkunn-com.vercel.app",
  );
  const maxDiffPercent = Math.max(0, envNumber("SNAPSHOT_COMPARE_MAX_DIFF_PERCENT", 8));
  const pixelThreshold = Math.min(1, Math.max(0, envNumber("SNAPSHOT_COMPARE_PIXEL_THRESHOLD", 0.12)));
  const failOnDiff = envFlag("SNAPSHOT_COMPARE_FAIL_ON_DIFF", true);

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

  const diff = await diffSet({
    runDir,
    targets,
    viewports,
    maxDiffPercent,
    pixelThreshold,
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    origOrigin,
    cloneOrigin,
    maxDiffPercent,
    pixelThreshold,
    failOnDiff,
    totalPairs: diff.pairs.length,
    failingPairs: diff.failing.length,
    pairs: diff.pairs,
  };

  fs.writeFileSync(path.join(runDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log(`Compare snapshots saved to: ${runDir}`);
  console.log(`orig:  ${origOrigin}`);
  console.log(`clone: ${cloneOrigin}`);
  console.log(
    `Diff threshold: ${maxDiffPercent}% (pixel threshold=${pixelThreshold}); failing pairs: ${diff.failing.length}/${diff.pairs.length}`,
  );

  if (diff.failing.length) {
    const top = diff.failing
      .slice()
      .sort((a, b) => b.diffPercent - a.diffPercent)
      .slice(0, 8);
    console.log("Top regressions:");
    for (const it of top) {
      console.log(`- ${it.key} (${it.viewport}): ${it.diffPercent}%`);
    }
  }

  if (failOnDiff && diff.failing.length) {
    throw new Error(
      `UI compare diff exceeded threshold (${maxDiffPercent}%) for ${diff.failing.length} pair(s).`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
