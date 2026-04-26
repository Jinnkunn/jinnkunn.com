import test from "node:test";
import assert from "node:assert/strict";

import { normalizeHomeData } from "../lib/site-admin/home-normalize.ts";
import { normalizePublicationsData } from "../lib/site-admin/publications-normalize.ts";

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

// ----------------------------------------------------------------------------
// Publications
// ----------------------------------------------------------------------------

test("normalizePublicationsData: empty template for non-object input", () => {
  const out = normalizePublicationsData(null);
  assert.equal(out.title, "Publications");
  assert.deepEqual(out.profileLinks, []);
  assert.deepEqual(out.entries, []);
});

test("normalizePublicationsData: drops profile links missing label or href", () => {
  const out = normalizePublicationsData({
    profileLinks: [
      { label: "Scholar", href: "https://scholar.google.com" },
      { label: "", href: "https://example.com" },
      { label: "No URL", href: "" },
      { label: "Scholar" },
      null,
      "bad",
    ],
  });
  assert.equal(out.profileLinks.length, 1);
  assert.equal(out.profileLinks[0].label, "Scholar");
});

test("normalizePublicationsData: keeps hostname when string, strips otherwise", () => {
  const out = normalizePublicationsData({
    profileLinks: [
      { label: "A", href: "https://a.com", hostname: "a.com" },
      { label: "B", href: "https://b.com", hostname: 42 },
    ],
  });
  assert.equal(out.profileLinks[0].hostname, "a.com");
  assert.equal(out.profileLinks[1].hostname, undefined);
});

test("normalizePublicationsData: drops entries without title", () => {
  const out = normalizePublicationsData({
    entries: [
      { title: "Good paper", year: "2025", url: "", labels: [] },
      { title: "", year: "2025", url: "", labels: [] },
      { year: "2025" },
      null,
    ],
  });
  assert.equal(out.entries.length, 1);
  assert.equal(out.entries[0].title, "Good paper");
});

test("normalizePublicationsData: filters non-string label/author items", () => {
  const out = normalizePublicationsData({
    entries: [
      {
        title: "Paper",
        year: "2025",
        url: "",
        labels: ["conference", 42, null, "journal"],
        authors: ["A. Author", 0, "B. Author"],
        externalUrls: ["https://example.com", null, 123],
      },
    ],
  });
  assert.deepEqual(out.entries[0].labels, ["conference", "journal"]);
  assert.deepEqual(out.entries[0].authors, ["A. Author", "B. Author"]);
  assert.deepEqual(out.entries[0].externalUrls, ["https://example.com"]);
});

test("normalizePublicationsData: coerces authorsRich into {name,isSelf} entries", () => {
  const out = normalizePublicationsData({
    entries: [
      {
        title: "Paper",
        year: "2025",
        url: "",
        labels: [],
        authorsRich: [
          { name: "Jinkun Chen", isSelf: true },
          { name: "Collaborator", isSelf: false },
          { name: "", isSelf: true },
          { isSelf: true },
          null,
        ],
      },
    ],
  });
  assert.deepEqual(out.entries[0].authorsRich, [
    { name: "Jinkun Chen", isSelf: true },
    { name: "Collaborator", isSelf: false },
  ]);
});

test("normalizePublicationsData: keeps optional string fields (doi/arxiv/venue)", () => {
  const out = normalizePublicationsData({
    entries: [
      {
        title: "Paper",
        year: "2025",
        url: "",
        labels: [],
        doiUrl: "https://doi.org/...",
        arxivUrl: "https://arxiv.org/abs/...",
        venue: "NeurIPS 2025",
      },
    ],
  });
  assert.equal(out.entries[0].doiUrl, "https://doi.org/...");
  assert.equal(out.entries[0].arxivUrl, "https://arxiv.org/abs/...");
  assert.equal(out.entries[0].venue, "NeurIPS 2025");
});

// Teaching migrated to inline `<TeachingEntry>` blocks inside
// `content/pages/teaching.mdx`. Equivalent invariants live in the
// teaching-entry round-trip tests in
// apps/workspace/src/surfaces/site-admin/mdx-blocks.test.ts.

// ----------------------------------------------------------------------------
// Works migrated to inline `<WorksEntry>` blocks inside
// `content/pages/works.mdx`. Equivalent invariants live in the
// works-entry round-trip tests in
// apps/workspace/src/surfaces/site-admin/mdx-blocks.test.ts.
