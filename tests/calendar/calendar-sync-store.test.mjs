import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";

import { compactBusyObservationInput, normalizeCalendarObservationSyncPayload } from "@jinnkunn/calendar-core/core";
import { buildPublicCalendarIcs } from "@jinnkunn/calendar-core/ics";
import {
  normalizePublicCalendarData,
  normalizePublicCalendarRuntimeData,
  selectPublicCalendarHydrationData,
  selectPublicCalendarRuntimeData,
} from "@jinnkunn/calendar-core/public";
import { readObservedPublicCalendarFromDb } from "../../lib/server/public-calendar-db.ts";
import { assertPublicCalendarFeeds } from "../../scripts/_lib/verify-public-calendar.mjs";
import {
  cleanupCalendarCollectorObservations,
  publishCalendarObservationsToLive,
  readCalendarPublicationStatus,
  readCalendarSyncHealth,
  writeCalendarObservationSync as writeNormalizedSync,
} from "../../lib/server/calendar-sync-store.ts";

function writeCalendarObservationSync(raw, executor) {
  return writeNormalizedSync(normalizeCalendarObservationSyncPayload(raw), executor);
}

async function makeCalendarSyncDb() {
  const client = createClient({ url: ":memory:" });
  for (const migration of [
    "003_calendar_public.sql",
    "007_calendar_observations.sql",
    "008_calendar_collector_cleanup.sql",
    "011_calendar_observation_revision.sql",
    "012_calendar_projection_exclusions.sql",
  ]) {
    const schema = await readFile(
      path.join(process.cwd(), "migrations", migration),
      "utf8",
    );
    await client.executeMultiple(schema);
  }
  return client;
}

test("a complete Docs snapshot supersedes only matching legacy occurrences, including the public fallback", async () => {
  const staging = await makeCalendarSyncDb();
  const live = await makeCalendarSyncDb();
  const range = { startsAt: "2026-11-18T00:00:00Z", endsAt: "2026-11-20T00:00:00Z" };
  const source = (id, externalSourceId = "same-account") => ({ id, provider: "apple", title: "Fixture", externalSourceId });
  const legacySource = source("workspace");
  const otherSource = source("different-account", "other-account");
  const currentSource = source("docs");
  const event = (calendarId, iCalUid, start, end, sourceId = legacySource.id) => ({
    sourceId, calendarId, iCalUid, title: `Private ${iCalUid}`, startsAt: `2026-11-18T${start}:00Z`, endsAt: `2026-11-18T${end}:00Z`,
  });
  const shifted = event("selected", "recurring", "10:00", "11:00");
  const cancelled = event("empty", "cancelled", "12:00", "13:00");
  const overlap = event("not-selected", "other", "10:30", "11:00");
  const separateAccount = event("empty", "account-event", "14:00", "15:00", otherSource.id);
  const replacement = event("selected", "recurring", "16:00", "17:00", currentSource.id);
  const legacy = {
    collector: { id: "tauri-macos:old", kind: "tauri-macos" },
    sources: [legacySource, otherSource], range, observedAt: "2026-11-17T20:00:00Z",
    observations: [shifted, cancelled, overlap, separateAccount],
  };
  const docs = {
    collector: { id: "electron-macos:new", kind: "tauri-macos" }, range,
    sources: [{ ...currentSource, syncScope: { completeCalendarIds: ["selected", "empty"] } }],
    syncMode: "snapshot", observedAt: "2026-11-17T21:00:00Z",
    observations: [compactBusyObservationInput({ ...replacement, notes: "Private fixture https://meeting.example.test/link" })],
  };
  const fallback = normalizePublicCalendarData({
    generatedAt: legacy.observedAt, range,
    events: [shifted, cancelled].map((item) => ({ ...item, id: item.iCalUid, visibility: "busy" })).concat({
      id: "curated", title: "Public event", startsAt: "2026-11-18T18:00:00Z", endsAt: "2026-11-18T19:00:00Z", visibility: "full",
    }),
  });
  const project = async (db) => selectPublicCalendarRuntimeData({ sourceData: fallback, observedData: await readObservedPublicCalendarFromDb(db) });
  assert.equal((await writeCalendarObservationSync(legacy, staging)).ok, true);
  const before = await project(staging);
  assert.ok(before.events.some(({ startsAt }) => startsAt.includes("T10:00")));
  assert.equal((await cleanupCalendarCollectorObservations({ collectorId: legacy.collector.id, range: {
    startsAt: cancelled.startsAt, endsAt: cancelled.endsAt,
  } }, staging)).ok, true);

  assert.equal((await writeCalendarObservationSync(docs, staging)).ok, true);
  const after = await project(staging);
  assert.deepEqual(after.events.map(({ startsAt }) => startsAt.slice(11, 16)), ["10:30", "14:00", "16:00", "18:00"]);
  assert.doesNotMatch(buildPublicCalendarIcs(after), /DTSTART:20261118T(?:1000|1200)00Z/);
  assert.doesNotMatch(JSON.stringify(after), /Private |completeCalendarIds|legacyExclusions/);
  const hydrated = selectPublicCalendarHydrationData({ currentData: before, refreshedData: normalizePublicCalendarRuntimeData(after) });
  assert.deepEqual(hydrated.events, after.events);

  const replay = { ...legacy, observedAt: "2026-11-17T22:00:00Z" };
  assert.equal((await writeCalendarObservationSync(replay, staging)).ok, true);
  assert.deepEqual((await project(staging)).events, after.events);
  const retired = await staging.execute("SELECT COUNT(*) AS count FROM calendar_event_observations WHERE deleted_at IS NULL");
  assert.equal(retired.rows[0].count, 5, "legacy observations are retained; only the published view changes");
  const narrowed = await writeCalendarObservationSync({ ...docs, observedAt: "2026-11-17T23:00:00Z", range: { ...range, startsAt: "2026-11-18T15:00:00Z" } }, staging);
  assert.equal(narrowed.ok, true);
  assert.deepEqual((await project(staging)).events, after.events, "rolling the window does not revive already superseded copies");

  const mirrored = await publishCalendarObservationsToLive(staging, live);
  assert.equal(mirrored.ok, true);
  const liveProjection = await project(live);
  assert.deepEqual(liveProjection.events, after.events);
  const revision = String(liveProjection.observationSnapshot.revision);
  const verifiedAt = liveProjection.observationSnapshot.verifiedAt;
  assert.ok(verifiedAt);
  assert.deepEqual(assertPublicCalendarFeeds({
    json: JSON.parse(JSON.stringify(liveProjection)), ics: buildPublicCalendarIcs(liveProjection),
    jsonRevision: revision, icsRevision: revision, jsonVerifiedAt: verifiedAt, icsVerifiedAt: verifiedAt,
  }), { revision: Number(revision), events: 4, busy: 3, verifiedAt });
  staging.close();
  live.close();
});

test("a Docs snapshot cannot infer that an omitted calendar was read or overwrite a newer complete snapshot", async () => {
  const client = await makeCalendarSyncDb();
  const range = { startsAt: "2026-11-18T00:00:00Z", endsAt: "2026-11-19T00:00:00Z" };
  const snapshot = {
    collector: { id: "electron-macos:sample", kind: "tauri-macos" }, range,
    sources: [{ id: "docs", provider: "apple", title: "Fixture", externalSourceId: "source", syncScope: { completeCalendarIds: ["one", "two"] } }],
    syncMode: "snapshot", observedAt: "2026-11-17T15:00:00Z",
    observations: [{ sourceId: "docs", calendarId: "two", iCalUid: "held", startsAt: "2026-11-18T16:00:00Z", endsAt: "2026-11-18T17:00:00Z" }],
  };
  assert.equal((await writeCalendarObservationSync(snapshot, client)).ok, true);
  const second = { ...snapshot, observedAt: "2026-11-17T16:00:00Z", observations: [],
    sources: [{ ...snapshot.sources[0], syncScope: { completeCalendarIds: ["one"] } }] };
  assert.throws(() => normalizeCalendarObservationSyncPayload({ ...second, observations: snapshot.observations }), /Invalid complete calendar snapshot/);
  assert.throws(() => normalizeCalendarObservationSyncPayload({ ...second, collector: { id: "ios:phone", kind: "ios" } }), /Invalid complete calendar snapshot/);
  assert.throws(() => normalizeCalendarObservationSyncPayload({ ...second, observations: [{ ...snapshot.observations[0], endsAt: "invalid" }] }), /Invalid complete calendar snapshot/);
  assert.equal((await writeCalendarObservationSync(second, client)).ok, true);
  assert.equal((await readObservedPublicCalendarFromDb(client)).events.length, 1);
  assert.equal((await writeCalendarObservationSync(snapshot, client)).ok, false);
  client.close();
});

test("calendar-sync-store: collector cleanup index migration is applied", async () => {
  const client = await makeCalendarSyncDb();
  const indexes = await client.execute({
    sql: `SELECT name FROM sqlite_master
          WHERE type = 'index' AND name = ?`,
    args: ["idx_calendar_event_observations_collector_range"],
  });
  assert.deepEqual(indexes.rows, [
    { name: "idx_calendar_event_observations_collector_range" },
  ]);
});

test("calendar-sync-store: writes observations and deduped entities", async () => {
  const client = await makeCalendarSyncDb();
  const result = await writeCalendarObservationSync(
    {
      collector: { id: "ios:phone", kind: "ios" },
      sources: [
        { id: "icloud", provider: "apple", title: "iCloud" },
        { id: "mac-icloud", provider: "apple", title: "iCloud on Mac" },
      ],
      range: {
        startsAt: "2026-05-17T00:00:00Z",
        endsAt: "2026-05-18T00:00:00Z",
      },
      observations: [
        {
          sourceId: "icloud",
          sourceEventId: "ios-event",
          iCalUid: "shared-uid",
          title: "Jinkun, Vlado meeting",
          startsAt: "2026-05-17T14:00:00Z",
          endsAt: "2026-05-17T15:00:00Z",
        },
        {
          sourceId: "mac-icloud",
          sourceEventId: "mac-event",
          iCalUid: "shared-uid",
          title: "Jinkun, Vlado meeting",
          startsAt: "2026-05-17T14:00:00Z",
          endsAt: "2026-05-17T15:00:00Z",
        },
      ],
    },
    client,
  );

  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.observationsWritten, 2);
  assert.equal(result.entitiesWritten, 1);

  const health = await readCalendarSyncHealth(client);
  assert.ok(health);
  assert.equal(health.entityCount, 1);
  assert.equal(health.sources.length, 2);
});

test("calendar-sync-store: batches writes under D1 SQL variable limit", async () => {
  const client = await makeCalendarSyncDb();
  const maxVariables = 90;
  let requests = 0;
  const limitedExecutor = {
    async batch(statements) {
      requests++;
      for (const { args = [] } of statements) {
        assert.ok(args.length <= maxVariables, `expected <=${maxVariables} SQL variables, got ${args.length}`);
      }
      return client.batch(statements);
    },
  };
  const sources = Array.from({ length: 12 }, (_, index) => ({
    id: `source-${index}`,
    provider: "apple",
    title: `Calendar ${index}`,
  }));
  const observations = Array.from({ length: 25 }, (_, index) => {
    const startsAt = new Date(Date.UTC(2026, 4, 17, index, 0, 0));
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
    return {
      sourceId: sources[index % sources.length].id,
      sourceEventId: `event-${index}`,
      title: `Private event ${index}`,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    };
  });

  const result = await writeCalendarObservationSync(
    {
      collector: { id: "ios:phone", kind: "ios" },
      sources,
      range: {
        startsAt: "2026-05-17T00:00:00Z",
        endsAt: "2026-05-20T00:00:00Z",
      },
      observedAt: "2026-05-17T12:00:00.000Z",
      observations,
    },
    limitedExecutor,
  );

  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.observationsWritten, observations.length);
  assert.equal(requests, 2);
});

test("calendar-sync-store: snapshot stale deletion is scoped to collector and range", async () => {
  const client = await makeCalendarSyncDb();
  await writeCalendarObservationSync(
    {
      collector: { id: "mac-a", kind: "tauri-macos" },
      sources: [
        { id: "mac-a:google", provider: "google", title: "Google" },
        { id: "mac-a:outlook", provider: "outlook", title: "Outlook" },
      ],
      range: {
        startsAt: "2026-05-17T00:00:00Z",
        endsAt: "2026-05-20T00:00:00Z",
      },
      observations: [
        {
          sourceId: "mac-a:google",
          sourceEventId: "a-google-kept",
          title: "Google meeting",
          startsAt: "2026-05-17T14:00:00Z",
          endsAt: "2026-05-17T15:00:00Z",
        },
        {
          sourceId: "mac-a:outlook",
          sourceEventId: "a-outlook-stale",
          title: "Outlook meeting",
          startsAt: "2026-05-17T16:00:00Z",
          endsAt: "2026-05-17T17:00:00Z",
        },
        {
          sourceId: "mac-a:outlook",
          sourceEventId: "a-outside-range",
          title: "Later Outlook meeting",
          startsAt: "2026-05-19T16:00:00Z",
          endsAt: "2026-05-19T17:00:00Z",
        },
      ],
    },
    client,
  );

  await writeCalendarObservationSync(
    {
      collector: { id: "mac-b", kind: "tauri-macos" },
      sources: [
        { id: "mac-a:outlook", provider: "outlook", title: "Outlook B" },
      ],
      range: {
        startsAt: "2026-05-17T00:00:00Z",
        endsAt: "2026-05-18T00:00:00Z",
      },
      observations: [
        {
          sourceId: "mac-a:outlook",
          sourceEventId: "b-outlook-kept",
          title: "Other collector meeting",
          startsAt: "2026-05-17T18:00:00Z",
          endsAt: "2026-05-17T19:00:00Z",
        },
      ],
    },
    client,
  );

  const result = await writeCalendarObservationSync(
    {
      collector: { id: "mac-a", kind: "tauri-macos" },
      sources: [{ id: "mac-a:google", provider: "google", title: "Google" }],
      range: {
        startsAt: "2026-05-17T00:00:00Z",
        endsAt: "2026-05-18T00:00:00Z",
      },
      observations: [
        {
          sourceId: "mac-a:google",
          sourceEventId: "a-google-kept",
          title: "Google meeting",
          startsAt: "2026-05-17T14:00:00Z",
          endsAt: "2026-05-17T15:00:00Z",
        },
      ],
    },
    client,
  );

  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.staleObservations, 1);

  const firstPass = await client.execute({
    sql: `SELECT collector_id, source_event_id, deleted_at
          FROM calendar_event_observations
          ORDER BY source_event_id ASC`,
  });
  assert.deepEqual(firstPass.rows, [
    {
      collector_id: "mac-a",
      source_event_id: "a-google-kept",
      deleted_at: null,
    },
    {
      collector_id: "mac-a",
      source_event_id: "a-outlook-stale",
      deleted_at: firstPass.rows[1].deleted_at,
    },
    {
      collector_id: "mac-a",
      source_event_id: "a-outside-range",
      deleted_at: null,
    },
    {
      collector_id: "mac-b",
      source_event_id: "b-outlook-kept",
      deleted_at: null,
    },
  ]);
  assert.equal(typeof firstPass.rows[1].deleted_at, "string");

  const emptySnapshot = await writeCalendarObservationSync(
    {
      collector: { id: "mac-a", kind: "tauri-macos" },
      sources: [],
      range: {
        startsAt: "2026-05-17T00:00:00Z",
        endsAt: "2026-05-18T00:00:00Z",
      },
      observations: [],
    },
    client,
  );
  assert.equal(emptySnapshot.staleObservations, 1);

  const incremental = await writeCalendarObservationSync(
    {
      collector: { id: "mac-b", kind: "tauri-macos" },
      syncMode: "incremental",
      sources: [],
      range: {
        startsAt: "2026-05-17T00:00:00Z",
        endsAt: "2026-05-18T00:00:00Z",
      },
      observations: [],
    },
    client,
  );
  assert.equal(incremental.staleObservations, 0);

  const active = await client.execute({
    sql: `SELECT collector_id, source_event_id
          FROM calendar_event_observations
          WHERE deleted_at IS NULL
          ORDER BY source_event_id ASC`,
  });
  assert.deepEqual(active.rows, [
    { collector_id: "mac-a", source_event_id: "a-outside-range" },
    { collector_id: "mac-b", source_event_id: "b-outlook-kept" },
  ]);
});

test("calendar-sync-store: collector cleanup is scoped, range-aware, and idempotent", async () => {
  const client = await makeCalendarSyncDb();
  const source = { id: "eventkit:icloud", provider: "apple", title: "iCloud" };
  await writeCalendarObservationSync(
    {
      collector: { id: "mac-a", kind: "tauri-macos" },
      sources: [source],
      range: {
        startsAt: "2026-05-17T00:00:00Z",
        endsAt: "2026-05-20T00:00:00Z",
      },
      observations: [
        {
          sourceId: source.id,
          sourceEventId: "a-clean-now",
          title: "A inside cleanup range",
          startsAt: "2026-05-17T14:00:00Z",
          endsAt: "2026-05-17T15:00:00Z",
        },
        {
          sourceId: source.id,
          sourceEventId: "a-keep-for-now",
          title: "A outside cleanup range",
          startsAt: "2026-05-19T14:00:00Z",
          endsAt: "2026-05-19T15:00:00Z",
        },
      ],
    },
    client,
  );
  await writeCalendarObservationSync(
    {
      collector: { id: "mac-b", kind: "tauri-macos" },
      sources: [source],
      range: {
        startsAt: "2026-05-17T00:00:00Z",
        endsAt: "2026-05-20T00:00:00Z",
      },
      observations: [
        {
          sourceId: source.id,
          sourceEventId: "b-never-touch",
          title: "Other collector",
          startsAt: "2026-05-17T16:00:00Z",
          endsAt: "2026-05-17T17:00:00Z",
        },
      ],
    },
    client,
  );

  const firstCleanup = await cleanupCalendarCollectorObservations(
    {
      collectorId: "mac-a",
      range: {
        startsAt: "2026-05-17T00:00:00.000Z",
        endsAt: "2026-05-18T00:00:00.000Z",
      },
    },
    client,
  );
  assert.equal(firstCleanup.ok, true);
  assert.equal(firstCleanup.skipped, false);
  assert.equal(firstCleanup.tombstonedObservations, 1);

  const afterRangeCleanup = await client.execute({
    sql: `SELECT collector_id, source_event_id, deleted_at
          FROM calendar_event_observations
          ORDER BY source_event_id ASC`,
  });
  assert.equal(typeof afterRangeCleanup.rows[0].deleted_at, "string");
  assert.deepEqual(afterRangeCleanup.rows.slice(1), [
    {
      collector_id: "mac-a",
      source_event_id: "a-keep-for-now",
      deleted_at: null,
    },
    {
      collector_id: "mac-b",
      source_event_id: "b-never-touch",
      deleted_at: null,
    },
  ]);

  const repeatedCleanup = await cleanupCalendarCollectorObservations(
    {
      collectorId: "mac-a",
      range: {
        startsAt: "2026-05-17T00:00:00.000Z",
        endsAt: "2026-05-18T00:00:00.000Z",
      },
    },
    client,
  );
  assert.equal(repeatedCleanup.ok, true);
  assert.equal(repeatedCleanup.skipped, false);
  assert.equal(repeatedCleanup.tombstonedObservations, 0);

  const fullCleanup = await cleanupCalendarCollectorObservations(
    { collectorId: "mac-a" },
    client,
  );
  assert.equal(fullCleanup.ok, true);
  assert.equal(fullCleanup.skipped, false);
  assert.equal(fullCleanup.tombstonedObservations, 1);

  const remaining = await client.execute({
    sql: `SELECT collector_id, source_event_id
          FROM calendar_event_observations
          WHERE deleted_at IS NULL`,
  });
  assert.deepEqual(remaining.rows, [
    { collector_id: "mac-b", source_event_id: "b-never-touch" },
  ]);
  const entities = await client.execute({
    sql: "SELECT COUNT(*) AS count FROM calendar_event_entities",
  });
  assert.equal(Number(entities.rows[0].count), 1);

  const states = await client.execute({
    sql: `SELECT collector_id, event_count
          FROM calendar_sync_state
          WHERE source_id = ?
          ORDER BY collector_id ASC`,
    args: [source.id],
  });
  assert.deepEqual(states.rows, [
    { collector_id: "mac-a", event_count: 0 },
    { collector_id: "mac-b", event_count: 1 },
  ]);
});

test("calendar-sync-store: cleanup repairs a legacy tombstone with a stale entity", async () => {
  const client = await makeCalendarSyncDb();
  await writeCalendarObservationSync(
    {
      collector: { id: "mac-retry", kind: "tauri-macos" },
      sources: [{ id: "eventkit:retry", provider: "apple", title: "Retry" }],
      range: {
        startsAt: "2026-05-17T00:00:00Z",
        endsAt: "2026-05-18T00:00:00Z",
      },
      observations: [
        {
          sourceId: "eventkit:retry",
          sourceEventId: "retry-event",
          title: "Retry cleanup",
          startsAt: "2026-05-17T14:00:00Z",
          endsAt: "2026-05-17T15:00:00Z",
        },
      ],
    },
    client,
  );

  await client.execute({
    sql: "UPDATE calendar_event_observations SET deleted_at = ? WHERE collector_id = ?",
    args: ["2026-05-17T22:00:00.000Z", "mac-retry"],
  });
  const staleEntities = await client.execute({
    sql: "SELECT COUNT(*) AS count FROM calendar_event_entities",
  });
  assert.equal(Number(staleEntities.rows[0].count), 1);

  const retried = await cleanupCalendarCollectorObservations(
    { collectorId: "mac-retry" },
    client,
  );
  assert.equal(retried.ok, true);
  assert.equal(retried.skipped, false);
  assert.equal(retried.tombstonedObservations, 0);
  const repairedEntities = await client.execute({
    sql: "SELECT COUNT(*) AS count FROM calendar_event_entities",
  });
  assert.equal(Number(repairedEntities.rows[0].count), 0);
});

test("calendar-sync-store: publishes only observation tables to live", async () => {
  const source = await makeCalendarSyncDb();
  const target = await makeCalendarSyncDb();
  await target.execute(
    "CREATE TABLE content_files (path TEXT PRIMARY KEY, content TEXT NOT NULL)",
  );
  await target.execute({
    sql: "INSERT INTO content_files (path, content) VALUES (?, ?)",
    args: ["content/home.json", "untouched"],
  });

  await writeCalendarObservationSync(
    {
      collector: { id: "ios", kind: "ios" },
      sources: [{ id: "icloud", provider: "apple", title: "iCloud" }],
      range: {
        startsAt: "2026-05-17T00:00:00Z",
        endsAt: "2026-05-18T00:00:00Z",
      },
      observedAt: "2026-05-17T12:00:00.000Z",
      observations: [
        {
          sourceId: "icloud",
          sourceEventId: "ios-event",
          title: "Private event",
          startsAt: "2026-05-17T14:00:00Z",
          endsAt: "2026-05-17T15:00:00Z",
        },
      ],
    },
    source,
  );
  await target.execute({
    sql: `INSERT INTO calendar_sync_sources
          (id, provider, title, collector_id, sync_scope_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: ["stale", "apple", "Stale", "old", "{}", 1, 1],
  });

  const result = await publishCalendarObservationsToLive(source, target);

  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.rowsWritten > 0, true);

  const liveHealth = await readCalendarSyncHealth(target);
  assert.ok(liveHealth);
  assert.equal(liveHealth.sources.length, 1);
  assert.equal(liveHealth.sources[0].id, "icloud");
  assert.equal(liveHealth.entityCount, 1);

  const content = await target.execute({
    sql: "SELECT content FROM content_files WHERE path = ?",
    args: ["content/home.json"],
  });
  assert.equal(content.rows[0].content, "untouched");
});

function snapshot(collectorId, count, offset = 0) {
  const start = Date.UTC(2026, 4, 17);
  const sources = Array.from({ length: 10 }, (_, index) => ({
    id: `${collectorId}:${index}`, provider: "apple", title: `Synthetic calendar ${index}`,
  }));
  return {
    collector: { id: collectorId, kind: "tauri-macos" },
    sources,
    range: {
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + 31 * 24 * 60 * 60_000).toISOString(),
    },
    observations: Array.from({ length: count }, (_, index) => {
      const startsAt = start + (index + offset) * 45 * 60_000;
      return {
        sourceId: sources[index % sources.length].id,
        sourceEventId: `${collectorId}:event-${index + offset}`,
        title: `Private fixture ${index}`,
        notes: "Private fixture notes",
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(startsAt + 30 * 60_000).toISOString(),
      };
    }),
  };
}

async function eventCount(client) {
  const { rows } = await client.execute("SELECT COUNT(*) AS count FROM calendar_event_entities");
  return Number(rows[0].count);
}

async function revision(client) {
  const { rows } = await client.execute("SELECT revision FROM calendar_observation_revision WHERE id = 1");
  return Number(rows[0].revision);
}

test("calendar-sync-store: publication receipts distinguish another collector from this Mac", async () => {
  const staging = await makeCalendarSyncDb();
  const live = await makeCalendarSyncDb();
  const databases = { staging, live };
  const first = { ...snapshot("this-mac", 1), observedAt: "2026-05-18T00:00:00Z" };
  const result = await writeCalendarObservationSync(first, staging);
  const pending = await readCalendarPublicationStatus("this-mac", databases);
  assert.equal(pending.staging.revision, result.revision);
  assert.equal(pending.staging.collectorSyncedAt, "2026-05-18T00:00:00.000Z");
  assert.deepEqual(pending.live, { revision: 0, updatedAt: null, collectorSyncedAt: null });

  assert.equal((await publishCalendarObservationsToLive(staging, live)).ok, true);
  const second = await writeCalendarObservationSync(snapshot("other-device", 1, 5), staging);
  const anotherCollectorPending = await readCalendarPublicationStatus("this-mac", databases);
  assert.equal(anotherCollectorPending.staging.revision, second.revision);
  assert.equal(anotherCollectorPending.live.revision, result.revision);
  assert.equal(anotherCollectorPending.live.collectorSyncedAt, pending.staging.collectorSyncedAt);
});

test("calendar-sync-store: move and remove Busy in open pages and ICS without dropping manual blocks", async () => {
  const staging = await makeCalendarSyncDb();
  const live = await makeCalendarSyncDb();
  const payload = snapshot("synthetic-qa", 1);
  payload.observedAt = "2026-05-18T00:00:00Z";
  const manual = normalizePublicCalendarData({
    ...payload,
    generatedAt: payload.observedAt,
    events: [{
      id: "manual-busy",
      title: "Busy",
      startsAt: "2026-05-16T23:45:00Z",
      endsAt: "2026-05-17T00:00:00Z",
      visibility: "busy",
    }],
  });
  const projected = async () => normalizePublicCalendarRuntimeData(JSON.parse(JSON.stringify(
    selectPublicCalendarRuntimeData({
      dbData: null,
      sourceData: manual,
      observedData: await readObservedPublicCalendarFromDb(live),
    }),
  )));
  const publish = async (snapshotValue) => {
    assert.equal((await writeCalendarObservationSync(snapshotValue, staging)).ok, true);
    assert.equal((await publishCalendarObservationsToLive(staging, live)).ok, true);
  };
  await publish(payload);
  const first = await projected();
  assert.equal(first.events.length, 1);
  assert.ok(first.events[0].id.startsWith("manual-busy+"));
  assert.deepEqual(first.observationSnapshot.eventIds, [first.events[0].id]);
  assert.match(buildPublicCalendarIcs(first), /DTEND:20260517T003000Z/);

  const moved = snapshot("synthetic-qa", 1, 5);
  moved.observations[0].sourceEventId = payload.observations[0].sourceEventId;
  moved.observedAt = "2026-05-18T00:01:00Z";
  moved.observations[0].notes = "Unneeded private note https://meet.example.test/fixture";
  await publish({ ...moved, observations: moved.observations.map(compactBusyObservationInput) });
  const changed = await projected();
  assert.doesNotMatch(JSON.stringify(changed), /Unneeded private note|meet\.example\.test/);
  const afterMove = selectPublicCalendarHydrationData({ currentData: first, refreshedData: changed });
  assert.equal(afterMove.events.length, 2);
  assert.ok(!afterMove.events.some(({ id }) => id === first.events[0].id));
  assert.doesNotMatch(buildPublicCalendarIcs(changed), /DTEND:20260517T003000Z/);

  await publish({ ...moved, observations: [], observedAt: "2026-05-18T00:02:00Z" });
  const afterDeletion = await projected();
  const openPage = selectPublicCalendarHydrationData({ currentData: afterMove, refreshedData: afterDeletion });
  assert.deepEqual(openPage.events.map(({ id }) => id), ["manual-busy"]);
  assert.deepEqual(openPage.observationSnapshot.eventIds, []);
  assert.equal((buildPublicCalendarIcs(afterDeletion).match(/SUMMARY:Busy/g) ?? []).length, 1);
  assert.equal(selectPublicCalendarHydrationData({ currentData: openPage, refreshedData: first }), openPage);
  const unverified = normalizePublicCalendarData({ ...first, generatedAt: "2026-05-19T00:00:00Z" });
  assert.equal(selectPublicCalendarHydrationData({ currentData: openPage, refreshedData: unverified }), openPage);
});

test("calendar-sync-store: 420 observations sync and clean up below the D1 request cap", async () => {
  const source = await makeCalendarSyncDb();
  const target = await makeCalendarSyncDb();
  let requests = 0;
  let largestBatch = 0;
  function capped(client) {
    return {
      execute() { throw new Error("Calendar mutation bypassed D1 batch"); },
      async batch(statements) {
        assert.ok(++requests <= 50, "D1 invocation limit exceeded");
        largestBatch = Math.max(largestBatch, statements.length);
        assert.ok(statements.every(({ args = [] }) => args.length <= 90));
        return client.batch(statements);
      },
    };
  }
  const staged = capped(source);
  const live = capped(target);
  const result = await writeCalendarObservationSync(snapshot("large", 420), staged);
  assert.equal(result.entitiesWritten, 420);
  const published = await publishCalendarObservationsToLive(staged, live, result.revision);
  assert.equal(published.ok, true, JSON.stringify(published));
  assert.equal(requests, 5);
  assert.ok(largestBatch > 50);
  assert.equal(await revision(target), await revision(source));

  const data = await readObservedPublicCalendarFromDb(target);
  assert.equal(data.events.length, 420);
  assert.ok(data.events.every((event) => event.title === "Busy" && event.description === null));
  const repeated = await publishCalendarObservationsToLive(staged, live);
  assert.equal(repeated.rowsWritten, 0);
  assert.equal(repeated.rowsDeleted, 0);
  assert.equal(repeated.publishedAt, published.publishedAt);

  requests = 0;
  const cleanup = await cleanupCalendarCollectorObservations({ collectorId: "large" }, staged);
  assert.equal(cleanup.tombstonedObservations, 420);
  const cleaned = await publishCalendarObservationsToLive(staged, live);
  assert.equal(cleaned.rowsDeleted, 420);
  assert.equal(requests, 6);
  assert.equal(await eventCount(target), 0);
  assert.equal(await revision(target), await revision(source));
});

test("calendar-sync-store: staging and Live roll back independently and Live can be retried", async () => {
  const source = await makeCalendarSyncDb();
  const target = await makeCalendarSyncDb();
  const trigger = `CREATE TRIGGER fail_sync_state BEFORE INSERT ON calendar_sync_state
                   BEGIN SELECT RAISE(ABORT, 'injected sync state failure'); END`;
  await source.execute(trigger);
  const stageFailure = await writeCalendarObservationSync(snapshot("first", 1), source);
  assert.equal(stageFailure.ok, false);
  assert.match(stageFailure.error, /injected sync state failure/);
  assert.equal(await revision(source), 0);
  assert.equal(await eventCount(source), 0);
  assert.deepEqual((await readCalendarSyncHealth(source)).sources, []);

  await source.execute("DROP TRIGGER fail_sync_state");
  assert.equal((await writeCalendarObservationSync(snapshot("first", 1), source)).ok, true);
  assert.equal((await publishCalendarObservationsToLive(source, target)).ok, true);
  const previous = await revision(target);
  assert.equal((await writeCalendarObservationSync(snapshot("second", 2, 2), source)).ok, true);
  await target.execute(trigger);
  const failed = await publishCalendarObservationsToLive(source, target);
  assert.equal(failed.ok, false);
  assert.match(failed.error, /injected sync state failure/);
  assert.equal(await revision(target), previous);
  assert.equal(await eventCount(target), 1);
  assert.equal(await eventCount(source), 3);

  await target.execute("DROP TRIGGER fail_sync_state");
  const retried = await publishCalendarObservationsToLive(source, target);
  assert.equal(retried.ok, true);
  assert.equal(await eventCount(target), 3);
  assert.equal(await revision(target), await revision(source));
});

test("calendar-sync-store: a Live batch without all expected rows cannot be confirmed", async () => {
  const source = await makeCalendarSyncDb();
  const target = await makeCalendarSyncDb();
  assert.equal((await writeCalendarObservationSync(snapshot("ignored", 2), source)).ok, true);
  await target.execute(`CREATE TRIGGER ignore_one_entity BEFORE INSERT ON calendar_event_entities
                       WHEN NEW.title = 'Private fixture 0' BEGIN SELECT RAISE(IGNORE); END`);
  const failed = await publishCalendarObservationsToLive(source, target);
  assert.equal(failed.ok, false);
  assert.match(failed.error, /calendar_observation_revision_guard/);
  assert.equal(await revision(target), 0);
  assert.equal(await eventCount(target), 0);
});

function interleaveBeforeRevisionWrite(client, interveningWrite) {
  let interleaved = false;
  return {
    async batch(statements) {
      if (!interleaved && statements.some(({ sql }) => sql.startsWith("UPDATE calendar_observation_revision"))) {
        interleaved = true;
        await interveningWrite();
      }
      return client.batch(statements);
    },
  };
}

test("calendar-sync-store: concurrent writers rebuild from the newest staging snapshot", async () => {
  const source = await makeCalendarSyncDb();
  const delayedSource = interleaveBeforeRevisionWrite(source, async () => {
    assert.equal((await writeCalendarObservationSync(snapshot("other", 1, 3), source)).ok, true);
  });
  const result = await writeCalendarObservationSync(snapshot("delayed", 1), delayedSource);
  assert.equal(result.entitiesWritten, 2);
  assert.equal(await eventCount(source), 2);
});

test("calendar-sync-store: an older mirror cannot prune a newer Live revision", async () => {
  const source = await makeCalendarSyncDb();
  const target = await makeCalendarSyncDb();
  assert.equal((await writeCalendarObservationSync(snapshot("old", 1), source)).ok, true);
  const delayedTarget = interleaveBeforeRevisionWrite(target, async () => {
    assert.equal((await writeCalendarObservationSync(snapshot("new", 2, 3), source)).ok, true);
    assert.equal((await publishCalendarObservationsToLive(source, target)).ok, true);
  });
  const result = await publishCalendarObservationsToLive(source, delayedTarget);
  assert.equal(result.ok, true);
  assert.equal(result.rowsWritten, 0);
  assert.equal(await eventCount(target), 3);
  assert.equal(await revision(target), await revision(source));
});

test("calendar-sync-store: a sync cannot confirm an older snapshot after staging was restored", async () => {
  const source = await makeCalendarSyncDb();
  const target = await makeCalendarSyncDb();
  const beforeRestore = await writeCalendarObservationSync(snapshot("old", 1), source);
  const restored = await makeCalendarSyncDb();
  const result = await publishCalendarObservationsToLive(restored, target, beforeRestore.revision);
  assert.equal(result.ok, false);
  assert.match(result.error, /saved calendar revision is no longer available/);
  assert.equal(await revision(target), 0);
});
