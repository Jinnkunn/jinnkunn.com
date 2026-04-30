import { getCloudflareContext } from "@opennextjs/cloudflare";

import { createD1Executor, type D1DatabaseLike } from "./d1-executor.ts";
import type { DbExecutor } from "./db-content-store.ts";
import { logWarn } from "./error-log.ts";
import {
  normalizePublicCalendarData,
  type PublicCalendarData,
  type PublicCalendarEvent,
} from "../shared/public-calendar.ts";

const SYNC_STATE_ID = "public";
// D1 has a hard cap of 100 bind parameters per statement; we use 5 columns per
// event row, so 20 events per multi-row INSERT keeps us safely under the limit
// while still cutting round-trips by ~95% for typical (50-200 event) datasets.
const INSERT_BATCH_SIZE = 20;

export type WritePublicCalendarResult =
  | { ok: true; eventsWritten: number; skipped: false }
  | { ok: true; eventsWritten: 0; skipped: true; reason: "no_executor" }
  | { ok: false; error: string };

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

function decodeEventRow(
  raw: unknown,
  index: number,
): PublicCalendarEvent | null {
  if (typeof raw !== "string" || !raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logWarn({
      source: "public-calendar-db",
      message: "skipping unparseable event row",
      detail: err,
      meta: { index },
    });
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    logWarn({
      source: "public-calendar-db",
      message: "skipping non-object event row",
      meta: { index },
    });
    return null;
  }
  return parsed as PublicCalendarEvent;
}

/** Single-event lookup by id. Used by /calendar/[id] so the detail
 * route doesn't have to load every public event just to find one.
 * Returns `null` when D1 isn't bound or the row doesn't exist;
 * callers fall back to scanning the JSON file (which keeps the
 * route working even if D1 hasn't been seeded yet).
 *
 * The schema has `id` as the PRIMARY KEY of `calendar_public_events`,
 * so this is a single index lookup. */
export async function readPublicCalendarEventFromDb(
  id: string,
  executor = tryGetD1Executor(),
): Promise<PublicCalendarEvent | null> {
  if (!executor) return null;
  if (!id) return null;
  try {
    const result = await executor.execute({
      sql: `SELECT body_json FROM calendar_public_events WHERE id = ? LIMIT 1`,
      args: [id],
    });
    const row = result.rows[0];
    if (!row) return null;
    return decodeEventRow(row.body_json, 0);
  } catch (err) {
    logWarn({
      source: "public-calendar-db",
      message: "single-event read failed",
      detail: err,
      meta: { id },
    });
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
    const decodedEvents = events.rows
      .map((row, index) => decodeEventRow(row.body_json, index))
      .filter((event): event is PublicCalendarEvent => event !== null);
    return normalizePublicCalendarData({
      schemaVersion: 1,
      generatedAt: first.generated_at,
      range: {
        startsAt: first.range_starts_at,
        endsAt: first.range_ends_at,
      },
      events: decodedEvents,
    });
  } catch (err) {
    logWarn({
      source: "public-calendar-db",
      message: "read failed",
      detail: err,
    });
    return null;
  }
}

function buildBatchUpsertSql(rowCount: number): string {
  const placeholders = Array.from({ length: rowCount }, () => "(?, ?, ?, ?, ?)").join(
    ", ",
  );
  return `INSERT INTO calendar_public_events
          (id, starts_at, ends_at, body_json, updated_at)
          VALUES ${placeholders}
          ON CONFLICT(id) DO UPDATE SET
            starts_at = excluded.starts_at,
            ends_at = excluded.ends_at,
            body_json = excluded.body_json,
            updated_at = excluded.updated_at`;
}

function buildDeleteByIdsSql(rowCount: number): string {
  const placeholders = Array.from({ length: rowCount }, () => "?").join(", ");
  return `DELETE FROM calendar_public_events WHERE id IN (${placeholders})`;
}

async function pruneStalePublicEvents(
  executor: DbExecutor,
  activeIds: ReadonlySet<string>,
): Promise<void> {
  if (activeIds.size === 0) {
    await executor.execute({ sql: "DELETE FROM calendar_public_events" });
    return;
  }
  const existing = await executor.execute({
    sql: "SELECT id FROM calendar_public_events",
  });
  const staleIds = existing.rows
    .map((row) => (typeof row.id === "string" ? row.id : ""))
    .filter((id) => id && !activeIds.has(id));
  for (let i = 0; i < staleIds.length; i += INSERT_BATCH_SIZE) {
    const batch = staleIds.slice(i, i + INSERT_BATCH_SIZE);
    await executor.execute({ sql: buildDeleteByIdsSql(batch.length), args: batch });
  }
}

export async function writePublicCalendarToDb(
  data: PublicCalendarData,
  executor = tryGetD1Executor(),
): Promise<WritePublicCalendarResult> {
  if (!executor) {
    return { ok: true, eventsWritten: 0, skipped: true, reason: "no_executor" };
  }
  // Callers pass `PublicCalendarData` (already normalized at the request
  // boundary); readPublicCalendarFromDb normalizes again on the way out.
  const normalized = data;
  const now = Date.now();
  try {
    const activeIds = new Set<string>();
    for (let i = 0; i < normalized.events.length; i += INSERT_BATCH_SIZE) {
      const batch = normalized.events.slice(i, i + INSERT_BATCH_SIZE);
      const args: unknown[] = [];
      for (const event of batch) {
        activeIds.add(event.id);
        args.push(
          event.id,
          event.startsAt,
          event.endsAt,
          JSON.stringify(event),
          now,
        );
      }
      await executor.execute({ sql: buildBatchUpsertSql(batch.length), args });
    }
    await pruneStalePublicEvents(executor, activeIds);
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
    return { ok: true, eventsWritten: normalized.events.length, skipped: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The content-file path remains the compatibility source of truth until
    // all deployed environments have the calendar_public_* migrations.
    logWarn({
      source: "public-calendar-db",
      message: "write failed",
      detail: err,
      meta: { eventCount: normalized.events.length },
    });
    return { ok: false, error: message };
  }
}
