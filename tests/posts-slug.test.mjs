import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";

import {
  POST_SLUG_MAX_LENGTH,
  assertValidSlug,
  isValidSlug,
  slugifyTitle,
} from "../lib/posts/slug.ts";

test("posts-slug: accepts lowercase alphanumeric + internal dashes", () => {
  assert.equal(isValidSlug("hello-world"), true);
  assert.equal(isValidSlug("a"), true);
  assert.equal(isValidSlug("post-2026-04-23"), true);
});

test("posts-slug: rejects leading/trailing dashes, uppercase, and invalid chars", () => {
  assert.equal(isValidSlug("-bad"), false);
  assert.equal(isValidSlug("bad-"), false);
  assert.equal(isValidSlug("Hello"), false);
  assert.equal(isValidSlug("slash/bad"), false);
  assert.equal(isValidSlug("has space"), false);
  assert.equal(isValidSlug(""), false);
});

test("posts-slug: enforces length cap", () => {
  assert.equal(isValidSlug("a".repeat(POST_SLUG_MAX_LENGTH)), true);
  assert.equal(isValidSlug("a".repeat(POST_SLUG_MAX_LENGTH + 1)), false);
});

test("posts-slug: accepts existing content post filenames", () => {
  const postsDir = path.join(process.cwd(), "content", "posts");
  const files = fs.readdirSync(postsDir).filter((file) => file.endsWith(".mdx"));
  for (const file of files) {
    const slug = file.replace(/\.mdx$/, "");
    assert.equal(isValidSlug(slug), true, `${slug} should be a valid post slug`);
  }
});

test("posts-slug: assertValidSlug throws on invalid", () => {
  assert.throws(() => assertValidSlug("Bad Slug"));
  // valid should not throw
  assertValidSlug("good");
});

test("posts-slug: slugifyTitle converts titles to safe slugs", () => {
  assert.equal(slugifyTitle("Hello, World!"), "hello-world");
  assert.equal(slugifyTitle("  Multiple   spaces "), "multiple-spaces");
  assert.equal(slugifyTitle("包含中文"), "post");
  assert.equal(slugifyTitle(""), "post");
});

test("posts-slug: slugifyTitle caps at max chars", () => {
  const long = slugifyTitle("x".repeat(200));
  assert.ok(long.length <= POST_SLUG_MAX_LENGTH);
  assert.equal(isValidSlug(long), true);
});
