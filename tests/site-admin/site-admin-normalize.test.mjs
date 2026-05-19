import test from "node:test";
import assert from "node:assert/strict";

import { normalizeHomeData } from "../../lib/site-admin/home-normalize.ts";
import {
  createNowData,
  deleteNowHistoryData,
  SiteAdminNowHistoryNotFoundError,
  updateNowHistoryData,
} from "../../lib/site-admin/now-commands.ts";
import { normalizeNowData } from "../../lib/site-admin/now-normalize.ts";

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

// ----------------------------------------------------------------------------
// Now — lightweight public status feed.
// ----------------------------------------------------------------------------

test("normalizeNowData: returns a lightweight fallback for invalid input", () => {
  assert.deepEqual(normalizeNowData(null), {
    current: { text: "Working quietly." },
    updates: [],
    links: [],
  });
});

test("normalizeNowData: trims current status and drops invalid update/link rows", () => {
  const result = normalizeNowData({
    current: {
      text: "  Drafting a tiny status.  ",
      context: "  Writing  ",
      location: "  Halifax  ",
      updatedAt: "  2026-05-16T20:00:00.000Z  ",
    },
    updates: [
      { id: "a", text: "  one  ", at: "  2026-05-16T20:00:00.000Z  " },
      { id: "missing-text", at: "2026-05-16T19:00:00.000Z" },
    ],
    links: [
      { label: "  Calendar  ", href: " /calendar " },
      { label: "", href: "/blog" },
    ],
  });

  assert.deepEqual(result.current, {
    text: "Drafting a tiny status.",
    context: "Writing",
    location: "Halifax",
    updatedAt: "2026-05-16T20:00:00.000Z",
  });
  assert.deepEqual(result.updates, [
    { id: "a", text: "one", at: "2026-05-16T20:00:00.000Z" },
  ]);
  assert.deepEqual(result.links, [{ label: "Calendar", href: "/calendar" }]);
});

test("now commands: create uses the selected date and writes a history row", () => {
  const now = new Date("2026-05-17T18:30:00.000Z");
  const result = createNowData({
    data: {
      current: { text: "Old", context: "Context", location: "Halifax" },
      updates: [],
      links: [],
    },
    text: "A tiny update.",
    context: { hasValue: false },
    location: { hasValue: false },
    date: "2026-05-15",
    now,
  });

  assert.equal(result.current.text, "A tiny update.");
  assert.equal(result.current.context, "Context");
  assert.equal(result.current.location, "Halifax");
  assert.equal(result.current.updatedAt, "2026-05-15T15:00:00.000Z");
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].text, "A tiny update.");
  assert.equal(result.updates[0].at, "2026-05-15T15:00:00.000Z");
});

test("now commands: create without date preserves the current instant", () => {
  const now = new Date("2026-05-17T18:30:00.123Z");
  const result = createNowData({
    data: { current: { text: "Old" }, updates: [], links: [] },
    text: "Live from today.",
    context: { hasValue: true, value: "" },
    location: { hasValue: true, value: "Dingle" },
    now,
  });

  assert.deepEqual(result.current, {
    text: "Live from today.",
    location: "Dingle",
    updatedAt: "2026-05-17T18:30:00.123Z",
  });
});

test("now commands: update history edits text/date and keeps the same id", () => {
  const data = {
    current: {
      text: "Current",
      updatedAt: "2026-05-18T00:25:20.115Z",
    },
    updates: [
      {
        id: "current-row",
        text: "Current",
        at: "2026-05-18T00:25:20.115Z",
      },
      {
        id: "trail-row",
        text: "Old trail",
        at: "2026-05-16T19:16:00-03:00",
      },
    ],
    links: [],
  };

  const result = updateNowHistoryData({
    data,
    id: "trail-row",
    text: "Edited trail",
    date: "2026-05-14",
  });

  const edited = result.updates.find((item) => item.id === "trail-row");
  assert.deepEqual(edited, {
    id: "trail-row",
    text: "Edited trail",
    at: "2026-05-14T22:16:00.000Z",
  });
  assert.equal(result.current.text, "Current");
});

test("now commands: delete history does not change current", () => {
  const result = deleteNowHistoryData({
    data: {
      current: {
        text: "Current",
        updatedAt: "2026-05-18T00:25:20.115Z",
      },
      updates: [
        {
          id: "current-row",
          text: "Current",
          at: "2026-05-18T00:25:20.115Z",
        },
        {
          id: "trail-row",
          text: "Trail",
          at: "2026-05-16T19:16:00-03:00",
        },
      ],
      links: [],
    },
    id: "current-row",
  });

  assert.deepEqual(result.current, {
    text: "Current",
    updatedAt: "2026-05-18T00:25:20.115Z",
  });
  assert.deepEqual(result.updates, [
    {
      id: "trail-row",
      text: "Trail",
      at: "2026-05-16T19:16:00-03:00",
    },
  ]);
});

test("now commands: missing history row throws a not found error", () => {
  assert.throws(
    () =>
      updateNowHistoryData({
        data: { current: { text: "Current" }, updates: [], links: [] },
        id: "missing",
        text: "Nope",
        date: "2026-05-14",
      }),
    SiteAdminNowHistoryNotFoundError,
  );
});
