import {
  calendarFetchEvents,
  calendarListCalendars,
} from "./api";
import { loadCalendarDefaultRules } from "./calendarDefaults";
import { startOfDay } from "./dateRange";
import {
  loadCalendarProductionSyncPolicy,
  type CalendarProductionSyncPolicy,
} from "./productionSyncPolicy";
import {
  buildPublicCalendarPayload,
  calendarEventKey,
  type CalendarPublicVisibility,
  type CalendarPublishMetadataStore,
  type PublicCalendarPayload,
} from "./publicProjection";
import { loadCalendarPublishRules } from "./publishRulesStore";
import {
  promotePublicCalendarToProduction,
  syncPublicCalendarProjection,
  type CalendarProductionPromotionResult,
} from "./siteAdminBridge";
import {
  fingerprintPublicCalendarPayload,
  loadProjectionFingerprint,
  saveProjectionFingerprint,
  saveSyncSnapshot,
  type SnapshotEventEntry,
  type SyncSnapshot,
} from "./syncSnapshot";
import { loadActiveRules, resolveSmartDefault } from "./smartDefaults";
import type { Calendar, CalendarEvent } from "./types";

export type CalendarSyncReason = "auto" | "manual" | "background";
export type CalendarSyncStatus = "synced" | "unchanged";

export interface CalendarProjectionSyncSuccess {
  ok: true;
  status: CalendarSyncStatus;
  reason: CalendarSyncReason;
  eventCount: number;
  baseUrl: string;
  fileSha: string;
  fingerprint: string;
  payload: PublicCalendarPayload;
  production: CalendarProductionPromotionResult | null;
  snapshot: SyncSnapshot;
}

export interface CalendarProjectionSyncFailure {
  ok: false;
  reason: CalendarSyncReason;
  baseUrl: string;
  error: string;
}

export type CalendarProjectionSyncResult =
  | CalendarProjectionSyncSuccess
  | CalendarProjectionSyncFailure;

let syncInFlight: Promise<CalendarProjectionSyncResult> | null = null;

export function mergeCalendarEvents(
  primary: readonly CalendarEvent[],
  secondary: readonly CalendarEvent[],
): CalendarEvent[] {
  const seen = new Set<string>();
  const out: CalendarEvent[] = [];
  for (const event of [...primary, ...secondary]) {
    const key = `${calendarEventKey(event)}::${event.startsAt}::${event.endsAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}

export function serializeCalendarDefaults(
  defaults: ReadonlyMap<string, CalendarPublicVisibility>,
): Array<[string, CalendarPublicVisibility]> {
  return [...defaults.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
}

function syncSnapshotForPayload(payload: PublicCalendarPayload): SyncSnapshot {
  const events: SnapshotEventEntry[] = payload.events.map((entry) => ({
    id: entry.id,
    title: entry.title,
    visibility: entry.visibility,
  }));
  return {
    syncedAt: new Date().toISOString(),
    events,
  };
}

function rangeUnion(
  left: { startsAt: string; endsAt: string },
  right?: { startsAt: string; endsAt: string },
): { startsAt: string; endsAt: string } {
  if (!right) return left;
  return {
    startsAt:
      Date.parse(right.startsAt) < Date.parse(left.startsAt)
        ? right.startsAt
        : left.startsAt,
    endsAt:
      Date.parse(right.endsAt) > Date.parse(left.endsAt)
        ? right.endsAt
        : left.endsAt,
  };
}

async function runSerializedSync(
  task: () => Promise<CalendarProjectionSyncResult>,
): Promise<CalendarProjectionSyncResult> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = task().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

export async function publishCalendarProjection(input: {
  calendarsById: ReadonlyMap<string, Calendar>;
  calendarDefaults: ReadonlyMap<string, CalendarPublicVisibility>;
  events: CalendarEvent[];
  metadata: CalendarPublishMetadataStore;
  range: { startsAt: string; endsAt: string };
  reason: CalendarSyncReason;
  skipIfUnchanged?: boolean;
  productionPolicy?: CalendarProductionSyncPolicy;
}): Promise<CalendarProjectionSyncResult> {
  return runSerializedSync(async () => {
    const smartRules = loadActiveRules();
    const payload = buildPublicCalendarPayload({
      events: input.events,
      calendarsById: new Map(input.calendarsById),
      metadata: input.metadata,
      calendarDefaults: input.calendarDefaults,
      smartResolver: (event) => resolveSmartDefault(event, smartRules),
      range: input.range,
    });
    const fingerprint = fingerprintPublicCalendarPayload(payload);
    const snapshot = syncSnapshotForPayload(payload);

    if (input.skipIfUnchanged !== false) {
      const previous = loadProjectionFingerprint();
      if (previous && previous === fingerprint) {
        saveSyncSnapshot(snapshot);
        return {
          ok: true,
          status: "unchanged",
          reason: input.reason,
          eventCount: payload.events.length,
          baseUrl: "",
          fileSha: "",
          fingerprint,
          payload,
          production: null,
          snapshot,
        };
      }
    }

    const result = await syncPublicCalendarProjection(payload);
    if (!result.ok) {
      return {
        ok: false,
        reason: input.reason,
        baseUrl: result.baseUrl,
        error: result.error,
      };
    }

    saveProjectionFingerprint(fingerprint);
    saveSyncSnapshot(snapshot);
    const productionPolicy =
      input.productionPolicy ?? loadCalendarProductionSyncPolicy();
    const production =
      productionPolicy === "auto-promote"
        ? await promotePublicCalendarToProduction()
        : null;
    return {
      ok: true,
      status: "synced",
      reason: input.reason,
      eventCount: payload.events.length,
      baseUrl: result.baseUrl,
      fileSha: result.fileSha,
      fingerprint,
      payload,
      production,
      snapshot,
    };
  });
}

export async function syncCurrentEventKitCalendarProjection(input: {
  calendarDefaults?: ReadonlyMap<string, CalendarPublicVisibility>;
  calendarsById?: ReadonlyMap<string, Calendar>;
  extraEvents?: readonly CalendarEvent[];
  extraRange?: { startsAt: string; endsAt: string };
  metadata?: CalendarPublishMetadataStore;
  productionPolicy?: CalendarProductionSyncPolicy;
  reason: CalendarSyncReason;
  skipIfUnchanged?: boolean;
}): Promise<CalendarProjectionSyncResult> {
  const starts = startOfDay(new Date());
  const ends = new Date(starts);
  ends.setFullYear(ends.getFullYear() + 1);
  const publishWindow = {
    startsAt: starts.toISOString(),
    endsAt: ends.toISOString(),
  };
  const [calendars, events, metadata] = await Promise.all([
    input.calendarsById
      ? Promise.resolve([...input.calendarsById.values()])
      : calendarListCalendars(),
    calendarFetchEvents({
      ...publishWindow,
      calendarIds: [],
    }),
    input.metadata ? Promise.resolve(input.metadata) : loadCalendarPublishRules(),
  ]);
  const calendarsById = new Map(calendars.map((calendar) => [calendar.id, calendar]));
  const calendarDefaults = input.calendarDefaults ?? loadCalendarDefaultRules();
  return publishCalendarProjection({
    calendarsById,
    calendarDefaults,
    events: mergeCalendarEvents(events, input.extraEvents ?? []),
    metadata,
    productionPolicy: input.productionPolicy,
    range: rangeUnion(publishWindow, input.extraRange),
    reason: input.reason,
    skipIfUnchanged: input.skipIfUnchanged,
  });
}
