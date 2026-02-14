import test from "node:test";
import assert from "node:assert/strict";

import {
  parseNotionBlockArray,
  parseNotionDatabaseInfo,
  parseNotionDatabaseRef,
  parseNotionJsonCodeBlock,
  parseNotionPageLikeArray,
} from "../lib/notion/adapters.ts";

test("notion-adapters: array adapters keep only object entries", () => {
  const blocks = parseNotionBlockArray([null, 1, { id: "a" }, "x", { id: "b" }]);
  assert.deepEqual(blocks, [{ id: "a" }, { id: "b" }]);

  const pages = parseNotionPageLikeArray([{}, "x", { id: "p1" }]);
  assert.deepEqual(pages, [{}, { id: "p1" }]);
});

test("notion-adapters: parseNotionDatabaseRef enforces non-empty id", () => {
  assert.equal(parseNotionDatabaseRef(null), null);
  assert.equal(parseNotionDatabaseRef({ title: "X" }), null);
  assert.equal(parseNotionDatabaseRef({ id: "  " }), null);
  assert.deepEqual(parseNotionDatabaseRef({ id: " db1 ", title: "  Main  " }), {
    id: "db1",
    title: "Main",
  });
});

test("notion-adapters: parseNotionDatabaseInfo provides safe defaults", () => {
  assert.deepEqual(parseNotionDatabaseInfo(null), {
    id: "",
    title: "Database",
    lastEdited: "",
  });

  assert.deepEqual(
    parseNotionDatabaseInfo({ id: " db ", title: "  ", lastEdited: 123 }),
    {
      id: "db",
      title: "Database",
      lastEdited: "123",
    },
  );
});

test("notion-adapters: parseNotionJsonCodeBlock validates required fields", () => {
  assert.equal(parseNotionJsonCodeBlock(null), null);
  assert.equal(parseNotionJsonCodeBlock({ blockId: "b1", json: "" }), null);
  assert.equal(parseNotionJsonCodeBlock({ blockId: "", json: "{}" }), null);
  assert.deepEqual(parseNotionJsonCodeBlock({ blockId: " b1 ", json: "{}" }), {
    blockId: "b1",
    json: "{}",
  });
});
