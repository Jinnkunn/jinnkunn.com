#!/usr/bin/env node
/**
 * Recompress images under `public/notion-assets/` in place.
 *
 * Context: Notion sync downloads raw images from Notion's CDN without
 * recompression. Some ship as 4MB PNGs where a losslessly-optimised
 * version would be ~1MB. Even though the public site serves these via
 * Next's image optimiser (which transcodes to AVIF/WebP on demand),
 * the origin file size still matters:
 *   - smaller PNG source = faster first-time derivative generation
 *   - smaller asset upload on every Worker / Vercel deploy
 *   - smaller `.open-next/` build bundle
 *
 * Safety:
 *   - Opens each image with sharp, re-emits with max compression but
 *     never at a lower visual quality than the source (lossless for
 *     PNG; q=90 for JPG).
 *   - Only writes the new file if it is strictly smaller than the
 *     original (so re-running on already-optimised assets is a no-op).
 *   - Skips anything that is not a .png/.jpg/.jpeg/.webp.
 *
 * Usage:
 *   node scripts/optimize-notion-assets.mjs            # in-place
 *   node scripts/optimize-notion-assets.mjs --dry-run  # report only
 */

import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { parseArgs } from "./_lib/cli.mjs";

const ROOT = process.cwd();
const TARGET_DIR = path.join(ROOT, "public", "notion-assets");
const JPG_QUALITY = 90;
const WEBP_QUALITY = 90;

function isSupportedExt(file) {
  const lower = file.toLowerCase();
  return (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".webp")
  );
}

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(abs);
      continue;
    }
    if (entry.isFile() && isSupportedExt(entry.name)) yield abs;
  }
}

async function recompress(absPath, options) {
  const ext = path.extname(absPath).toLowerCase();
  const pipeline = sharp(absPath, { failOn: "none" });
  if (ext === ".png") {
    // Default: lossless re-encoding. Safe for all images including
    // photos; typical savings 5-30% by switching to max compression
    // effort and adaptive filtering.
    const losslessBuf = await pipeline
      .clone()
      .png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 })
      .toBuffer();

    if (!options.aggressive) return losslessBuf;

    // --aggressive: also try a 256-colour palette variant with dither.
    // Winds down to ~50-60% of the original for screenshots / UI
    // illustrations, but can introduce visible banding on photo-like
    // content with smooth gradients. Only kept if it beats the
    // lossless buffer by >=20%.
    let paletteBuf = null;
    try {
      paletteBuf = await pipeline
        .clone()
        .png({
          compressionLevel: 9,
          adaptiveFiltering: true,
          effort: 10,
          palette: true,
          quality: 90,
          colors: 256,
          dither: 1.0,
        })
        .toBuffer();
    } catch {
      paletteBuf = null;
    }

    if (paletteBuf && paletteBuf.byteLength < losslessBuf.byteLength * 0.8) {
      return paletteBuf;
    }
    return losslessBuf;
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return pipeline
      .jpeg({ quality: JPG_QUALITY, mozjpeg: true })
      .toBuffer();
  }
  if (ext === ".webp") {
    return pipeline
      .webp({ quality: WEBP_QUALITY, effort: 6 })
      .toBuffer();
  }
  return null;
}

function humanBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

/**
 * Programmatic entry. Called from `scripts/sync-notion.mjs` after a
 * fresh sync so the pipeline optimises what it just downloaded
 * without the user having to remember a second command.
 */
export async function optimizeNotionAssets({
  dryRun = false,
  aggressive = false,
  quiet = false,
} = {}) {
  let totalBefore = 0;
  let totalAfter = 0;
  let touched = 0;
  let kept = 0;

  const rows = [];

  for await (const abs of walk(TARGET_DIR)) {
    const stat = await fs.stat(abs);
    const before = stat.size;
    totalBefore += before;

    const out = await recompress(abs, { aggressive }).catch((err) => {
      if (!quiet) {
        console.warn(`[optimize] skip ${path.relative(ROOT, abs)}: ${String(err)}`);
      }
      return null;
    });

    if (!out) {
      totalAfter += before;
      kept += 1;
      continue;
    }

    const after = out.byteLength;
    const shouldReplace = after < before;
    const rel = path.relative(ROOT, abs);
    rows.push({ rel, before, after, shouldReplace });

    if (shouldReplace && !dryRun) {
      await fs.writeFile(abs, out);
    }

    totalAfter += shouldReplace ? after : before;
    if (shouldReplace) touched += 1;
    else kept += 1;
  }

  if (!quiet) {
    for (const row of rows) {
      const pct =
        row.before > 0 ? ((row.before - row.after) / row.before) * 100 : 0;
      const marker = row.shouldReplace ? (dryRun ? "-dry" : "OK  ") : "skip";
      console.log(
        `${marker}  ${row.rel}  ${humanBytes(row.before)} -> ${humanBytes(row.after)}  (${pct.toFixed(1)}%)`,
      );
    }
  }

  const saved = Math.max(0, totalBefore - totalAfter);
  const savedPct = totalBefore > 0 ? (saved / totalBefore) * 100 : 0;

  if (!quiet || touched > 0) {
    const header = quiet ? "[sync:notion] optimise-assets" : "[optimize]";
    if (!quiet) console.log("");
    console.log(
      `${header} files: ${rows.length} (${touched} shrunk, ${kept} kept)${dryRun ? " · DRY RUN" : ""}`,
    );
    console.log(
      `${header} bytes: ${humanBytes(totalBefore)} -> ${humanBytes(totalAfter)}  (saved ${humanBytes(saved)}, ${savedPct.toFixed(1)}%)`,
    );
  }

  return { files: rows.length, touched, kept, totalBefore, totalAfter, saved };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args["dry-run"] || args.dryRun);
  const aggressive = Boolean(args.aggressive);
  await optimizeNotionAssets({ dryRun, aggressive });
}

// Only auto-run when invoked directly (e.g. `node scripts/optimize-notion-assets.mjs`),
// not when imported from another script.
const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(path.basename(process.argv[1] || ""));
if (invokedDirectly) {
  main().catch((err) => {
    console.error("[optimize] failed:", err);
    process.exitCode = 1;
  });
}
