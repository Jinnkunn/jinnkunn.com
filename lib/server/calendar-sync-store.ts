import { getCloudflareContext } from "@opennextjs/cloudflare";

import { createD1Executor, type D1DatabaseLike } from "./d1-executor.ts";
import type { DbExecutor } from "./db-content-store.ts";
import { logWarn } from "./error-log.ts";
import {
  mergeCalendarObservations,
  normalizeCalendarObservation,
  normalizeCalendarObservationSyncPayload,
  type CalendarEntity,
  type CalendarObservation,
  type CalendarObservationSyncPayload,
} from "../shared/calendar-core.ts";

const INSERT_BATCH_SIZE = 20;

export type CalendarObservationSyncResult =
  | {
      ok: true;
      sourcesWritten: number;
      observationsWritten: number;
      entitiesWritten: number;
      staleObservations: number;
      skipped: false;
    }
  | { ok: true; skipped: true; reason: "no_executor" }
  | { ok: false; error: string };

export interface CalendarSyncHealthSource {
  id: string;
  provider: string;
  title: string;
  collectorId: string;
  lastSyncedAt: string | null;
  eventCount: number;
}

export interface CalendarSyncHealth {
  sources: CalendarSyncHealthSource[];
  entityCount: number;
}

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

function buildSourceUpsertSql(rowCount: number): string {
  const rows = Array.from(
    { length: rowCount },
    () => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).join(", ");
  return `INSERT INTO calendar_sync_sources
          (id, provider, title, account_key, external_source_id, collector_id,
           sync_scope_json, last_synced_at, created_at, updated_at)
          VALUES ${rows}
          ON CONFLICT(id) DO UPDATE SET
            provider = excluded.provider,
            title = excluded.title,
            account_key = excluded.account_key,
            external_source_id = excluded.external_source_id,
            collector_id = excluded.collector_id,
            sync_scope_json = excluded.sync_scope_json,
            last_synced_at = excluded.last_synced_at,
            updated_at = excluded.updated_at`;
}

function buildObservationUpsertSql(rowCount: number): string {
  const rows = Array.from(
    { length: rowCount },
    () => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).join(", ");
  return `INSERT INTO calendar_event_observations
          (observation_id, entity_id, source_id, collector_id, source_event_id,
           ical_uid, recurrence_instance_id, starts_at, ends_at, last_seen_at,
           deleted_at, body_json, updated_at)
          VALUES ${rows}
          ON CONFLICT(observation_id) DO UPDATE SET
            entity_id = excluded.entity_id,
            source_id = excluded.source_id,
            collector_id = excluded.collector_id,
            source_event_id = excluded.source_event_id,
            ical_uid = excluded.ical_uid,
            recurrence_instance_id = excluded.recurrence_instance_id,
            starts_at = excluded.starts_at,
            ends_at = excluded.ends_at,
            last_seen_at = excluded.last_seen_at,
            deleted_at = excluded.deleted_at,
            body_json = excluded.body_json,
            updated_at = excluded.updated_at`;
}

function buildEntityUpsertSql(rowCount: number): string {
  const rows = Array.from({ length: rowCount }, () => "(?, ?, ?, ?, ?, ?, ?)").join(
    ", ",
  );
  return `INSERT INTO calendar_event_entities
          (entity_id, dedupe_key, title, starts_at, ends_at, body_json, updated_at)
          VALUES ${rows}
          ON CONFLICT(entity_id) DO UPDATE SET
            dedupe_key = excluded.dedupe_key,
            title = excluded.title,
            starts_at = excluded.starts_at,
            ends_at = excluded.ends_at,
            body_json = excluded.body_json,
            updated_at = excluded.updated_at`;
}

async function upsertSources(
  executor: DbExecutor,
  payload: CalendarObservationSyncPayload,
  now: number,
): Promise<void> {
  for (let i = 0; i < payload.sources.length; i += INSERT_BATCH_SIZE) {
    const batch = payload.sources.slice(i, i + INSERT_BATCH_SIZE);
    const args: unknown[] = [];
    for (const source of batch) {
      args.push(
        source.id,
        source.provider,
        source.title,
        source.accountKey ?? null,
        source.externalSourceId ?? null,
        payload.collector.id,
        JSON.stringify(source.syncScope ?? {}),
        payload.observedAt,
        now,
        now,
      );
    }
    await executor.execute({ sql: buildSourceUpsertSql(batch.length), args });
  }
}

async function upsertObservations(
  executor: DbExecutor,
  payload: CalendarObservationSyncPayload,
  now: number,
): Promise<void> {
  for (let i = 0; i < payload.observations.length; i += INSERT_BATCH_SIZE) {
    const batch = payload.observations.slice(i, i + INSERT_BATCH_SIZE);
    const args: unknown[] = [];
    for (const observation of batch) {
      args.push(
        observation.observationId,
        null,
        observation.sourceId,
        observation.collectorId,
        observation.sourceEventId ?? null,
        observation.iCalUid ?? null,
        observation.recurrenceInstanceId ?? null,
        observation.startsAt,
        observation.endsAt,
        payload.observedAt,
        null,
        JSON.stringify(observation),
        now,
      );
    }
    await executor.execute({ sql: buildObservationUpsertSql(batch.length), args });
  }
}

async function markStaleSnapshotObservations(
  executor: DbExecutor,
  payload: CalendarObservationSyncPayload,
  now: number,
): Promise<number> {
  if (payload.syncMode !== "snapshot") return 0;
  let stale = 0;
  const activeIds = new Set(payload.observations.map((entry) => entry.observationId));
  for (const source of payload.sources) {
    const existing = await executor.execute({
      sql: `SELECT observation_id
            FROM calendar_event_observations
            WHERE source_id = ?
              AND deleted_at IS NULL
              AND starts_at < ?
              AND ends_at > ?`,
      args: [source.id, payload.range.endsAt, payload.range.startsAt],
    });
    const staleIds = existing.rows
      .map((row) =>
        typeof row.observation_id === "string" ? row.observation_id : "",
      )
      .filter((id) => id && !activeIds.has(id));
    for (const id of staleIds) {
      await executor.execute({
        sql: `UPDATE calendar_event_observations
              SET deleted_at = ?, updated_at = ?
              WHERE observation_id = ?`,
        args: [payload.observedAt, now, id],
      });
      stale += 1;
    }
  }
  return stale;
}

function decodeObservation(raw: unknown): CalendarObservation | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return normalizeCalendarObservation(JSON.parse(raw), "stored");
  } catch {
    return null;
  }
}

async function readActiveObservationsForRange(
  executor: DbExecutor,
  range: CalendarObservationSyncPayload["range"],
): Promise<CalendarObservation[]> {
  const result = await executor.execute({
    sql: `SELECT body_json
          FROM calendar_event_observations
          WHERE deleted_at IS NULL
            AND starts_at < ?
            AND ends_at > ?
          ORDER BY starts_at ASC`,
    args: [range.endsAt, range.startsAt],
  });
  return result.rows
    .map((row) => decodeObservation(row.body_json))
    .filter((entry): entry is CalendarObservation => entry !== null);
}

async function upsertEntities(
  executor: DbExecutor,
  entities: CalendarEntity[],
  now: number,
): Promise<void> {
  for (let i = 0; i < entities.length; i += INSERT_BATCH_SIZE) {
    const batch = entities.slice(i, i + INSERT_BATCH_SIZE);
    const args: unknown[] = [];
    for (const entity of batch) {
      args.push(
        entity.id,
        entity.dedupeKey,
        entity.title,
        entity.startsAt,
        entity.endsAt,
        JSON.stringify({
          id: entity.id,
          dedupeKey: entity.dedupeKey,
          title: entity.title,
          startsAt: entity.startsAt,
          endsAt: entity.endsAt,
          isAllDay: entity.isAllDay,
          confidence: entity.confidence,
          sourceRefs: entity.sourceRefs,
        }),
        now,
      );
    }
    await executor.execute({ sql: buildEntityUpsertSql(batch.length), args });
  }
}

async function pruneStaleEntitiesInRange(
  executor: DbExecutor,
  entities: CalendarEntity[],
  range: CalendarObservationSyncPayload["range"],
): Promise<void> {
  const activeIds = new Set(entities.map((entry) => entry.id));
  const existing = await executor.execute({
    sql: `SELECT entity_id
          FROM calendar_event_entities
          WHERE starts_at < ?
            AND ends_at > ?`,
    args: [range.endsAt, range.startsAt],
  });
  const staleIds = existing.rows
    .map((row) => (typeof row.entity_id === "string" ? row.entity_id : ""))
    .filter((id) => id && !activeIds.has(id));
  for (let i = 0; i < staleIds.length; i += INSERT_BATCH_SIZE) {
    const batch = staleIds.slice(i, i + INSERT_BATCH_SIZE);
    const marks = Array.from({ length: batch.length }, () => "?").join(", ");
    await executor.execute({
      sql: `DELETE FROM calendar_event_entities WHERE entity_id IN (${marks})`,
      args: batch,
    });
  }
}

async function stampObservationEntityRefs(
  executor: DbExecutor,
  entities: CalendarEntity[],
  now: number,
): Promise<void> {
  for (const entity of entities) {
    for (const ref of entity.sourceRefs) {
      await executor.execute({
        sql: `UPDATE calendar_event_observations
              SET entity_id = ?, updated_at = ?
              WHERE observation_id = ?`,
        args: [entity.id, now, ref.observationId],
      });
    }
  }
}

async function upsertSyncState(
  executor: DbExecutor,
  payload: CalendarObservationSyncPayload,
  now: number,
): Promise<void> {
  const counts = new Map<string, number>();
  for (const observation of payload.observations) {
    counts.set(observation.sourceId, (counts.get(observation.sourceId) ?? 0) + 1);
  }
  for (const source of payload.sources) {
    const stateId = `${payload.collector.id}:${source.id}`;
    await executor.execute({
      sql: `INSERT INTO calendar_sync_state
            (id, collector_id, source_id, sync_mode, range_starts_at,
             range_ends_at, event_count, synced_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              collector_id = excluded.collector_id,
              source_id = excluded.source_id,
              sync_mode = excluded.sync_mode,
              range_starts_at = excluded.range_starts_at,
              range_ends_at = excluded.range_ends_at,
              event_count = excluded.event_count,
              synced_at = excluded.synced_at,
              updated_at = excluded.updated_at`,
      args: [
        stateId,
        payload.collector.id,
        source.id,
        payload.syncMode,
        payload.range.startsAt,
        payload.range.endsAt,
        counts.get(source.id) ?? 0,
        payload.observedAt,
        now,
      ],
    });
  }
}

export async function writeCalendarObservationSync(
  rawPayload: unknown,
  executor = tryGetD1Executor(),
): Promise<CalendarObservationSyncResult> {
  if (!executor) {
    return { ok: true, skipped: true, reason: "no_executor" };
  }
  const payload = normalizeCalendarObservationSyncPayload(rawPayload);
  const now = Date.now();
  try {
    await upsertSources(executor, payload, now);
    await upsertObservations(executor, payload, now);
    const staleObservations = await markStaleSnapshotObservations(
      executor,
      payload,
      now,
    );
    const activeObservations = await readActiveObservationsForRange(
      executor,
      payload.range,
    );
    const entities = mergeCalendarObservations(activeObservations);
    await upsertEntities(executor, entities, now);
    await pruneStaleEntitiesInRange(executor, entities, payload.range);
    await stampObservationEntityRefs(executor, entities, now);
    await upsertSyncState(executor, payload, now);
    return {
      ok: true,
      skipped: false,
      sourcesWritten: payload.sources.length,
      observationsWritten: payload.observations.length,
      entitiesWritten: entities.length,
      staleObservations,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn({
      source: "calendar-sync-store",
      message: "write failed",
      detail: err,
      meta: { eventCount: payload.observations.length },
    });
    return { ok: false, error: message };
  }
}

export async function readCalendarSyncHealth(
  executor = tryGetD1Executor(),
): Promise<CalendarSyncHealth | null> {
  if (!executor) return null;
  try {
    const [sources, entities] = await Promise.all([
      executor.execute({
        sql: `SELECT s.id, s.provider, s.title, s.collector_id, s.last_synced_at,
                     COALESCE(st.event_count, 0) AS event_count
              FROM calendar_sync_sources s
              LEFT JOIN calendar_sync_state st
                ON st.source_id = s.id AND st.collector_id = s.collector_id
              ORDER BY s.provider ASC, s.title ASC`,
      }),
      executor.execute({
        sql: `SELECT COUNT(*) AS count FROM calendar_event_entities`,
      }),
    ]);
    return {
      sources: sources.rows.map((row) => ({
        id: String(row.id ?? ""),
        provider: String(row.provider ?? "unknown"),
        title: String(row.title ?? "Calendar"),
        collectorId: String(row.collector_id ?? ""),
        lastSyncedAt:
          typeof row.last_synced_at === "string" ? row.last_synced_at : null,
        eventCount: Number(row.event_count ?? 0),
      })),
      entityCount: Number(entities.rows[0]?.count ?? 0),
    };
  } catch (err) {
    logWarn({
      source: "calendar-sync-store",
      message: "health read failed",
      detail: err,
    });
    return null;
  }
}
