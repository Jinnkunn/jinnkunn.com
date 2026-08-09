// The versions endpoint used a bespoke `[a-z0-9-]{1,80}` slug regex, which
// 400'd every post whose slug runs past 80 chars and every hierarchical page
// slug. These pin the path rules to the content types' own validators.

import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { normalizeSiteAdminVersionPath } from "../../lib/site-admin/version-path.ts";

test("version-path: accepts a post slug longer than 80 chars", () => {
  const slug = `a-very-long-post-slug-${"x".repeat(90)}`;
  assert.ok(slug.length > 80 && slug.length <= 120);
  const rel = `content/posts/${slug}.mdx`;
  assert.equal(normalizeSiteAdminVersionPath(rel), rel);
});

test("version-path: rejects a post slug past the 120-char limit", () => {
  const slug = "a".repeat(121);
  assert.equal(normalizeSiteAdminVersionPath(`content/posts/${slug}.mdx`), "");
});

test("version-path: accepts nested page slugs", () => {
  for (const slug of ["about", "docs/intro", "docs/api/v1/auth"]) {
    const rel = `content/pages/${slug}.mdx`;
    assert.equal(normalizeSiteAdminVersionPath(rel), rel, slug);
  }
});

test("version-path: rejects page slugs deeper than 4 levels", () => {
  assert.equal(normalizeSiteAdminVersionPath("content/pages/a/b/c/d/e.mdx"), "");
});

test("version-path: posts stay flat", () => {
  assert.equal(normalizeSiteAdminVersionPath("content/posts/a/b.mdx"), "");
});

test("version-path: components are limited to the registry", () => {
  assert.equal(
    normalizeSiteAdminVersionPath("content/components/news.mdx"),
    "content/components/news.mdx",
  );
  assert.equal(normalizeSiteAdminVersionPath("content/components/nope.mdx"), "");
});

test("version-path: structured content + rejections", () => {
  assert.equal(normalizeSiteAdminVersionPath("content/now.json"), "content/now.json");
  assert.equal(normalizeSiteAdminVersionPath("/content/home.json"), "content/home.json");
  assert.equal(normalizeSiteAdminVersionPath("content/../.env"), "");
  assert.equal(normalizeSiteAdminVersionPath("content/pages/../../secret.mdx"), "");
  assert.equal(normalizeSiteAdminVersionPath("content/posts/Upper.mdx"), "");
  assert.equal(normalizeSiteAdminVersionPath(42), "");
  assert.equal(normalizeSiteAdminVersionPath(""), "");
});

test("version-path: every checked-in post and page resolves", async () => {
  const root = process.cwd();
  for (const kind of ["posts", "pages"]) {
    const dir = path.join(root, "content", kind);
    const entries = await readdir(dir, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".mdx")) continue;
      const rel = path
        .relative(root, path.join(entry.parentPath ?? entry.path, entry.name))
        .split(path.sep)
        .join("/");
      assert.equal(
        normalizeSiteAdminVersionPath(rel),
        rel,
        `${rel} should have reachable version history`,
      );
    }
  }
});
