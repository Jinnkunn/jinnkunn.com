import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TWIN_ROOT = path.join(ROOT, "lib");
const SCAN_DIRS = ["app", "cloudflare", "components", "lib", "scripts", "tests"];
const SCAN_FILES = ["middleware.ts"];

// `lib/**/*.mjs` twins exist only so plain-node scripts can reuse the logic the
// app consumes through the `.ts` facade. A twin nobody imports is dead weight
// that silently drifts from its facade (that is how search-group.mjs rotted).
// knip cannot catch this: its `srcDir === outDir` heuristic treats a `.mjs`
// sitting next to a same-named `.ts` as build output and rewrites every
// importer's specifier to the `.ts`, so all 21 twins come back as "unused
// files". knip.jsonc therefore ignores `lib/**/*.mjs` outright and this guard
// owns the class instead — which means it has to resolve specifiers for real,
// not just substring-match, or it would stop being a guard at all.

async function listFilesRecursively(dir) {
  const out = [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFilesRecursively(abs)));
      continue;
    }
    if (/\.(mjs|js|ts|tsx)$/.test(entry.name)) out.push(abs);
  }
  return out;
}

// Any quoted `*.mjs` path counts as a reference: static imports, dynamic
// imports, `export … from`, and the plain path strings the node loader hooks
// under tests/helpers pass to `pathToFileURL`.
function readMjsReferences(source) {
  const out = [];
  for (const match of source.matchAll(/["'`]([^"'`\n]+\.mjs)["'`]/g)) out.push(match[1]);
  return out;
}

function resolveReference(specifier, importerAbs) {
  if (specifier.startsWith("@/")) return path.join(ROOT, specifier.slice(2));
  if (specifier.startsWith(".")) return path.resolve(path.dirname(importerAbs), specifier);
  if (specifier.startsWith("/")) return path.join(ROOT, specifier.slice(1));
  return path.join(ROOT, specifier);
}

test("mjs-twins: every lib/**/*.mjs module has at least one importer", async () => {
  const sources = [];
  for (const relDir of SCAN_DIRS) {
    sources.push(...(await listFilesRecursively(path.join(ROOT, relDir))));
  }
  for (const relFile of SCAN_FILES) sources.push(path.join(ROOT, relFile));

  const twins = sources.filter(
    (abs) => abs.endsWith(".mjs") && abs.startsWith(`${TWIN_ROOT}${path.sep}`),
  );
  assert.ok(twins.length > 0, "expected lib/**/*.mjs twins to exist");

  // Self-references (a module importing itself, recursively or otherwise) must
  // not keep a dead module alive, so referrers are tracked per target.
  const referenced = new Set();
  for (const importerAbs of sources) {
    let source = "";
    try {
      source = await fs.readFile(importerAbs, "utf8");
    } catch {
      continue;
    }
    for (const specifier of readMjsReferences(source)) {
      const resolved = resolveReference(specifier, importerAbs);
      if (resolved === importerAbs) continue;
      referenced.add(resolved);
    }
  }

  const orphans = twins
    .filter((abs) => !referenced.has(abs))
    .map((abs) => path.relative(ROOT, abs).split(path.sep).join("/"))
    .sort();

  assert.deepEqual(orphans, []);
});

test("mjs-twins: knip.jsonc still delegates the twin class to this guard", async () => {
  const config = await fs.readFile(path.join(ROOT, "knip.jsonc"), "utf8");
  const stripped = config.replace(/^\s*\/\/.*$/gm, "");
  const parsed = JSON.parse(stripped);
  assert.ok(
    Array.isArray(parsed.ignore) && parsed.ignore.includes("lib/**/*.mjs"),
    "knip.jsonc must ignore lib/**/*.mjs while this test owns that class",
  );
});
