import type { Calendar, CalendarEvent } from "./types";

export type CalendarPublicVisibility = "hidden" | "busy" | "titleOnly" | "full";

export interface CalendarPublishMetadata {
  visibility: CalendarPublicVisibility;
  titleOverride?: string;
  descriptionOverride?: string;
  locationOverride?: string;
  urlOverride?: string;
}

export interface CalendarPublishMetadataStore {
  schemaVersion: 1;
  byEventKey: Record<string, CalendarPublishMetadata>;
}

export interface PublicCalendarEventPayload {
  id: string;
  calendarId?: string;
  calendarTitle?: string;
  colorHex?: string;
  title: string;
  startsAt: string;
  endsAt: string;
  isAllDay: boolean;
  visibility: Exclude<CalendarPublicVisibility, "hidden">;
  description?: string | null;
  location?: string | null;
  url?: string | null;
}

export interface PublicCalendarPayload {
  schemaVersion: 1;
  generatedAt: string;
  range: {
    startsAt: string;
    endsAt: string;
  };
  events: PublicCalendarEventPayload[];
}

const STORAGE_KEY = "workspace.calendar.public-metadata.v1";

export function calendarEventKey(event: CalendarEvent): string {
  return event.externalIdentifier || event.eventIdentifier;
}

export function emptyMetadataStore(): CalendarPublishMetadataStore {
  return { schemaVersion: 1, byEventKey: {} };
}

export function loadCalendarPublishMetadata(): CalendarPublishMetadataStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyMetadataStore();
    const parsed = JSON.parse(raw) as Partial<CalendarPublishMetadataStore>;
    const byEventKey =
      parsed.byEventKey && typeof parsed.byEventKey === "object"
        ? parsed.byEventKey
        : {};
    return {
      schemaVersion: 1,
      byEventKey: Object.fromEntries(
        Object.entries(byEventKey).map(([key, value]) => [
          key,
          normalizeMetadata(value),
        ]),
      ),
    };
  } catch {
    return emptyMetadataStore();
  }
}

export function saveCalendarPublishMetadata(
  store: CalendarPublishMetadataStore,
): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function metadataForEvent(
  store: CalendarPublishMetadataStore,
  event: CalendarEvent,
): CalendarPublishMetadata {
  return store.byEventKey[calendarEventKey(event)] ?? { visibility: "busy" };
}

export function updateMetadataForEvent(
  store: CalendarPublishMetadataStore,
  event: CalendarEvent,
  patch: Partial<CalendarPublishMetadata>,
): CalendarPublishMetadataStore {
  const key = calendarEventKey(event);
  const current = metadataForEvent(store, event);
  return {
    schemaVersion: 1,
    byEventKey: {
      ...store.byEventKey,
      [key]: normalizeMetadata({ ...current, ...patch }),
    },
  };
}

export function buildPublicCalendarPayload(input: {
  events: CalendarEvent[];
  calendarsById: Map<string, Calendar>;
  metadata: CalendarPublishMetadataStore;
  range: { startsAt: string; endsAt: string };
}): PublicCalendarPayload {
  const projected: PublicCalendarEventPayload[] = [];
  for (const event of input.events) {
    const meta = metadataForEvent(input.metadata, event);
    if (meta.visibility === "hidden") continue;
    const visibility = meta.visibility;
    const calendar = input.calendarsById.get(event.calendarId);
    const title =
      visibility === "busy"
        ? "Busy"
        : meta.titleOverride?.trim() || event.title || "(No title)";
    projected.push({
      id: calendarEventKey(event),
      calendarId: event.calendarId,
      calendarTitle: calendar?.title,
      colorHex: calendar?.colorHex,
      title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      isAllDay: event.isAllDay,
      visibility,
      description:
        visibility === "full"
          ? meta.descriptionOverride?.trim() || event.notes || null
          : null,
      location:
        visibility === "full"
          ? meta.locationOverride?.trim() || event.location || null
          : null,
      url:
        visibility === "full"
          ? meta.urlOverride?.trim() || event.url || null
          : null,
    });
  }
  projected.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    range: input.range,
    events: projected,
  };
}

function normalizeMetadata(raw: unknown): CalendarPublishMetadata {
  const obj =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const visibility = normalizeVisibility(obj.visibility);
  return {
    visibility,
    titleOverride: normalizeOptionalString(obj.titleOverride),
    descriptionOverride: normalizeOptionalString(obj.descriptionOverride),
    locationOverride: normalizeOptionalString(obj.locationOverride),
    urlOverride: normalizeOptionalString(obj.urlOverride),
  };
}

function normalizeVisibility(raw: unknown): CalendarPublicVisibility {
  return raw === "busy" || raw === "titleOnly" || raw === "full"
    ? raw
    : "hidden";
}

function normalizeOptionalString(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim() ? raw : undefined;
}
