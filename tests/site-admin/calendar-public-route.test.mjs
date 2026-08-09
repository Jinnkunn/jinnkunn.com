// Both calendar-public writers replace the whole projection. The file-backed
// endpoint only conflict-checked when the client happened to send a sha, and
// /live never checked at all — two publishers silently clobbered each other.
//
// The request parsers live in lib/site-admin/calendar-public-commands.ts so
// the "expectedFileSha is required" rule can be exercised for real; only the
// handler wiring (which can't be imported outside Next) is asserted on source.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  CALENDAR_PUBLIC_EXPECTED_SHA_REQUIRED,
  CALENDAR_PUBLIC_LIVE_EXPECTED_SHA_REQUIRED,
  parseSiteAdminCalendarPublicLiveSaveCommand,
  parseSiteAdminCalendarPublicSaveCommand,
} from "../../lib/site-admin/calendar-public-commands.ts";
import {
  normalizePublicCalendarData,
  publicCalendarJson,
} from "../../lib/shared/public-calendar.ts";
import {
  readPublicCalendarFromDb,
  writePublicCalendarToDb,
} from "../../lib/server/public-calendar-db.ts";

async function readSource(rel) {
  return readFile(new URL(`../../${rel}`, import.meta.url), "utf8");
}

const SAMPLE = {
  schemaVersion: 1,
  generatedAt: "2026-06-16T19:16:27.532Z",
  range: { startsAt: "2026-06-01T00:00:00.000Z", endsAt: "2026-07-01T00:00:00.000Z" },
  events: [
    {
      id: "evt-2",
      title: "Reading group",
      startsAt: "2026-06-20T13:00:00.000Z",
      endsAt: "2026-06-20T14:00:00.000Z",
      isAllDay: false,
      visibility: "full",
      colorHex: "#3B7FC4",
      description: "Chapter 4",
      location: "Room 210",
      url: "https://example.com/rg",
    },
    {
      id: "evt-1",
      title: "Office hours",
      startsAt: "2026-06-18T15:00:00.000Z",
      endsAt: "2026-06-18T16:00:00.000Z",
      isAllDay: false,
      visibility: "titleOnly",
    },
  ],
};

for (const [label, parse, message] of [
  [
    "calendar-public",
    parseSiteAdminCalendarPublicSaveCommand,
    CALENDAR_PUBLIC_EXPECTED_SHA_REQUIRED,
  ],
  [
    "calendar-public/live",
    parseSiteAdminCalendarPublicLiveSaveCommand,
    CALENDAR_PUBLIC_LIVE_EXPECTED_SHA_REQUIRED,
  ],
]) {
  test(`${label}: a body without expectedFileSha is rejected with 400`, () => {
    // This is exactly what the desktop bridge sends today.
    const parsed = parse({ data: SAMPLE });
    assert.equal(parsed.ok, false);
    assert.equal(parsed.status, 400);
    assert.equal(parsed.error, message);
    assert.match(parsed.error, /GET \/api\/site-admin\/calendar-public/);
  });

  test(`${label}: a non-string expectedFileSha is rejected too`, () => {
    for (const value of [null, 0, false, {}, ["sha"]]) {
      const parsed = parse({ data: SAMPLE, expectedFileSha: value });
      assert.equal(parsed.ok, false, JSON.stringify(value));
      assert.equal(parsed.status, 400);
    }
  });

  test(`${label}: "" is the legal first-write token`, () => {
    const parsed = parse({ data: SAMPLE, expectedFileSha: "  " });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.expectedFileSha, "");
    assert.equal(parsed.value.data.events.length, 2);
    // Normalised on the way in: sorted by start time.
    assert.equal(parsed.value.data.events[0].id, "evt-1");
  });

  test(`${label}: accepts a bare document alongside the token`, () => {
    const parsed = parse({ ...SAMPLE, expectedFileSha: "abc" });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.expectedFileSha, "abc");
    assert.equal(parsed.value.data.events.length, 2);
  });
}

test("calendar-public routes wire the shared parser and conflict checks", async () => {
  const fileRoute = await readSource("app/api/site-admin/calendar-public/route.ts");
  assert.match(fileRoute, /parseSiteAdminCalendarPublicSaveCommand/);
  // A 409 without the two shas leaves the caller with nothing to retry with.
  assert.match(fileRoute, /extras: \{ expectedSha: err\.expectedSha, currentSha: err\.currentSha \}/);

  const liveRoute = await readSource("app/api/site-admin/calendar-public/live/route.ts");
  assert.match(liveRoute, /parseSiteAdminCalendarPublicLiveSaveCommand/);
  assert.match(liveRoute, /live\.sourceVersion\.fileSha !== parsed\.value\.expectedFileSha/);
  assert.match(liveRoute, /code: "SOURCE_CONFLICT"/);
  // The conflict token has to be obtainable, so the endpoint reads too.
  assert.match(liveRoute, /export async function GET/);

  const service = await readSource("lib/server/site-admin-calendar-public-service.ts");
  assert.match(service, /expectedFileSha: string;/);
  assert.doesNotMatch(
    service,
    /expectedFileSha\?: string/,
    "an optional sha means an unchecked write",
  );
  assert.match(service, /export function publicCalendarSha/);
  assert.match(service, /export async function loadLiveSiteAdminPublicCalendarData/);
});

// --- /live conflict token: the real D1 round-trip -------------------------

/** `publicCalendarSha` from site-admin-calendar-public-service.ts — that
 * module is `server-only`, so mirror its one-line definition here and pin it
 * to the source below. */
function publicCalendarSha(data) {
  return createHash("sha1").update(publicCalendarJson(data), "utf8").digest("hex");
}

async function sqliteExecutor() {
  const db = new DatabaseSync(":memory:");
  db.exec(await readFile(new URL("../../migrations/003_calendar_public.sql", import.meta.url), "utf8"));
  return {
    async execute({ sql, args = [] }) {
      const statement = db.prepare(sql);
      if (/^\s*select/i.test(sql)) {
        return { rows: statement.all(...args), rowsAffected: 0 };
      }
      const result = statement.run(...args);
      return { rows: [], rowsAffected: Number(result.changes ?? 0) };
    },
  };
}

test("live conflict token survives the write -> read round-trip through D1", async () => {
  const executor = await sqliteExecutor();
  const data = normalizePublicCalendarData(SAMPLE);

  const write = await writePublicCalendarToDb(data, executor);
  assert.equal(write.ok, true);

  const readBack = await readPublicCalendarFromDb(executor);
  assert.ok(readBack);
  assert.equal(
    publicCalendarSha(readBack),
    publicCalendarSha(data),
    "a publish that changed nothing must not 409 the next publisher",
  );

  // Two consecutive reads agree — that is what the POST check compares.
  const again = await readPublicCalendarFromDb(executor);
  assert.equal(publicCalendarSha(again), publicCalendarSha(readBack));
});

test("live conflict token changes when the published projection changes", async () => {
  const executor = await sqliteExecutor();
  const first = normalizePublicCalendarData(SAMPLE);
  await writePublicCalendarToDb(first, executor);
  const beforeSha = publicCalendarSha(await readPublicCalendarFromDb(executor));

  const second = normalizePublicCalendarData({
    ...SAMPLE,
    events: [SAMPLE.events[0]],
  });
  await writePublicCalendarToDb(second, executor);
  const afterSha = publicCalendarSha(await readPublicCalendarFromDb(executor));

  assert.notEqual(afterSha, beforeSha, "a stale token must not still match");
  assert.equal(afterSha, publicCalendarSha(second));
});

test("live conflict token is '' before anything is published", async () => {
  const executor = await sqliteExecutor();
  assert.equal(await readPublicCalendarFromDb(executor), null);
});

test("publicCalendarSha in the service matches the definition tested here", async () => {
  const service = await readSource("lib/server/site-admin-calendar-public-service.ts");
  assert.match(
    service,
    /createHash\("sha1"\)\.update\(publicCalendarJson\(data\), "utf8"\)\.digest\("hex"\)/,
  );
});
