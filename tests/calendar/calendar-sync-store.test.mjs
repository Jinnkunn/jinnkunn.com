import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";

import {
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
