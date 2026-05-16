#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const outPath = path.join(cwd, "content", "generated", "classic-css-assets.json");

const manifestCandidates = [
  path.join(
    cwd,
    ".next",
    "server",
    "app",
    "(classic)",
    "page_client-reference-manifest.js",
  ),
  path.join(
    cwd,
    ".open-next",
    "server-functions",
    "default",
    ".next",
    "server",
    "app",
    "(classic)",
    "page_client-reference-manifest.js",
  ),
];

function extractStylesheets(source) {
  return [...source.matchAll(/static\/css\/[^"']+\.css/g)]
    .map((match) => `/_next/${match[0]}`)
    .filter((value, index, arr) => arr.indexOf(value) === index);
}

function readClassicManifest() {
  for (const candidate of manifestCandidates) {
    try {
      const source = fs.readFileSync(candidate, "utf8");
      const stylesheets = extractStylesheets(source);
      if (stylesheets.length > 0) {
        return {
          source: path.relative(cwd, candidate).replace(/\\/g, "/"),
          stylesheets,
        };
      }
    } catch {
      // Try the next build output layout.
    }
  }
  return null;
}

function main() {
  const payload = readClassicManifest();
  if (!payload) {
    throw new Error("Could not find classic page CSS assets in Next build output");
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        source: payload.source,
        stylesheets: payload.stylesheets,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        stylesheets: payload.stylesheets.length,
        source: payload.source,
        outFile: path.relative(cwd, outPath).replace(/\\/g, "/"),
      },
      null,
      2,
    ),
  );
}

main();
