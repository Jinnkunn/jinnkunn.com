import test from "node:test";
import assert from "node:assert/strict";

import {
  asRecordArray,
  isRecord,
  readBoolean,
  readNumber,
  readString,
  readStringField,
  readTrimmedString,
} from "../lib/notion/coerce.ts";

test("notion-coerce: isRecord rejects arrays/null and accepts plain objects", () => {
  assert.equal(isRecord(null), false);
  assert.equal(isRecord([]), false);
  assert.equal(isRecord({ a: 1 }), true);
});

test("notion-coerce: asRecordArray keeps only object entries", () => {
  const out = asRecordArray([null, 1, "x", { a: 1 }, ["y"], { b: 2 }]);
  assert.deepEqual(out, [{ a: 1 }, { b: 2 }]);
});

test("notion-coerce: string readers normalize and trim values", () => {
  assert.equal(readString(undefined), "");
  assert.equal(readString(123), "123");
  assert.equal(readTrimmedString("  hi  "), "hi");
  assert.equal(readStringField({ title: "  hello  " }, "title"), "hello");
  assert.equal(readStringField({ title: 42 }, "title"), "42");
  assert.equal(readStringField(null, "title"), "");
});

test("notion-coerce: readNumber/readBoolean enforce strict primitives", () => {
  assert.equal(readNumber(12), 12);
  assert.equal(readNumber(Number.NaN), null);
  assert.equal(readNumber("12"), null);

  assert.equal(readBoolean(true), true);
  assert.equal(readBoolean(false), false);
  assert.equal(readBoolean(1), null);
});
