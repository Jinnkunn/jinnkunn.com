import test from "node:test";
import assert from "node:assert/strict";

import { canonicalizeBlogHrefsInHtml } from "../lib/routes/html-rewrite.mjs";

test("canonicalizeBlogHrefsInHtml rewrites quoted and unquoted internal blog list hrefs", () => {
  const input = [
    '<a href="/blog/list/hello">x</a>',
    "<a href='/blog/list/hello'>x</a>",
    "<a href=/blog/list/hello>x</a>",
    '<a href="/list/hello">x</a>',
    "<a href=/list/hello>x</a>",
    '<a href="/blog/list">x</a>',
    '<a href="/list">x</a>',
    '<a href="https://example.com/blog/list/hello">x</a>',
  ].join("\n");

  const out = canonicalizeBlogHrefsInHtml(input);
  assert.ok(out.includes('href="/blog/hello"'));
  assert.ok(out.includes("href='/blog/hello'"));
  assert.ok(out.includes("href=/blog/hello"));
  assert.ok(out.includes('href="/blog"'));
  assert.ok(out.includes('href="https://example.com/blog/list/hello"'));
});

