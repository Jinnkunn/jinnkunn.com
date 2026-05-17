import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";

import {
  publishCalendarObservationsToLive,
  readCalendarSyncHealth,
  writeCalendarObservationSync,
} from "../../lib/server/calendar-sync-store.ts";

async function makeCalendarSyncDb() {
  const client = createClient({ url: ":memory:" });
  for (const migration of ["003_calendar_public.sql", "007_calendar_observations.sql"]) {
    const schema = await readFile(
      path.join(process.cwd(), "migrations", migration),
      "utf8",
    );
    await client.executeMultiple(schema);
  }
  return client;
}

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

test("calendar-sync-store: snapshot stale deletion is scoped to source", async () => {
  const client = await makeCalendarSyncDb();
  await writeCalendarObservationSync(
    {
      collector: { id: "mac", kind: "tauri-macos" },
      sources: [
        { id: "google", provider: "google", title: "Google" },
        { id: "outlook", provider: "outlook", title: "Outlook" },
      ],
      range: {
        startsAt: "2026-05-17T00:00:00Z",
        endsAt: "2026-05-18T00:00:00Z",
      },
      observations: [
        {
          sourceId: "google",
          sourceEventId: "google-kept",
          title: "Google meeting",
          startsAt: "2026-05-17T14:00:00Z",
          endsAt: "2026-05-17T15:00:00Z",
        },
        {
          sourceId: "outlook",
          sourceEventId: "outlook-kept",
          title: "Outlook meeting",
          startsAt: "2026-05-17T16:00:00Z",
          endsAt: "2026-05-17T17:00:00Z",
        },
      ],
    },
    client,
  );

  const result = await writeCalendarObservationSync(
    {
      collector: { id: "ios", kind: "ios" },
      sources: [{ id: "outlook", provider: "outlook", title: "Outlook" }],
      range: {
        startsAt: "2026-05-17T00:00:00Z",
        endsAt: "2026-05-18T00:00:00Z",
      },
      observations: [],
    },
    client,
  );

  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.staleObservations, 1);

  const active = await client.execute({
    sql: `SELECT source_id FROM calendar_event_observations
          WHERE deleted_at IS NULL
          ORDER BY source_id ASC`,
  });
  assert.deepEqual(
    active.rows.map((row) => row.source_id),
    ["google"],
  );
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
