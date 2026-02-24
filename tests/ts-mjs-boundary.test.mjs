import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "lib", "components"];

const ALLOWED_FACADE_FILES = new Set();

async function listFilesRecursively(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFilesRecursively(abs)));
      continue;
    }
    out.push(abs);
  }
  return out;
}

function readMjsImportSpecifiers(source) {
  const specs = [];
  const importRe = /\bimport\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+\.mjs)["']/g;
  for (const match of source.matchAll(importRe)) specs.push(match[1]);
  return specs;
}

test("ts-mjs-boundary: only facade files may import .mjs", async () => {
  const violations = [];

  for (const relDir of SCAN_DIRS) {
    const absDir = path.join(ROOT, relDir);
    const files = await listFilesRecursively(absDir);
    for (const absFile of files) {
      if (!absFile.endsWith(".ts") && !absFile.endsWith(".tsx")) continue;
      const relFile = path.relative(ROOT, absFile).split(path.sep).join("/");
      const source = await fs.readFile(absFile, "utf8");
      const mjsImports = readMjsImportSpecifiers(source);
      if (!mjsImports.length) continue;
      if (ALLOWED_FACADE_FILES.has(relFile)) continue;
      violations.push(`${relFile} -> ${mjsImports.join(", ")}`);
    }
  }

  assert.deepEqual(violations, []);
});
