import { getCloudflareContext } from "@opennextjs/cloudflare";

import { createD1Executor, type D1DatabaseLike } from "./d1-executor.ts";
import type { DbExecutor } from "./db-content-store.ts";
import {
  normalizePublicCalendarData,
  type PublicCalendarData,
} from "../shared/public-calendar.ts";

const SYNC_STATE_ID = "public";

function isD1Like(value: unknown): value is D1DatabaseLike {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { prepare?: unknown }).prepare === "function"
  );
}

function tryGetD1Executor(): DbExecutor | null {
  try {
    const { env } = getCloudflareContext();
    const binding = (env as Record<string, unknown>).SITE_ADMIN_DB;
    return isD1Like(binding) ? createD1Executor(binding) : null;
  } catch {
    return null;
  }
}

export async function readPublicCalendarFromDb(
  executor = tryGetD1Executor(),
): Promise<PublicCalendarData | null> {
  if (!executor) return null;
  try {
    const [state, events] = await Promise.all([
      executor.execute({
        sql: `SELECT generated_at, range_starts_at, range_ends_at
              FROM calendar_public_sync_state
              WHERE id = ?`,
        args: [SYNC_STATE_ID],
      }),
      executor.execute({
        sql: `SELECT body_json FROM calendar_public_events ORDER BY starts_at ASC`,
      }),
    ]);
    const first = state.rows[0];
    if (!first) return null;
    return normalizePublicCalendarData({
      schemaVersion: 1,
      generatedAt: first.generated_at,
      range: {
        startsAt: first.range_starts_at,
        endsAt: first.range_ends_at,
      },
      events: events.rows
        .map((row) => {
          try {
            return JSON.parse(String(row.body_json ?? ""));
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    });
  } catch {
    return null;
  }
}

export async function writePublicCalendarToDb(
  data: PublicCalendarData,
  executor = tryGetD1Executor(),
): Promise<void> {
  if (!executor) return;
  const normalized = normalizePublicCalendarData(data);
  const now = Date.now();
  try {
    await executor.execute({ sql: "DELETE FROM calendar_public_events" });
    for (const event of normalized.events) {
      await executor.execute({
        sql: `INSERT INTO calendar_public_events
              (id, starts_at, ends_at, body_json, updated_at)
              VALUES (?, ?, ?, ?, ?)`,
        args: [
          event.id,
          event.startsAt,
          event.endsAt,
          JSON.stringify(event),
          now,
        ],
      });
    }
    await executor.execute({
      sql: `INSERT INTO calendar_public_sync_state
            (id, generated_at, range_starts_at, range_ends_at, event_count, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              generated_at = excluded.generated_at,
              range_starts_at = excluded.range_starts_at,
              range_ends_at = excluded.range_ends_at,
              event_count = excluded.event_count,
              updated_at = excluded.updated_at`,
      args: [
        SYNC_STATE_ID,
        normalized.generatedAt,
        normalized.range.startsAt,
        normalized.range.endsAt,
        normalized.events.length,
        now,
      ],
    });
  } catch {
    // The content-file path remains the compatibility source of truth until
    // all deployed environments have the calendar_public_* migrations.
  }
}
