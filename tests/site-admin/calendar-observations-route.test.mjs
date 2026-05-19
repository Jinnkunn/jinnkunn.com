import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("calendar observations route uses a calendar-specific body limit", async () => {
  const source = await readFile(
    new URL("../../app/api/site-admin/calendar-observations/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /CALENDAR_OBSERVATION_SYNC_MAX_BYTES = 4 \* 1024 \* 1024/);
  assert.match(source, /maxBytes: CALENDAR_OBSERVATION_SYNC_MAX_BYTES/);
});
