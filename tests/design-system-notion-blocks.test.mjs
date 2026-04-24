import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TARGET_FILE = "app/(classic)/notion-blocks.css";
const RAW_COLOR_RE = /\brgba?\(|\bhsla?\(|#[0-9A-Fa-f]{3,8}\b/;
const LEGACY_COLOR_VAR_RE = /var\(--color-/;

test("design-system-notion-blocks: phase D keeps notion-blocks on ds tokens", async () => {
  const source = await fs.readFile(path.join(ROOT, TARGET_FILE), "utf8");

  assert.doesNotMatch(source, RAW_COLOR_RE, "notion-blocks.css should not use raw color literals");
  assert.doesNotMatch(
    source,
    LEGACY_COLOR_VAR_RE,
    "notion-blocks.css should not depend on legacy --color-* variables",
  );

  assert.match(source, /\.notion-toggle__summary:focus-visible[\s\S]*var\(--ds-focus-ring\)/);
  assert.match(source, /\.notion-toggle__summary:active[\s\S]*var\(--ds-interactive-active\)/);
  assert.match(source, /\.notion-code__copy-button\[data-copied=\"true\"\][\s\S]*var\(--ds-warning-bg\)/);
  assert.match(source, /\.notion-code\s+\.token\.table-data[\s\S]*var\(--ds-text-primary\)/);
});
