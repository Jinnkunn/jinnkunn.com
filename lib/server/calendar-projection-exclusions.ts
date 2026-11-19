import {
  completeCalendarIds,
  isDocsCalendarCollector,
  type CalendarObservation,
  type CalendarObservationSyncPayload,
} from "../shared/calendar-core.ts";
import type { DbStatement } from "./db-content-store.ts";

type Row = Record<string, unknown>;
type Range = CalendarObservationSyncPayload["range"];
type Origin = { provider: unknown; externalSourceId?: unknown };

export const READ_CALENDAR_COVERAGE: DbStatement = {
  sql: `SELECT s.collector_id, s.provider, s.external_source_id, s.sync_scope_json,
               st.range_starts_at, st.range_ends_at, st.synced_at
          FROM calendar_sync_sources s
          JOIN calendar_sync_state st ON st.source_id = s.id AND st.collector_id = s.collector_id
         WHERE s.collector_id LIKE 'electron-macos:%' AND st.sync_mode = 'snapshot'
           AND s.updated_at = st.updated_at
           AND st.synced_at = (SELECT MAX(latest.synced_at) FROM calendar_sync_state latest
                                WHERE latest.collector_id = s.collector_id)`,
};

export function readCalendarProjectionExclusions(range: Range): DbStatement {
  return {
    sql: `SELECT id FROM calendar_projection_exclusions WHERE starts_at < ? AND ends_at > ?`,
    args: [range.endsAt, range.startsAt],
  };
}

function readScope(value: unknown): Record<string, unknown> {
  try { return JSON.parse(String(value)) ?? {}; } catch { return {}; }
}

function legacyCollector(id: string): boolean {
  return id.startsWith("tauri-macos:") || id.startsWith("ios:");
}

export function legacyCalendarProjection(
  payload: CalendarObservationSyncPayload,
  savedScopes: Row[],
  savedExclusions: Row[],
) {
  const currentScopes = isDocsCalendarCollector(payload.collector.id) && payload.collector.kind === "tauri-macos" && payload.syncMode === "snapshot"
    ? payload.sources.map((source) => ({
        ...payload.range,
        sourceId: source.id,
        provider: source.provider,
        externalSourceId: source.externalSourceId,
        calendarIds: completeCalendarIds(source.syncScope),
      })).filter(({ calendarIds }) => calendarIds.length)
    : [];
  if (currentScopes.length && savedScopes.some((row) =>
    row.collector_id === payload.collector.id && String(row.synced_at) > payload.observedAt,
  )) {
    throw new Error("A newer complete calendar snapshot has already been accepted.");
  }
  const scopes = [...currentScopes, ...savedScopes.filter((row) => row.collector_id !== payload.collector.id).map((row) => ({
    startsAt: String(row.range_starts_at),
    endsAt: String(row.range_ends_at),
    provider: row.provider,
    externalSourceId: row.external_source_id,
    calendarIds: completeCalendarIds(readScope(row.sync_scope_json)),
  }))].filter((scope) => scope.externalSourceId && scope.provider && scope.provider !== "unknown" && scope.calendarIds.length);
  const existing = new Set(savedExclusions.map((row) => String(row.id)));
  const newRows = new Map<string, unknown[]>();
  const excludedObservationIds = new Set<string>();

  function includes(observation: CalendarObservation, origin: Origin | undefined): boolean {
    if (!legacyCollector(observation.collectorId)) return true;
    const { observationId, startsAt, endsAt, isAllDay, calendarId } = observation;
    const id = JSON.stringify([observationId, startsAt, endsAt, isAllDay]);
    if (!existing.has(id) && !newRows.has(id)) {
      if (!calendarId || !origin || !scopes.some((scope) =>
        scope.provider === origin.provider && scope.externalSourceId === origin.externalSourceId &&
        scope.calendarIds.includes(calendarId) && startsAt >= scope.startsAt && endsAt <= scope.endsAt,
      )) return true;
      const ids = [...new Set([observation.iCalUid, observation.sourceEventId, observationId].filter(Boolean))];
      newRows.set(id, [id, startsAt, endsAt, Number(isAllDay), JSON.stringify(ids)]);
    }
    excludedObservationIds.add(observationId);
    return false;
  }

  function canTombstoneOwn(observation: CalendarObservation | null): boolean {
    if (!currentScopes.length) return true;
    return !!observation?.calendarId && currentScopes.some((scope) => {
      const { calendarId, sourceId, startsAt, endsAt } = observation;
      return calendarId && scope.sourceId === sourceId && scope.calendarIds.includes(calendarId) &&
        startsAt >= scope.startsAt && endsAt <= scope.endsAt;
    });
  }

  return { includes, newRows, excludedObservationIds, canTombstoneOwn, hasNewCoverage: currentScopes.length > 0 };
}
