import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { collectHeadings, renderBlocks } from "../scripts/notion-sync/render-blocks.mjs";

function buildFixtureBlocks() {
  return [
    {
      id: "11111111111111111111111111111111",
      type: "heading_2",
      heading_2: { rich_text: [{ plain_text: "Section" }] },
    },
    {
      id: "22222222222222222222222222222222",
      type: "bulleted_list_item",
      bulleted_list_item: { rich_text: [{ plain_text: "One" }] },
    },
    {
      id: "33333333333333333333333333333333",
      type: "bulleted_list_item",
      bulleted_list_item: { rich_text: [{ plain_text: "Two" }] },
      __children: [
        {
          id: "44444444444444444444444444444444",
          type: "paragraph",
          paragraph: { rich_text: [{ plain_text: "Nested" }] },
        },
      ],
    },
    {
      id: "55555555555555555555555555555555",
      type: "numbered_list_item",
      numbered_list_item: { rich_text: [{ plain_text: "First" }] },
    },
    {
      id: "66666666666666666666666666666666",
      type: "toggle",
      toggle: { rich_text: [{ plain_text: "Toggle" }] },
      __children: [
        {
          id: "77777777777777777777777777777777",
          type: "heading_3",
          heading_3: { rich_text: [{ plain_text: "Deep" }] },
        },
      ],
    },
    {
      id: "88888888888888888888888888888888",
      type: "mystery_block",
      __children: [
        {
          id: "99999999999999999999999999999999",
          type: "table_row",
          table_row: { cells: [[{ plain_text: "A" }], [{ plain_text: "B" }]] },
        },
        {
          id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          type: "table_row",
          table_row: { cells: [[{ plain_text: "C" }], [{ plain_text: "D" }]] },
        },
      ],
    },
  ];
}

test("render-blocks: snapshot for grouped lists + fallback table rendering", async () => {
  const blocks = buildFixtureBlocks();
  const ctx = {
    routeByPageId: new Map(),
    dbById: new Map(),
  };
  const snapshot = {
    headings: collectHeadings(blocks),
    html: await renderBlocks(blocks, ctx),
  };

  const snapshotPath = path.join(
    process.cwd(),
    "tests",
    "fixtures",
    "notion-sync-render-blocks.snapshot.json",
  );
  const expected = fs.readFileSync(snapshotPath, "utf8");
  const actual = `${JSON.stringify(snapshot, null, 2)}\n`;
  assert.equal(actual, expected);
});
