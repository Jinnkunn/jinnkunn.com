#!/usr/bin/env node

// Render src-tauri/icons/tray.svg into the PNG that the Tauri tray
// loader bundles via `include_image!`. Run after editing tray.svg:
//
//   node apps/workspace/scripts/build-tray-icon.mjs
//
// Output: src-tauri/icons/tray.png at 44x44 (2x retina menubar slot).
// macOS scales the same PNG down for @1x; the 44px source stays sharp
// at both densities. We deliberately don't generate @1x / @3x copies
// because Tauri's tray API takes a single Image — providing the @2x
// asset and letting AppKit's template-rendering pipeline handle the
// scale is the cleanest route.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "src-tauri", "icons");
const SVG_PATH = path.join(ROOT, "tray.svg");
const PNG_PATH = path.join(ROOT, "tray.png");

// Use the project root's sharp install. The workspace package.json
// doesn't depend on sharp directly; the root does (already pulled in
// for `scripts/perf-budget.mjs` and friends).
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const sharpEntry = path.join(REPO_ROOT, "node_modules", "sharp", "lib", "index.js");
const sharp = (await import(sharpEntry)).default;

async function main() {
  const svg = await readFile(SVG_PATH);
  const png = await sharp(svg, { density: 384 })
    .resize(44, 44, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(PNG_PATH, png);
  console.log(`[tray-icon] wrote ${path.relative(REPO_ROOT, PNG_PATH)} (${png.byteLength} B)`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
