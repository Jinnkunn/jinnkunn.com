import test from "node:test";
import assert from "node:assert/strict";

import { compactId, normalizeRoutePath, slugify } from "../lib/shared/route-utils.mjs";

test("normalizeRoutePath()", () => {
  assert.equal(normalizeRoutePath(""), "");
  assert.equal(normalizeRoutePath("   "), "");
  assert.equal(normalizeRoutePath("/"), "/");
  assert.equal(normalizeRoutePath("foo"), "/foo");
  assert.equal(normalizeRoutePath("/foo/"), "/foo");
  assert.equal(normalizeRoutePath("/foo//"), "/foo");
  assert.equal(normalizeRoutePath(" /foo/bar/ "), "/foo/bar");
});

test("slugify()", () => {
  assert.equal(slugify("Hello, World!"), "hello-world");
  assert.equal(slugify("  Multi   Space  "), "multi-space");
  assert.equal(slugify("中文标题"), ""); // keep ASCII-only slugs
});

test("compactId()", () => {
  assert.equal(compactId(""), "");
  assert.equal(compactId("8d6dfeef-4c7f-4d67-8b48-99d2198877cb"), "8d6dfeef4c7f4d678b4899d2198877cb");
  assert.equal(
    compactId("https://www.notion.so/jinnkunn/Hi-there-8d6dfeef4c7f4d678b4899d2198877cb"),
    "8d6dfeef4c7f4d678b4899d2198877cb",
  );
});
