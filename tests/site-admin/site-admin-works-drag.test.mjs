import assert from "node:assert/strict";
import test from "node:test";

import { reorderWorksEntriesAcrossGroups } from "../../app/site-admin/site-admin-works-drag.ts";

function work(id, category) {
  return { id, category };
}

test("Works drag reorders entries and adopts the destination group", () => {
  const items = [
    work("recent-a", "recent"),
    work("recent-b", "recent"),
    work("past-a", "passed"),
    work("past-b", "passed"),
  ];

  const movedToPast = reorderWorksEntriesAcrossGroups(items, "recent-a", "past-a");
  assert.deepEqual(movedToPast.map((item) => item.id), [
    "recent-b",
    "recent-a",
    "past-a",
    "past-b",
  ]);
  assert.equal(movedToPast[1].category, "passed");

  const movedToRecent = reorderWorksEntriesAcrossGroups(
    movedToPast,
    "past-b",
    "recent-b",
  );
  assert.equal(movedToRecent[0].id, "past-b");
  assert.equal(movedToRecent[0].category, "recent");
});
