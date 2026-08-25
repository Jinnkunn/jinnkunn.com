import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";

import {
  cleanupCalendarCollectorObservations,
  publishCalendarObservationsToLive,
  readCalendarSyncHealth,
  writeCalendarObservationSync,
} from "../../lib/server/calendar-sync-store.ts";

async function makeCalendarSyncDb() {
  const client = createClient({ url: ":memory:" });
  for (const migration of [
    "003_calendar_public.sql",
    "007_calendar_observations.sql",
    "008_calendar_collector_cleanup.sql",
  ]) {
    const schema = await readFile(
      path.join(process.cwd(), "migrations", migration),
      "utf8",
    );
    await client.executeMultiple(schema);
  }
  return client;
}

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
  const limitedExecutor = {
    async execute(opts) {
      assert.ok(
        (opts.args ?? []).length <= maxVariables,
        `expected <=${maxVariables} SQL variables, got ${(opts.args ?? []).length}`,
      );
      return client.execute(opts);
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

test("calendar-sync-store: collector cleanup retry repairs a partial derived-state failure", async () => {
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

  let injected = false;
  const flakyExecutor = {
    async execute(opts) {
      if (
        !injected &&
        /SELECT body_json[\s\S]*FROM calendar_event_observations/.test(opts.sql)
      ) {
        injected = true;
        throw new Error("injected post-tombstone failure");
      }
      return client.execute(opts);
    },
  };
  const failed = await cleanupCalendarCollectorObservations(
    { collectorId: "mac-retry" },
    flakyExecutor,
  );
  assert.deepEqual(failed, { ok: false, error: "injected post-tombstone failure" });

  const partial = await client.execute({
    sql: `SELECT deleted_at FROM calendar_event_observations
          WHERE collector_id = ?`,
    args: ["mac-retry"],
  });
  assert.equal(typeof partial.rows[0].deleted_at, "string");
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
