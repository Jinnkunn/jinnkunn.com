import {
  calendarFetchEvents,
  calendarListSources,
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
  syncCalendarObservations,
  publishPublicCalendarToProduction,
  syncPublicCalendarProjection,
  type CalendarProductionPromotionResult,
} from "./siteAdminBridge";
import {
  fingerprintPublicCalendarPayload,
  loadProjectionFingerprint,
  loadProductionPromotionFingerprint,
  saveProjectionFingerprint,
  saveProductionPromotionFingerprint,
  saveSyncSnapshot,
  type SnapshotEventEntry,
  type SyncSnapshot,
} from "./syncSnapshot";
import { loadActiveRules, resolveSmartDefault } from "./smartDefaults";
import type {
  Calendar,
  CalendarEvent,
  CalendarSource,
  CalendarSourceType,
} from "./types";
import {
  normalizeCalendarObservationSyncPayload,
  type CalendarObservationInput,
  type CalendarSourceDescriptor,
} from "../../../../../lib/shared/calendar-core.ts";

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
const COLLECTOR_ID_STORAGE_KEY = "workspace.calendar.collectorId.v1";

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

function loadCollectorId(): string {
  try {
    const existing = localStorage.getItem(COLLECTOR_ID_STORAGE_KEY);
    if (existing) return existing;
    const random =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const collectorId = `tauri-macos:${random}`;
    localStorage.setItem(COLLECTOR_ID_STORAGE_KEY, collectorId);
    return collectorId;
  } catch {
    return "tauri-macos:unknown";
  }
}

function calendarSourceProvider(
  sourceType: CalendarSourceType,
): CalendarSourceDescriptor["provider"] {
  if (sourceType === "mobileMe") return "apple";
  if (sourceType === "exchange") return "outlook";
  if (sourceType === "calDAV") return "caldav";
  if (sourceType === "subscribed") return "ics";
  if (sourceType === "local" || sourceType === "birthdays") return "local";
  return "unknown";
}

function calendarSyncSourceId(sourceId: string): string {
  return `eventkit:${sourceId}`;
}

function buildObservationSyncPayload(input: {
  sources: CalendarSource[];
  calendarsById: ReadonlyMap<string, Calendar>;
  events: readonly CalendarEvent[];
  range: { startsAt: string; endsAt: string };
}) {
  const collectorId = loadCollectorId();
  const sourceDescriptors: CalendarSourceDescriptor[] = input.sources.map((source) => ({
    id: calendarSyncSourceId(source.id),
    provider: calendarSourceProvider(source.sourceType),
    title: source.title,
    externalSourceId: source.id,
    syncScope: {
      adapter: "eventkit",
      platform: "macos",
    },
  }));
  const sourceIds = new Set(sourceDescriptors.map((source) => source.id));
  const observations: CalendarObservationInput[] = input.events.map((event) => {
    const calendar = input.calendarsById.get(event.calendarId);
    const sourceId = calendar
      ? calendarSyncSourceId(calendar.sourceId)
      : calendarSyncSourceId("unknown");
    if (!sourceIds.has(sourceId)) {
      sourceDescriptors.push({
        id: sourceId,
        provider: "unknown",
        title: calendar?.title ?? "Calendar",
        externalSourceId: calendar?.sourceId ?? "unknown",
        syncScope: {
          adapter: "eventkit",
          platform: "macos",
        },
      });
      sourceIds.add(sourceId);
    }
    return {
      sourceId,
      collectorId,
      sourceEventId: event.eventIdentifier,
      iCalUid: event.externalIdentifier,
      recurrenceInstanceId: event.isRecurring ? event.startsAt : null,
      calendarId: event.calendarId,
      calendarTitle: calendar?.title ?? null,
      title: event.title,
      notes: event.notes,
      location: event.location,
      url: event.url,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      isAllDay: event.isAllDay,
      isRecurring: event.isRecurring,
    };
  });
  return normalizeCalendarObservationSyncPayload({
    schemaVersion: 1,
    collector: {
      id: collectorId,
      kind: "tauri-macos",
      title: "Workspace for macOS",
    },
    sources: sourceDescriptors,
    range: input.range,
    syncMode: "snapshot",
    observedAt: new Date().toISOString(),
    observations,
  });
}

async function syncObservationSnapshotBestEffort(input: {
  sources: CalendarSource[];
  calendarsById: ReadonlyMap<string, Calendar>;
  events: readonly CalendarEvent[];
  range: { startsAt: string; endsAt: string };
}): Promise<void> {
  const result = await syncCalendarObservations(buildObservationSyncPayload(input));
  if (!result.ok) {
    console.warn("[calendar] observation sync failed", result.error);
  }
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

async function maybePromotePublicCalendarToProduction(
  policy: CalendarProductionSyncPolicy,
  fingerprint: string,
  payload: PublicCalendarPayload,
): Promise<CalendarProductionPromotionResult | null> {
  if (policy !== "auto-promote") return null;
  if (loadProductionPromotionFingerprint() === fingerprint) return null;
  const production = await publishPublicCalendarToProduction(payload);
  if (production.ok) saveProductionPromotionFingerprint(fingerprint);
  return production;
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
    const productionPolicy =
      input.productionPolicy ?? loadCalendarProductionSyncPolicy();

    if (input.skipIfUnchanged !== false) {
      const previous = loadProjectionFingerprint();
      if (previous && previous === fingerprint) {
        saveSyncSnapshot(snapshot);
        const production = await maybePromotePublicCalendarToProduction(
          productionPolicy,
          fingerprint,
          payload,
        );
        return {
          ok: true,
          status: "unchanged",
          reason: input.reason,
          eventCount: payload.events.length,
          baseUrl: "",
          fileSha: "",
          fingerprint,
          payload,
          production,
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
    const production = await maybePromotePublicCalendarToProduction(
      productionPolicy,
      fingerprint,
      payload,
    );
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
  const [sources, calendars, events, metadata] = await Promise.all([
    input.calendarsById ? Promise.resolve([] as CalendarSource[]) : calendarListSources(),
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
  const mergedEvents = mergeCalendarEvents(events, input.extraEvents ?? []);
  const range = rangeUnion(publishWindow, input.extraRange);
  if (!input.calendarsById) {
    await syncObservationSnapshotBestEffort({
      sources,
      calendarsById,
      events: mergedEvents,
      range,
    });
  }
  return publishCalendarProjection({
    calendarsById,
    calendarDefaults,
    events: mergedEvents,
    metadata,
    productionPolicy: input.productionPolicy,
    range,
    reason: input.reason,
    skipIfUnchanged: input.skipIfUnchanged,
  });
}
