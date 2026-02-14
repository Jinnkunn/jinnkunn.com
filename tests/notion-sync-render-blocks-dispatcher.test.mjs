import test from "node:test";
import assert from "node:assert/strict";

import { BLOCK_RENDERER_TYPES, renderBlocks } from "../scripts/notion-sync/render-blocks.mjs";

test("render-blocks dispatcher: exposes expected block type handlers", () => {
  const expected = [
    "paragraph",
    "heading_1",
    "heading_2",
    "heading_3",
    "toggle",
    "quote",
    "divider",
    "equation",
    "embed",
    "table_of_contents",
    "table",
    "image",
    "code",
    "callout",
    "column_list",
    "bulleted_list_item",
    "numbered_list_item",
    "child_database",
    "child_page",
  ];

  assert.deepEqual([...BLOCK_RENDERER_TYPES].sort(), expected.sort());
});

test("render-blocks dispatcher: unknown block with children falls back to unsupported wrapper", async () => {
  const blocks = [
    {
      id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      type: "unknown_type",
      __children: [
        {
          id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          type: "paragraph",
          paragraph: { rich_text: [{ plain_text: "child text" }] },
        },
      ],
    },
  ];

  const html = await renderBlocks(blocks, { routeByPageId: new Map(), dbById: new Map() });
  assert.match(html, /class="notion-unsupported"/);
  assert.match(html, /child text/);
});
