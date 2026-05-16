import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const UI_DIR = path.join(ROOT, "components/ui");
const COLOR_LITERAL_RE = /\brgba?\(|\bhsla?\(|#[0-9A-Fa-f]{3,8}\b/;

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFiles(abs)));
      continue;
    }
    out.push(abs);
  }
  return out;
}

test("design-system-primitives: shared UI primitives do not embed hardcoded color literals", async () => {
  const files = await listFiles(UI_DIR);
  const violations = [];

  for (const absFile of files) {
    if (!absFile.endsWith(".ts") && !absFile.endsWith(".tsx")) continue;
    const relFile = path.relative(ROOT, absFile).split(path.sep).join("/");
    const source = await fs.readFile(absFile, "utf8");
    if (COLOR_LITERAL_RE.test(source)) violations.push(relFile);
  }

  assert.deepEqual(violations, []);
});
