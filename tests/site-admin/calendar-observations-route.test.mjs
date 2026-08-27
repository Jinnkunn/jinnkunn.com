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

test("calendar observations route exposes authenticated collector-scoped cleanup", async () => {
  const source = await readFile(
    new URL("../../app/api/site-admin/calendar-observations/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /export async function DELETE\(req: NextRequest\)/);
  assert.match(source, /withSiteAdminContext\([\s\S]*parseCalendarCollectorCleanupCommand/);
  assert.match(source, /cleanupCalendarCollectorObservations\(parsed\.value\)/);
  assert.match(source, /CALENDAR_OBSERVATION_CLEANUP_MAX_BYTES = 4 \* 1024/);
  assert.match(source, /calendar\.observations\.cleanup/);
  assert.match(source, /publishLiveAfterObservationMutation\([\s\S]*"cleanup"/);
});

test("calendar observations route mirrors successful syncs to Live", async () => {
  const source = await readFile(
    new URL("../../app/api/site-admin/calendar-observations/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /publishCalendarObservationsToLive/);
  assert.match(source, /publishLiveAfterObservationMutation\([\s\S]*"sync"/);
  assert.match(source, /LIVE_DB_WRITE_FAILED/);
  assert.match(source, /livePublish:/);
});
