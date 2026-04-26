import test from "node:test";
import assert from "node:assert/strict";

import { normalizeHomeData } from "../lib/site-admin/home-normalize.ts";

// ----------------------------------------------------------------------------
// Home — single Notion-style MDX document. The legacy section-based
// schema (hero / richText / linkList / featuredPages / layout) was
// retired when the Notion-mode editor became the only authoring
// surface; `bodyMdx` is now the only content source.
// ----------------------------------------------------------------------------

const emptyHome = {
  schemaVersion: 4,
  title: "Hi there!",
};

test("normalizeHomeData: returns empty template for non-object input", () => {
  assert.deepEqual(normalizeHomeData(null), emptyHome);
  assert.deepEqual(normalizeHomeData(undefined), emptyHome);
  assert.deepEqual(normalizeHomeData("nope"), emptyHome);
  assert.deepEqual(normalizeHomeData(42), emptyHome);
});

test("normalizeHomeData: preserves a non-empty bodyMdx round-trip", () => {
  const result = normalizeHomeData({
    title: "T",
    bodyMdx: "# Hi\n\n<HeroBlock title=\"Welcome\" />\n",
  });
  assert.equal(
    result.bodyMdx,
    "# Hi\n\n<HeroBlock title=\"Welcome\" />\n",
  );
});

test("normalizeHomeData: drops blank/whitespace-only bodyMdx to undefined", () => {
  for (const value of ["", "   \n  ", undefined, null, 42]) {
    const result = normalizeHomeData({ title: "T", bodyMdx: value });
    assert.equal(
      result.bodyMdx,
      undefined,
      `expected undefined bodyMdx for ${JSON.stringify(value)}`,
    );
  }
});

test("normalizeHomeData: falls back to default title when blank or wrong type", () => {
  assert.equal(normalizeHomeData({ title: "   " }).title, "Hi there!");
  assert.equal(normalizeHomeData({ title: 123 }).title, "Hi there!");
});

test("normalizeHomeData: silently drops legacy section data", () => {
  // Older home.json files still load — the dropped sections data
  // disappears on the next save. Smoke-test that the loader doesn't
  // choke on unexpected fields.
  const result = normalizeHomeData({
    title: "T",
    bodyMdx: "body",
    sections: [{ id: "x", type: "hero" }],
    profileImageUrl: "/legacy.png",
  });
  assert.equal(result.title, "T");
  assert.equal(result.bodyMdx, "body");
  assert.ok(!("sections" in result));
  assert.ok(!("profileImageUrl" in result));
});

// News no longer has a normalize layer — entries live as `<NewsEntry>`
// blocks inside `content/pages/news.mdx` and round-trip through
// `apps/workspace/src/surfaces/site-admin/mdx-blocks.ts`. The
// equivalent newest-first sort + invalid-entry drop happen at render
// time inside `components/posts-mdx/news-block.tsx`.

// Publications migrated to inline `<PublicationsEntry data='...' />`
// blocks inside `content/pages/publications.mdx`. The DTO normalizer
// is gone; equivalent invariants live in the publications-entry round-
// trip tests in apps/workspace/src/surfaces/site-admin/mdx-blocks.test.ts.

// Teaching migrated to inline `<TeachingEntry>` blocks inside
// `content/pages/teaching.mdx`. Equivalent invariants live in the
// teaching-entry round-trip tests in
// apps/workspace/src/surfaces/site-admin/mdx-blocks.test.ts.

// ----------------------------------------------------------------------------
// Works migrated to inline `<WorksEntry>` blocks inside
// `content/pages/works.mdx`. Equivalent invariants live in the
// works-entry round-trip tests in
// apps/workspace/src/surfaces/site-admin/mdx-blocks.test.ts.
