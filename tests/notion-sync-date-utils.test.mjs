import test from "node:test";
import assert from "node:assert/strict";

import {
  extractFirstDateProperty,
  formatDateLong,
  toDateIso,
} from "../scripts/notion-sync/date-utils.mjs";

test("notion-sync date-utils: toDateIso extracts yyyy-mm-dd prefix", () => {
  assert.equal(toDateIso("2025-01-05T14:22:33.000Z"), "2025-01-05");
  assert.equal(toDateIso("2025-12-31"), "2025-12-31");
  assert.equal(toDateIso(""), null);
  assert.equal(toDateIso("not-a-date"), null);
});

test("notion-sync date-utils: formatDateLong supports UTC output", () => {
  assert.equal(formatDateLong("2025-01-05", { timeZone: "UTC" }), "January 5, 2025");
  assert.equal(formatDateLong(""), null);
});

test("notion-sync date-utils: extractFirstDateProperty returns normalized shape", () => {
  const page = {
    properties: {
      Title: { type: "title" },
      Published: {
        type: "date",
        id: "abc",
        date: { start: "2026-02-14T12:00:00.000Z" },
      },
    },
  };

  const out = extractFirstDateProperty(page, { timeZone: "UTC" });
  assert.deepEqual(out, {
    name: "Published",
    id: "abc",
    start: "2026-02-14T12:00:00.000Z",
    iso: "2026-02-14",
    text: "February 14, 2026",
  });
});
