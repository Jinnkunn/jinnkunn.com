import test from "node:test";
import assert from "node:assert/strict";

import { collectHeadings } from "../scripts/notion-sync/renderers/block-headings.mjs";

test("collectHeadings: collects nested headings in DFS order with normalized ids", () => {
  const blocks = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      type: "heading_2",
      heading_2: { rich_text: [{ plain_text: "Top Section" }] },
      __children: [
        {
          id: "22222222-2222-2222-2222-222222222222",
          type: "heading_3",
          heading_3: { rich_text: [{ plain_text: "Nested Section" }] },
        },
      ],
    },
    {
      id: "33333333-3333-3333-3333-333333333333",
      type: "paragraph",
      paragraph: { rich_text: [{ plain_text: "Not heading" }] },
    },
    {
      id: "44444444-4444-4444-4444-444444444444",
      type: "heading_1",
      heading_1: { rich_text: [{ plain_text: "Title" }] },
    },
  ];

  const actual = collectHeadings(blocks);
  assert.deepEqual(actual, [
    { id: "11111111111111111111111111111111", level: 2, text: "Top Section" },
    { id: "22222222222222222222222222222222", level: 3, text: "Nested Section" },
    { id: "44444444444444444444444444444444", level: 1, text: "Title" },
  ]);
});

test("collectHeadings: filters empty heading text", () => {
  const blocks = [
    {
      id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      type: "heading_2",
      heading_2: { rich_text: [{ plain_text: "   " }] },
    },
    {
      id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      type: "heading_2",
      heading_2: { rich_text: [{ plain_text: "Kept" }] },
    },
  ];

  const actual = collectHeadings(blocks);
  assert.deepEqual(actual, [{ id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", level: 2, text: "Kept" }]);
});

test("collectHeadings: accepts non-array input and keeps provided accumulator entries", () => {
  const initial = [{ id: "seed", level: 1, text: "seed" }];

  const emptyResult = collectHeadings(null, [...initial]);
  assert.deepEqual(emptyResult, initial);

  const actual = collectHeadings(
    [
      {
        id: "cccccccccccccccccccccccccccccccc",
        type: "heading_3",
        heading_3: { rich_text: [{ plain_text: "Tail" }] },
      },
    ],
    [...initial],
  );
  assert.deepEqual(actual, [
    { id: "seed", level: 1, text: "seed" },
    { id: "cccccccccccccccccccccccccccccccc", level: 3, text: "Tail" },
  ]);
});
