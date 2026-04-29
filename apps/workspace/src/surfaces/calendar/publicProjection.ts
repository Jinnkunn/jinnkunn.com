import type { Calendar, CalendarEvent } from "./types";

export type CalendarPublicVisibility = "hidden" | "busy" | "titleOnly" | "full";

const PUBLIC_BUSY_COLOR = "#9B9A97";
const BUSY_ROUND_MINUTES = 15;

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

export function calendarEventKey(event: CalendarEvent): string {
  return event.externalIdentifier || event.eventIdentifier;
}

export function emptyMetadataStore(): CalendarPublishMetadataStore {
  return { schemaVersion: 1, byEventKey: {} };
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
      [key]: normalizeCalendarPublishMetadata({ ...current, ...patch }),
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
    if (shouldSkipPublicEvent(event, calendar)) continue;
    const title =
      visibility === "busy"
        ? "Busy"
        : meta.titleOverride?.trim() || event.title || "(No title)";
    const rounded =
      visibility === "busy"
        ? roundBusyWindow(event.startsAt, event.endsAt)
        : { startsAt: event.startsAt, endsAt: event.endsAt };
    projected.push({
      id: calendarEventKey(event),
      calendarId: visibility === "busy" ? undefined : event.calendarId,
      calendarTitle: visibility === "busy" ? undefined : calendar?.title,
      colorHex: visibility === "busy" ? PUBLIC_BUSY_COLOR : calendar?.colorHex,
      title,
      startsAt: rounded.startsAt,
      endsAt: rounded.endsAt,
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
  const merged = mergeBusyEvents(projected);
  merged.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    range: input.range,
    events: merged,
  };
}

export function normalizeCalendarPublishMetadata(raw: unknown): CalendarPublishMetadata {
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

function shouldSkipPublicEvent(
  event: CalendarEvent,
  calendar: Calendar | undefined,
): boolean {
  const title = `${event.title} ${calendar?.title ?? ""}`.toLowerCase();
  return /declined|cancelled|canceled|holiday|holidays|节假日|生日|birthday/.test(
    title,
  );
}

function roundBusyWindow(startsAt: string, endsAt: string): {
  startsAt: string;
  endsAt: string;
} {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  const step = BUSY_ROUND_MINUTES * 60 * 1000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { startsAt, endsAt };
  }
  const roundedStart = Math.floor(start / step) * step;
  const roundedEnd = Math.max(roundedStart + step, Math.ceil(end / step) * step);
  return {
    startsAt: new Date(roundedStart).toISOString(),
    endsAt: new Date(roundedEnd).toISOString(),
  };
}

function mergeBusyEvents(
  events: PublicCalendarEventPayload[],
): PublicCalendarEventPayload[] {
  const sorted = [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const out: PublicCalendarEventPayload[] = [];
  for (const event of sorted) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.visibility === "busy" &&
      event.visibility === "busy" &&
      prev.isAllDay === event.isAllDay &&
      Date.parse(event.startsAt) <= Date.parse(prev.endsAt)
    ) {
      if (Date.parse(event.endsAt) > Date.parse(prev.endsAt)) {
        prev.endsAt = event.endsAt;
      }
      prev.id = `${prev.id}+${event.id}`;
      continue;
    }
    out.push({ ...event });
  }
  return out;
}
