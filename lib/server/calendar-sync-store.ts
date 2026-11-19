import { getCloudflareContext } from "@opennextjs/cloudflare";

import { createD1Executor, type D1DatabaseLike } from "./d1-executor.ts";
import {
  legacyCalendarProjection,
  READ_CALENDAR_COVERAGE,
  readCalendarProjectionExclusions,
} from "./calendar-projection-exclusions.ts";
import type {
  DbExecutor,
  DbResult,
  DbStatement,
  TransactionalDbExecutor,
} from "./db-content-store.ts";
import { logWarn } from "./error-log.ts";
import {
  mergeCalendarObservations,
  normalizeCalendarObservation,
  type CalendarEntity,
  type CalendarObservation,
  type CalendarObservationSyncPayload,
} from "../shared/calendar-core.ts";
import type {
  CalendarCollectorCleanupCommand,
  CalendarCollectorCleanupRange,
} from "../site-admin/calendar-observation-commands.ts";

// Cloudflare D1 currently rejects statements with too many bound SQL variables
// much earlier than local SQLite/libSQL. Keep batch statements comfortably below
// that ceiling so a full iOS EventKit snapshot can be written reliably.
const D1_SQL_VARIABLE_LIMIT = 90;
const SOURCE_INSERT_COLUMN_COUNT = 10;
const OBSERVATION_INSERT_COLUMN_COUNT = 13;
const ENTITY_INSERT_COLUMN_COUNT = 7;

function rowsPerStatement(columnCount: number): number {
  return Math.max(1, Math.floor(D1_SQL_VARIABLE_LIMIT / columnCount));
}

const SOURCE_INSERT_BATCH_SIZE = rowsPerStatement(SOURCE_INSERT_COLUMN_COUNT);
const OBSERVATION_INSERT_BATCH_SIZE = rowsPerStatement(
  OBSERVATION_INSERT_COLUMN_COUNT,
);
const ENTITY_INSERT_BATCH_SIZE = rowsPerStatement(ENTITY_INSERT_COLUMN_COUNT);
const ID_BATCH_SIZE = D1_SQL_VARIABLE_LIMIT;
const REVISION_RETRY_LIMIT = 3;

function* chunks<T>(values: readonly T[], size: number) {
  for (let i = 0; i < values.length; i += size) {
    yield values.slice(i, i + size);
  }
}

function placeholders(count: number): string {
  return Array(count).fill("?").join(", ");
}

export type CalendarObservationSyncResult =
  | {
      ok: true;
      sourcesWritten: number;
      observationsWritten: number;
      entitiesWritten: number;
      staleObservations: number;
      revision: number;
      skipped: false;
    }
  | { ok: true; skipped: true; reason: "no_executor" }
  | { ok: false; error: string };

export type CalendarCollectorCleanupResult =
  | {
      ok: true;
      skipped: false;
      collectorId: string;
      range: CalendarCollectorCleanupRange | null;
      tombstonedObservations: number;
      entitiesWritten: number;
      syncedAt: string;
      revision: number;
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

type CalendarPublicationReceipt = {
  revision: number;
  updatedAt: string | null;
  collectorSyncedAt: string | null;
};

function isD1Like(value: unknown): value is D1DatabaseLike {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { prepare?: unknown }).prepare === "function"
  );
}

function tryGetD1Executor(bindingName = "SITE_ADMIN_DB"): TransactionalDbExecutor | null {
  try {
    const { env } = getCloudflareContext();
    const binding = (env as Record<string, unknown>)[bindingName];
    return isD1Like(binding) ? createD1Executor(binding) : null;
  } catch {
    return null;
  }
}

export function getCalendarObservationWriteDatabases() {
  const staging = tryGetD1Executor("SITE_ADMIN_DB");
  const live = tryGetD1Executor("SITE_ADMIN_DB_LIVE");
  return staging && live ? { staging, live } : null;
}

const READ_REVISION: DbStatement = {
  sql: "SELECT revision, updated_at FROM calendar_observation_revision WHERE id = 1",
};

function readRevision(result: DbResult) {
  const row = result.rows[0];
  const revision = Number(row?.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("Calendar observation revision is not initialized.");
  }
  return {
    revision,
    updatedAt: typeof row?.updated_at === "string" ? row.updated_at : null,
  };
}

async function readPublicationReceipt(
  executor: DbExecutor,
  collectorId: string,
): Promise<CalendarPublicationReceipt> {
  const result = await executor.execute({
    sql: `SELECT revision, updated_at,
            (SELECT MAX(synced_at) FROM calendar_sync_state WHERE collector_id = ?) AS collector_synced_at
          FROM calendar_observation_revision WHERE id = 1`,
    args: [collectorId],
  });
  const lastSync = result.rows[0]?.collector_synced_at;
  return {
    ...readRevision(result),
    collectorSyncedAt: typeof lastSync === "string" ? lastSync : null,
  };
}

export async function readCalendarPublicationStatus(
  collectorId: string,
  databases = getCalendarObservationWriteDatabases(),
) {
  if (!databases) return null;
  // Read Live first so an ordinary concurrent publish can't make it look
  // newer than staging. Each receipt includes the collector time in the same read.
  const live = await readPublicationReceipt(databases.live, collectorId);
  const staging = await readPublicationReceipt(databases.staging, collectorId);
  return { staging, live };
}

function advanceRevision(
  expected: number,
  next: number,
  updatedAt: string,
  rowCounts: readonly number[] = [],
): DbStatement {
  const verification = rowCounts.length
    ? CALENDAR_OBSERVATION_MIRROR_TABLES.map(
        ({ name }) => `AND (SELECT COUNT(*) FROM ${name}) = ?`,
      ).join(" ")
    : "";
  // A failed compare or count check must roll back the whole D1 batch.
  return {
    sql: `UPDATE calendar_observation_revision
          SET revision = CASE WHEN revision = ? ${verification} THEN ? ELSE -1 END,
              updated_at = ?
          WHERE id = 1`,
    args: [expected, ...rowCounts, next, updatedAt],
  };
}

function confirmRevisionWrite(result: DbResult) {
  if (result.rowsAffected !== 1) {
    throw new Error("Calendar observation revision was not recorded.");
  }
}

async function retryRevisionConflict<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      const message = err instanceof Error ? `${err.message} ${err.cause ?? ""}` : String(err);
      if (attempt === REVISION_RETRY_LIMIT || !message.includes("calendar_observation_revision_guard")) {
        throw err;
      }
    }
  }
}

type CalendarMirrorTable = {
  name: string;
  primaryKey: string;
  columns: string[];
  batchSize: number;
};

const CALENDAR_OBSERVATION_MIRROR_TABLES: CalendarMirrorTable[] = [
  {
    name: "calendar_sync_sources",
    primaryKey: "id",
    columns: [
      "id",
      "provider",
      "title",
      "account_key",
      "external_source_id",
      "collector_id",
      "sync_scope_json",
      "last_synced_at",
      "created_at",
      "updated_at",
    ],
    batchSize: rowsPerStatement(10),
  },
  {
    name: "calendar_event_observations",
    primaryKey: "observation_id",
    columns: [
      "observation_id",
      "entity_id",
      "source_id",
      "collector_id",
      "source_event_id",
      "ical_uid",
      "recurrence_instance_id",
      "starts_at",
      "ends_at",
      "last_seen_at",
      "deleted_at",
      "body_json",
      "updated_at",
    ],
    batchSize: rowsPerStatement(13),
  },
  {
    name: "calendar_event_entities",
    primaryKey: "entity_id",
    columns: [
      "entity_id",
      "dedupe_key",
      "title",
      "starts_at",
      "ends_at",
      "body_json",
      "updated_at",
    ],
    batchSize: rowsPerStatement(7),
  },
  {
    name: "calendar_sync_state",
    primaryKey: "id",
    columns: [
      "id",
      "collector_id",
      "source_id",
      "sync_mode",
      "range_starts_at",
      "range_ends_at",
      "event_count",
      "synced_at",
      "updated_at",
    ],
    batchSize: rowsPerStatement(9),
  },
  {
    name: "calendar_projection_exclusions",
    primaryKey: "id",
    columns: ["id", "starts_at", "ends_at", "is_all_day", "legacy_ids_json", "updated_at"],
    batchSize: rowsPerStatement(6),
  },
];

export type CalendarObservationLivePublishResult =
  | {
      ok: true;
      skipped: false;
      tables: Array<{
        name: string;
        rowsWritten: number;
        rowsDeleted: number;
      }>;
      rowsWritten: number;
      rowsDeleted: number;
      publishedAt: string;
    }
  | {
      ok: true;
      skipped: true;
      reason: "no_source_executor" | "no_target_executor";
    }
  | { ok: false; error: string; code?: "CALENDAR_REVISION_CHANGED" };

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
            updated_at = excluded.updated_at
          WHERE calendar_event_entities.body_json IS NOT excluded.body_json`;
}

function sourceWrites(
  payload: CalendarObservationSyncPayload,
  now: number,
): DbStatement[] {
  const writes: DbStatement[] = [];
  for (const batch of chunks(payload.sources, SOURCE_INSERT_BATCH_SIZE)) {
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
    writes.push({ sql: buildSourceUpsertSql(batch.length), args });
  }
  return writes;
}

function observationWrites(
  payload: CalendarObservationSyncPayload,
  now: number,
): DbStatement[] {
  const writes: DbStatement[] = [];
  for (const batch of chunks(payload.observations, OBSERVATION_INSERT_BATCH_SIZE)) {
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
    writes.push({ sql: buildObservationUpsertSql(batch.length), args });
  }
  return writes;
}

function tombstoneWrites(
  staleIds: string[],
  observedAt: string,
  now: number,
): DbStatement[] {
  const writes: DbStatement[] = [];
  for (const batch of chunks(staleIds, ID_BATCH_SIZE - 2)) {
    writes.push({
      sql: `UPDATE calendar_event_observations
            SET deleted_at = ?, updated_at = ?
            WHERE observation_id IN (${placeholders(batch.length)})`,
      args: [observedAt, now, ...batch],
    });
  }
  return writes;
}

function decodeObservation(raw: unknown): CalendarObservation | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return normalizeCalendarObservation(JSON.parse(raw), "stored");
  } catch {
    return null;
  }
}

function readActiveObservationsForRange(
  range: CalendarObservationSyncPayload["range"],
): DbStatement {
  return {
    sql: `SELECT o.observation_id, o.collector_id, o.body_json, s.provider, s.external_source_id
          FROM calendar_event_observations o LEFT JOIN calendar_sync_sources s ON s.id = o.source_id
          WHERE o.deleted_at IS NULL AND o.starts_at < ? AND o.ends_at > ?`,
    args: [range.endsAt, range.startsAt],
  };
}

function readDeletedLegacyObservationsForRange(range: CalendarObservationSyncPayload["range"]): DbStatement {
  return {
    sql: `SELECT o.body_json, s.provider, s.external_source_id
          FROM calendar_event_observations o JOIN calendar_sync_sources s ON s.id = o.source_id
          WHERE o.deleted_at IS NOT NULL AND o.starts_at >= ? AND o.ends_at <= ?
            AND (o.collector_id LIKE 'tauri-macos:%' OR o.collector_id LIKE 'ios:%')`,
    args: [range.startsAt, range.endsAt],
  };
}

function clearExcludedEntityRefs(ids: string[], now: number): DbStatement[] {
  return [...chunks(ids, ID_BATCH_SIZE - 1)].map((batch) => ({
    sql: `UPDATE calendar_event_observations SET entity_id = NULL, updated_at = ?
          WHERE entity_id IS NOT NULL AND observation_id IN (${placeholders(batch.length)})`,
    args: [now, ...batch],
  }));
}

function entityWrites(
  entities: CalendarEntity[],
  now: number,
): DbStatement[] {
  const writes: DbStatement[] = [];
  for (const batch of chunks(entities, ENTITY_INSERT_BATCH_SIZE)) {
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
    writes.push({ sql: buildEntityUpsertSql(batch.length), args });
  }
  return writes;
}

function readEntityIdsForRange(
  range: CalendarObservationSyncPayload["range"],
): DbStatement {
  return {
    sql: `SELECT entity_id
          FROM calendar_event_entities
          WHERE starts_at < ?
            AND ends_at > ?`,
    args: [range.endsAt, range.startsAt],
  };
}

function observationEntityRefWrites(
  entities: CalendarEntity[],
  now: number,
): DbStatement[] {
  const refs = entities.flatMap((entity) =>
    entity.sourceRefs.map((ref) => [ref.observationId, entity.id]),
  );
  const writes: DbStatement[] = [];
  for (const batch of chunks(refs, Math.floor((D1_SQL_VARIABLE_LIMIT - 1) / 2))) {
    const values = batch.map(() => "(?, ?)").join(", ");
    writes.push({
      sql: `WITH refs(obs_id, ref_entity_id) AS (VALUES ${values})
            UPDATE calendar_event_observations AS observation
            SET entity_id = refs.ref_entity_id, updated_at = ?
            FROM refs
            WHERE observation.observation_id = refs.obs_id
              AND observation.entity_id IS NOT refs.ref_entity_id`,
      args: [...batch.flat(), now],
    });
  }
  return writes;
}

function syncStateWrites(
  payload: CalendarObservationSyncPayload,
  now: number,
): DbStatement[] {
  const counts = new Map<string, number>();
  for (const observation of payload.observations) {
    counts.set(observation.sourceId, (counts.get(observation.sourceId) ?? 0) + 1);
  }
  return payload.sources.map((source) => ({
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
        `${payload.collector.id}:${source.id}`,
        payload.collector.id,
        source.id,
        payload.syncMode,
        payload.range.startsAt,
        payload.range.endsAt,
        counts.get(source.id) ?? 0,
        payload.observedAt,
        now,
      ],
  }));
}

function buildMirrorUpsertSql(table: CalendarMirrorTable, rowCount: number): string {
  const row = `(${placeholders(table.columns.length)})`;
  const values = Array(rowCount).fill(row).join(", ");
  const updates = table.columns
    .filter((column) => column !== table.primaryKey)
    .map((column) => `${column} = excluded.${column}`)
    .join(", ");
  return `INSERT INTO ${table.name}
          (${table.columns.join(", ")})
          VALUES ${values}
          ON CONFLICT(${table.primaryKey}) DO UPDATE SET ${updates}`;
}

function mirrorRowWrites(
  table: CalendarMirrorTable,
  rows: Record<string, unknown>[],
): DbStatement[] {
  const writes: DbStatement[] = [];
  for (const batch of chunks(rows, table.batchSize)) {
    writes.push({
      sql: buildMirrorUpsertSql(table, batch.length),
      args: batch.flatMap((row) => table.columns.map((column) => row[column] ?? null)),
    });
  }
  return writes;
}

function deleteRows(table: string, key: string, ids: string[]): DbStatement[] {
  const writes: DbStatement[] = [];
  for (const batch of chunks(ids, ID_BATCH_SIZE)) {
    writes.push({
      sql: `DELETE FROM ${table} WHERE ${key} IN (${placeholders(batch.length)})`,
      args: batch,
    });
  }
  return writes;
}

export async function publishCalendarObservationsToLive(
  sourceExecutor = tryGetD1Executor("SITE_ADMIN_DB"),
  targetExecutor = tryGetD1Executor("SITE_ADMIN_DB_LIVE"),
  minimumRevision = 0,
  expectedRevision?: number,
): Promise<CalendarObservationLivePublishResult> {
  if (!sourceExecutor) {
    return { ok: true, skipped: true, reason: "no_source_executor" };
  }
  if (!targetExecutor) {
    return { ok: true, skipped: true, reason: "no_target_executor" };
  }

  try {
    return await retryRevisionConflict<CalendarObservationLivePublishResult>(async () => {
      const [liveRevision, ...liveRows] = await targetExecutor.batch([
        READ_REVISION,
        ...CALENDAR_OBSERVATION_MIRROR_TABLES.map(({ name, primaryKey }) => ({
          sql: `SELECT ${primaryKey}, updated_at FROM ${name}`,
        })),
      ]);
      const [stagingRevision, ...stagingRows] = await sourceExecutor.batch([
        READ_REVISION,
        ...CALENDAR_OBSERVATION_MIRROR_TABLES.map(({ name, columns }) => ({
          sql: `SELECT ${columns.join(", ")} FROM ${name}`,
        })),
      ]);
      const live = readRevision(liveRevision);
      const staging = readRevision(stagingRevision);
      if (expectedRevision !== undefined && staging.revision !== expectedRevision) {
        return {
          ok: false,
          code: "CALENDAR_REVISION_CHANGED",
          error: "The staging calendar revision changed. Check the receipts before retrying.",
        };
      }
      if (staging.revision < minimumRevision) {
        throw new Error("The saved calendar revision is no longer available in staging.");
      }
      if (live.revision > staging.revision) {
        throw new Error("Live calendar revision is newer than staging; refusing to replace it.");
      }
      if (!staging.updatedAt && stagingRows.every(({ rows }) => !rows.length) &&
          liveRows.some(({ rows }) => rows.length)) {
        throw new Error("Staging has no observation snapshot; refusing to clear Live.");
      }

      const writes: DbStatement[] = [];
      const tables = CALENDAR_OBSERVATION_MIRROR_TABLES.map((table, index) => {
        const incoming = stagingRows[index].rows;
        const current = new Map(liveRows[index].rows.map((row) => [
          String(row[table.primaryKey]), Number(row.updated_at),
        ]));
        const changed = incoming.filter((row) => {
          const id = String(row[table.primaryKey]);
          const version = current.get(id);
          current.delete(id);
          // No revision receipt means the legacy mirror may contain partial writes.
          return !live.updatedAt || version !== Number(row.updated_at);
        });
        const staleIds = [...current.keys()];
        writes.push(...mirrorRowWrites(table, changed));
        writes.push(...deleteRows(table.name, table.primaryKey, staleIds));
        return { name: table.name, rowsWritten: changed.length, rowsDeleted: staleIds.length };
      });

      let publishedAt = live.updatedAt;
      if (!publishedAt || live.revision !== staging.revision || writes.length) {
        publishedAt = new Date().toISOString();
        const results = await targetExecutor.batch([
          ...writes,
          advanceRevision(
            live.revision,
            staging.revision,
            publishedAt,
            stagingRows.map(({ rows }) => rows.length),
          ),
        ]);
        confirmRevisionWrite(results[results.length - 1]);
      }

      return {
        ok: true,
        skipped: false,
        tables,
        rowsWritten: tables.reduce((sum, table) => sum + table.rowsWritten, 0),
        rowsDeleted: tables.reduce((sum, table) => sum + table.rowsDeleted, 0),
        publishedAt,
      };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn({
      source: "calendar-sync-store",
      message: "live publish failed",
      detail: err,
    });
    return { ok: false, error: message };
  }
}

async function commitObservationSnapshot(
  executor: TransactionalDbExecutor,
  payload: CalendarObservationSyncPayload,
  cleanup?: { sourceIds: string[]; expectedRevision: number },
) {
  const [current, observed, existingEntities, scopes, exclusions] = await executor.batch([
    READ_REVISION,
    readActiveObservationsForRange(payload.range),
    readEntityIdsForRange(payload.range),
    READ_CALENDAR_COVERAGE,
    readCalendarProjectionExclusions(payload.range),
  ]);
  const { revision } = readRevision(current);
  const now = Math.max(Date.now(), revision + 1);
  const projection = legacyCalendarProjection(payload, scopes.rows, exclusions.rows);
  const incoming = new Map(payload.observations.map((observation) => [
    observation.observationId, observation,
  ]));
  const incomingSources = new Map(payload.sources.map((source) => [source.id, source]));
  const active = [...incoming.values()].filter((observation) =>
    observation.startsAt < payload.range.endsAt && observation.endsAt > payload.range.startsAt &&
    projection.includes(observation, incomingSources.get(observation.sourceId)));
  const staleIds: string[] = [];
  for (const row of observed.rows) {
    const id = String(row.observation_id);
    if (incoming.has(id)) continue;
    const observation = decodeObservation(row.body_json);
    const included = observation && projection.includes(observation, {
      provider: row.provider, externalSourceId: row.external_source_id,
    });
    if (payload.syncMode === "snapshot" && row.collector_id === payload.collector.id && projection.canTombstoneOwn(observation)) {
      staleIds.push(id);
    } else if (included && observation) {
      active.push(observation);
    }
  }
  if (projection.hasNewCoverage) {
    // Old maintenance tombstones may still have an exact copy in a bundled calendar.
    const deleted = await executor.batch([readDeletedLegacyObservationsForRange(payload.range)]);
    for (const row of deleted[0].rows) {
      const observation = decodeObservation(row.body_json);
      if (observation) projection.includes(observation, { provider: row.provider, externalSourceId: row.external_source_id });
    }
  }
  const exclusionTable = CALENDAR_OBSERVATION_MIRROR_TABLES.find((table) => table.name === "calendar_projection_exclusions")!;
  const exclusionWrites = [...chunks([...projection.newRows.values()], exclusionTable.batchSize)].map((batch) => ({
    sql: buildMirrorUpsertSql(exclusionTable, batch.length),
    args: batch.flatMap((row) => [...row, now]),
  }));
  const entities = mergeCalendarObservations(active);
  const activeEntityIds = new Set(entities.map(({ id }) => id));
  const staleEntityIds = existingEntities.rows.map(({ entity_id }) => String(entity_id))
    .filter((id) => !activeEntityIds.has(id));

  const [receipt] = await executor.batch([
    advanceRevision(cleanup?.expectedRevision ?? revision, now, new Date(now).toISOString()),
    ...sourceWrites(payload, now),
    ...observationWrites(payload, now),
    ...tombstoneWrites(staleIds, payload.observedAt, now),
    ...exclusionWrites,
    ...clearExcludedEntityRefs([...projection.excludedObservationIds], now),
    ...entityWrites(entities, now),
    ...deleteRows("calendar_event_entities", "entity_id", staleEntityIds),
    ...observationEntityRefWrites(entities, now),
    ...(cleanup
      ? collectorCleanupStateWrites(payload, cleanup.sourceIds, now)
      : syncStateWrites(payload, now)),
  ]);
  confirmRevisionWrite(receipt);
  return { entitiesWritten: entities.length, staleObservations: staleIds.length, revision: now };
}

export async function writeCalendarObservationSync(
  payload: CalendarObservationSyncPayload,
  executor = tryGetD1Executor(),
): Promise<CalendarObservationSyncResult> {
  if (!executor) {
    return { ok: true, skipped: true, reason: "no_executor" };
  }
  try {
    const result = await retryRevisionConflict(() =>
      commitObservationSnapshot(executor, payload),
    );
    return {
      ok: true,
      skipped: false,
      sourcesWritten: payload.sources.length,
      observationsWritten: payload.observations.length,
      ...result,
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

function readCollectorCleanupScope(
  input: CalendarCollectorCleanupCommand,
): DbStatement {
  const rangeFilter = input.range
    ? `AND starts_at < ?
       AND ends_at > ?`
    : "";
  return {
    sql: `SELECT source_id,
                 MIN(starts_at) AS starts_at,
                 MAX(ends_at) AS ends_at
          FROM calendar_event_observations
          WHERE collector_id = ?
            ${rangeFilter}
          GROUP BY source_id
          ORDER BY source_id ASC`,
    args: input.range
      ? [input.collectorId, input.range.endsAt, input.range.startsAt]
      : [input.collectorId],
  };
}

function collectorCleanupScope(
  input: CalendarCollectorCleanupCommand,
  { rows }: DbResult,
) {
  const sourceIds = rows
    .map((row) => (typeof row.source_id === "string" ? row.source_id : ""))
    .filter(Boolean);
  if (input.range) return { range: input.range, sourceIds };
  if (!rows.length) return { range: null, sourceIds };

  const startsAt = rows.reduce<string | null>((earliest, row) => {
    const value = typeof row.starts_at === "string" ? row.starts_at : "";
    if (!value) return earliest;
    return earliest === null || value < earliest ? value : earliest;
  }, null);
  const endsAt = rows.reduce<string | null>((latest, row) => {
    const value = typeof row.ends_at === "string" ? row.ends_at : "";
    if (!value) return latest;
    return latest === null || value > latest ? value : latest;
  }, null);
  return startsAt && endsAt && Date.parse(endsAt) > Date.parse(startsAt)
    ? { range: { startsAt, endsAt }, sourceIds }
    : { range: null, sourceIds };
}

function collectorCleanupStateWrites(
  payload: CalendarObservationSyncPayload,
  sourceIds: readonly string[],
  now: number,
): DbStatement[] {
  const collectorId = payload.collector.id;
  return sourceIds.flatMap((sourceId) => [
    {
      sql: `INSERT INTO calendar_sync_state
            (id, collector_id, source_id, sync_mode, range_starts_at,
             range_ends_at, event_count, synced_at, updated_at)
            VALUES (?, ?, ?, 'snapshot', ?, ?,
              (SELECT COUNT(*) FROM calendar_event_observations
               WHERE collector_id = ? AND source_id = ? AND deleted_at IS NULL), ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              event_count = excluded.event_count,
              synced_at = excluded.synced_at,
              updated_at = excluded.updated_at`,
      args: [
        `${collectorId}:${sourceId}`,
        collectorId,
        sourceId,
        payload.range.startsAt,
        payload.range.endsAt,
        collectorId,
        sourceId,
        payload.observedAt,
        now,
      ],
    },
    {
      sql: `UPDATE calendar_sync_sources
            SET last_synced_at = ?, updated_at = ?,
                sync_scope_json = json_remove(sync_scope_json, '$.completeCalendarIds')
            WHERE id = ? AND collector_id = ?`,
      args: [payload.observedAt, now, sourceId, collectorId],
    },
  ]);
}

/**
 * Tombstone one collector's observations and rebuild the derived entity view.
 *
 * An empty collector snapshot only tombstones that collector in the range.
 * Include historical rows when finding the range so a retry can also repair
 * derived entities left by an older, non-transactional cleanup.
 */
export async function cleanupCalendarCollectorObservations(
  input: CalendarCollectorCleanupCommand,
  executor = tryGetD1Executor(),
): Promise<CalendarCollectorCleanupResult> {
  if (!executor) {
    return { ok: true, skipped: true, reason: "no_executor" };
  }
  const syncedAt = new Date().toISOString();
  try {
    return await retryRevisionConflict(async () => {
      const [current, sources] = await executor.batch([
        READ_REVISION,
        readCollectorCleanupScope(input),
      ]);
      const expectedRevision = readRevision(current).revision;
      const { range, sourceIds } = collectorCleanupScope(input, sources);
      const sync = range
        ? await commitObservationSnapshot(executor, {
            schemaVersion: 1,
            collector: { id: input.collectorId, kind: "manual" },
            sources: [],
            range,
            syncMode: "snapshot",
            observedAt: syncedAt,
            observations: [],
          }, { sourceIds, expectedRevision })
        : null;
      return {
        ok: true,
        skipped: false,
        collectorId: input.collectorId,
        range,
        tombstonedObservations: sync?.staleObservations ?? 0,
        entitiesWritten: sync?.entitiesWritten ?? 0,
        syncedAt,
        revision: sync?.revision ?? expectedRevision,
      };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn({
      source: "calendar-sync-store",
      message: "collector cleanup failed",
      detail: err,
      meta: { collectorId: input.collectorId },
    });
    return { ok: false, error: message };
  }
}

export async function readCalendarSyncHealth(
  executor: DbExecutor | null = tryGetD1Executor(),
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
