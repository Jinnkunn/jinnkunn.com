import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  parseMdxBlocks,
  serializeMdxBlocks,
} from "../apps/workspace/src/surfaces/site-admin/mdx-blocks.ts";

const ROOT = process.cwd();

function splitFrontmatter(source) {
  const match = /^---\n[\s\S]*?\n---\n?([\s\S]*)$/m.exec(source);
  return match ? match[1] : source;
}

function contentFixturePaths() {
  return ["content/posts", "content/pages"].flatMap((dir) => {
    const absDir = path.join(ROOT, dir);
    if (!fs.existsSync(absDir)) return [];
    return fs
      .readdirSync(absDir)
      .filter((filename) => filename.endsWith(".mdx") || filename.endsWith(".md"))
      .map((filename) => path.join(absDir, filename));
  });
}

test("mdx-blocks: current page and post bodies round-trip", () => {
  const fixtures = contentFixturePaths();
  assert.ok(fixtures.length > 0);

  for (const filePath of fixtures) {
    const body = splitFrontmatter(fs.readFileSync(filePath, "utf8")).trimStart();
    const expected = body.trim() ? (body.endsWith("\n") ? body : `${body}\n`) : "";
    assert.equal(
      serializeMdxBlocks(parseMdxBlocks(body)),
      expected,
      path.relative(ROOT, filePath),
    );
  }
});
