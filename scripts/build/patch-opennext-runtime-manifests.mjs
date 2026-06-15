#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const serverRoot = path.join(root, ".open-next", "server-functions", "default");
const manifestPath = path.join(serverRoot, ".next", "server", "middleware-manifest.json");
const targetFiles = [
  path.join(serverRoot, "index.mjs"),
  path.join(serverRoot, "handler.mjs"),
];

const guardMarker = "open-next-runtime-manifest-guard";

async function readMiddlewareManifestLiteral() {
  const raw = await readFile(manifestPath, "utf8");
  return JSON.stringify(JSON.parse(raw));
}

function applyGuard(source, manifestLiteral, fileLabel) {
  if (source.includes(guardMarker)) {
    return { source, changed: false };
  }

  const looseGuard =
    `if(String(x).endsWith("/server/middleware-manifest.json"))` +
    `return ${manifestLiteral};`;

  const replacements = [
    {
      from:
        `if (typeof require !== "undefined") return require.apply(this, arguments);\n` +
        `  throw Error('Dynamic require of "' + x + '" is not supported');`,
      to:
        `if (typeof require !== "undefined") return require.apply(this, arguments);\n` +
        `  // ${guardMarker}: Next 16 may dynamically require this manifest in the Worker ESM bundle.\n` +
        `  ${looseGuard}\n` +
        `  throw Error('Dynamic require of "' + x + '" is not supported');`,
    },
    {
      from:
        `if(typeof require<"u")return require.apply(this,arguments);throw Error('Dynamic require of "'+x+'" is not supported')`,
      to:
        `if(typeof require<"u")return require.apply(this,arguments);` +
        `/* ${guardMarker}: Next 16 may dynamically require this manifest in the Worker ESM bundle. */` +
        `${looseGuard}` +
        `throw Error('Dynamic require of "'+x+'" is not supported')`,
    },
  ];

  for (const replacement of replacements) {
    if (source.includes(replacement.from)) {
      return {
        source: source.replace(replacement.from, replacement.to),
        changed: true,
      };
    }
  }

  throw new Error(
    `Could not find OpenNext dynamic require stub in ${fileLabel}. The bundle shape may have changed.`,
  );
}

async function main() {
  const manifestLiteral = await readMiddlewareManifestLiteral();
  const results = [];

  for (const file of targetFiles) {
    const source = await readFile(file, "utf8");
    const patched = applyGuard(source, manifestLiteral, path.relative(root, file));
    if (patched.changed) {
      await writeFile(file, patched.source);
    }
    results.push({
      file: path.relative(root, file),
      changed: patched.changed,
    });
  }

  console.log(
    `[patch-opennext-runtime-manifests] ${JSON.stringify({
      manifest: path.relative(root, manifestPath),
      results,
    })}`,
  );
}

main().catch((error) => {
  console.error(`[patch-opennext-runtime-manifests] ${error?.stack ?? error}`);
  process.exit(1);
});
