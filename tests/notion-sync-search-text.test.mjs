import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSearchTextFromLines,
  buildSearchIndexFieldsFromBlocks,
  extractHeadingTextFromBlocks,
  extractPlainTextFromBlocks,
} from "../scripts/notion-sync/search-text.mjs";

test("search-text: extracts rich text, table cells, and hydrated children", () => {
  const blocks = [
    {
      type: "paragraph",
      paragraph: { rich_text: [{ plain_text: "Hello   world" }] },
    },
    {
      type: "heading_1",
      heading_1: { rich_text: [{ plain_text: "Hello world" }] }, // duplicate
    },
    {
      type: "table_row",
      table_row: {
        cells: [[{ plain_text: "cell1" }], [{ plain_text: "cell2" }]],
      },
    },
    {
      type: "toggle",
      toggle: { rich_text: [{ plain_text: "Toggle" }] },
      __children: [
        {
          type: "paragraph",
          paragraph: { rich_text: [{ plain_text: "Child text" }] },
        },
      ],
    },
  ];

  const lines = extractPlainTextFromBlocks(blocks);
  const joined = buildSearchTextFromLines(lines);

  assert.match(joined, /Hello world/);
  assert.match(joined, /cell1/);
  assert.match(joined, /cell2/);
  assert.match(joined, /Toggle/);
  assert.match(joined, /Child text/);

  // de-duped (Hello world should only appear once)
  assert.equal(joined.split("\n").filter((l) => l === "Hello world").length, 1);
});

test("search-text: caps output size to keep index small", () => {
  const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`);
  const joined = buildSearchTextFromLines(lines);

  // line cap (<= 220)
  assert.ok(joined.split("\n").length <= 220);

  // char cap (<= 4500)
  assert.ok(joined.length <= 4500);
});

test("search-text: extractHeadingTextFromBlocks() finds headings only", () => {
  const blocks = [
    { type: "heading_2", heading_2: { rich_text: [{ plain_text: "H2" }] } },
    { type: "paragraph", paragraph: { rich_text: [{ plain_text: "P" }] } },
  ];
  const lines = extractHeadingTextFromBlocks(blocks);
  assert.deepEqual(lines, ["H2"]);
});

test("search-text: buildSearchIndexFieldsFromBlocks() returns headings + slim body", () => {
  const blocks = [
    { type: "heading_1", heading_1: { rich_text: [{ plain_text: "Title" }] } },
    { type: "code", code: { rich_text: [{ plain_text: "const x = 1;" }] } },
    { type: "table_row", table_row: { cells: [[{ plain_text: "cell1" }]] } },
    { type: "paragraph", paragraph: { rich_text: [{ plain_text: "Body text" }] } },
  ];
  const out = buildSearchIndexFieldsFromBlocks(blocks);
  assert.deepEqual(out.headings, ["Title"]);
  assert.match(out.text, /Body text/);
  // default is to omit code + table noise
  assert.doesNotMatch(out.text, /const x/);
  assert.doesNotMatch(out.text, /cell1/);
});
