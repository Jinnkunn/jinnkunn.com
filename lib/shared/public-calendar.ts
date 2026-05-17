export const PUBLIC_CALENDAR_CACHE_TAG = "public-calendar";
export const PUBLIC_CALENDAR_SERVED_AT_HEADER = "X-Calendar-Served-At";

export type PublicCalendarVisibility = "busy" | "titleOnly" | "full";
export type PublicCalendarAudience = "featured" | "all";

export type PublicCalendarEvent = {
  id: string;
  calendarId?: string;
  calendarTitle?: string;
  colorHex?: string;
  title: string;
  startsAt: string;
  endsAt: string;
  isAllDay: boolean;
  visibility: PublicCalendarVisibility;
  audience?: PublicCalendarAudience;
  description?: string | null;
  location?: string | null;
  url?: string | null;
};

export type PublicCalendarData = {
  schemaVersion: 1;
  generatedAt: string;
  range: {
    startsAt: string;
    endsAt: string;
  };
  events: PublicCalendarEvent[];
};

const PUBLIC_BUSY_COLOR = "#9B9A97";
const BUSY_ROUND_MINUTES = 15;
const VISIBILITIES = new Set<PublicCalendarVisibility>([
  "busy",
  "titleOnly",
  "full",
]);

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableString(value: unknown): string | null {
  const str = normalizeString(value);
  return str ? str : null;
}

function normalizeIso(value: unknown, fallback: string): string {
  const raw = normalizeString(value);
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return fallback;
  return new Date(ms).toISOString();
}

export function normalizePublicCalendarServedAt(
  value: unknown,
  fallback = new Date().toISOString(),
): string {
  return normalizeIso(value, fallback);
}

function normalizeColorHex(value: unknown): string | undefined {
  const raw = normalizeString(value);
  if (!/^#[0-9a-f]{6}$/i.test(raw)) return undefined;
  return raw.toUpperCase();
}

function normalizeAudience(value: unknown): PublicCalendarAudience | undefined {
  const raw = normalizeString(value);
  return raw === "featured" || raw === "all" ? raw : undefined;
}

function normalizeEvent(raw: unknown): PublicCalendarEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const id = normalizeString(obj.id);
  const startsAt = normalizeIso(obj.startsAt, "");
  const endsAt = normalizeIso(obj.endsAt, "");
  const visibilityRaw = normalizeString(obj.visibility) as PublicCalendarVisibility;
  const visibility = VISIBILITIES.has(visibilityRaw) ? visibilityRaw : null;
  if (!id || !startsAt || !endsAt || !visibility) return null;
  if (Date.parse(endsAt) <= Date.parse(startsAt)) return null;

  const title =
    visibility === "busy"
      ? "Busy"
      : normalizeString(obj.title) || "(No title)";

  return {
    id,
    calendarId: visibility === "busy" ? undefined : normalizeString(obj.calendarId) || undefined,
    calendarTitle: visibility === "busy" ? undefined : normalizeString(obj.calendarTitle) || undefined,
    colorHex: visibility === "busy" ? "#9B9A97" : normalizeColorHex(obj.colorHex),
    title,
    startsAt,
    endsAt,
    isAllDay: Boolean(obj.isAllDay),
    visibility,
    audience: normalizeAudience(obj.audience),
    description:
      visibility === "full" ? normalizeNullableString(obj.description) : null,
    location: visibility === "full" ? normalizeNullableString(obj.location) : null,
    url: visibility === "full" ? normalizeNullableString(obj.url) : null,
  };
}

// Time-decay archiving: events older than this many days are dropped
// from the public projection so the agenda doesn't grow unbounded.
// 30 days is the default — past events fade out a month after they
// happen, which matches how a CV / résumé treats "past talks": the
// recent few stay visible, the long tail moves to a separate archive
// page (when one exists). Tunable via `filterStalePublicCalendarEvents`.
export const DEFAULT_PUBLIC_CALENDAR_PAST_DAYS = 30;

export interface FilterStaleOptions {
  /** Drop events whose `endsAt` is more than this many days in the
   * past. Set to `Infinity` to disable archiving (useful for a
   * future "/calendar/archive" route). */
  maxPastDays?: number;
  /** Override `now` for tests. Production should leave it unset so
   * the worker's current time is the cutoff anchor. */
  now?: Date;
}

export function filterStalePublicCalendarEvents(
  data: PublicCalendarData,
  options: FilterStaleOptions = {},
): PublicCalendarData {
  const maxPastDays = options.maxPastDays ?? DEFAULT_PUBLIC_CALENDAR_PAST_DAYS;
  if (!Number.isFinite(maxPastDays)) return data;
  const now = options.now ?? new Date();
  const cutoff = now.getTime() - maxPastDays * 86_400_000;
  const filtered = data.events.filter((event) => {
    const endsMs = Date.parse(event.endsAt);
    if (!Number.isFinite(endsMs)) return true; // malformed → keep, let UI decide
    return endsMs >= cutoff;
  });
  if (filtered.length === data.events.length) return data;
  return { ...data, events: filtered };
}

export function normalizePublicCalendarData(raw: unknown): PublicCalendarData {
  const obj =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const now = new Date().toISOString();
  const startsAt = normalizeIso((obj.range as Record<string, unknown> | undefined)?.startsAt, now);
  const endsAt = normalizeIso((obj.range as Record<string, unknown> | undefined)?.endsAt, startsAt);
  const events = Array.isArray(obj.events)
    ? obj.events
        .map(normalizeEvent)
        .filter((event): event is PublicCalendarEvent => Boolean(event))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title))
    : [];

  return {
    schemaVersion: 1,
    generatedAt: normalizeIso(obj.generatedAt, now),
    range: {
      startsAt,
      endsAt: Date.parse(endsAt) > Date.parse(startsAt) ? endsAt : startsAt,
    },
    events,
  };
}

export function publicCalendarJson(data: PublicCalendarData): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

function timestampMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function earlierIso(left: string, right: string): string {
  return timestampMs(left) <= timestampMs(right) ? left : right;
}

function laterIso(left: string, right: string): string {
  return timestampMs(left) >= timestampMs(right) ? left : right;
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

function toBusySupplementEvent(event: PublicCalendarEvent): PublicCalendarEvent {
  const rounded = event.isAllDay
    ? { startsAt: event.startsAt, endsAt: event.endsAt }
    : roundBusyWindow(event.startsAt, event.endsAt);
  return {
    id: event.id,
    title: "Busy",
    startsAt: rounded.startsAt,
    endsAt: rounded.endsAt,
    isAllDay: event.isAllDay,
    visibility: "busy",
    colorHex: PUBLIC_BUSY_COLOR,
    description: null,
    location: null,
    url: null,
  };
}

function overlapMs(left: PublicCalendarEvent, right: PublicCalendarEvent): number {
  const startsAt = Math.max(timestampMs(left.startsAt), timestampMs(right.startsAt));
  const endsAt = Math.min(timestampMs(left.endsAt), timestampMs(right.endsAt));
  return Math.max(0, endsAt - startsAt);
}

function eventDurationMs(event: PublicCalendarEvent): number {
  return Math.max(0, timestampMs(event.endsAt) - timestampMs(event.startsAt));
}

function isCoveredByPublicEvent(
  publicEvent: PublicCalendarEvent,
  observedBusy: PublicCalendarEvent,
): boolean {
  if (publicEvent.id === observedBusy.id) return true;
  if (publicEvent.isAllDay !== observedBusy.isAllDay) return false;
  const overlap = overlapMs(publicEvent, observedBusy);
  if (overlap <= 0) return false;
  const publicDuration = eventDurationMs(publicEvent);
  const observedDuration = eventDurationMs(observedBusy);
  const shortest = Math.min(publicDuration, observedDuration);
  return shortest > 0 && overlap / shortest >= 0.8;
}

function mergeBusyRuntimeEvents(
  events: readonly PublicCalendarEvent[],
): PublicCalendarEvent[] {
  const sorted = [...events].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt) ||
    a.endsAt.localeCompare(b.endsAt) ||
    a.title.localeCompare(b.title),
  );
  const out: PublicCalendarEvent[] = [];
  for (const event of sorted) {
    const previous = out[out.length - 1];
    if (
      previous &&
      previous.visibility === "busy" &&
      event.visibility === "busy" &&
      previous.isAllDay === event.isAllDay &&
      timestampMs(event.startsAt) <= timestampMs(previous.endsAt)
    ) {
      if (timestampMs(event.endsAt) > timestampMs(previous.endsAt)) {
        previous.endsAt = event.endsAt;
      }
      if (!previous.id.includes(event.id)) previous.id = `${previous.id}+${event.id}`;
      continue;
    }
    out.push({ ...event });
  }
  return out;
}

export function supplementPublicCalendarWithObservedData({
  publicData,
  observedData,
}: {
  publicData: PublicCalendarData;
  observedData: PublicCalendarData | null | undefined;
}): PublicCalendarData {
  if (!observedData?.events.length) return publicData;

  const events = [...publicData.events];
  for (const observed of observedData.events) {
    const busy = toBusySupplementEvent(observed);
    if (events.some((event) => isCoveredByPublicEvent(event, busy))) continue;
    events.push(busy);
  }

  return normalizePublicCalendarData({
    schemaVersion: 1,
    generatedAt: laterIso(publicData.generatedAt, observedData.generatedAt),
    range: {
      startsAt: earlierIso(publicData.range.startsAt, observedData.range.startsAt),
      endsAt: laterIso(publicData.range.endsAt, observedData.range.endsAt),
    },
    events: mergeBusyRuntimeEvents(events),
  });
}

export function selectPublicCalendarRuntimeData({
  dbData,
  sourceData,
  observedData,
}: {
  dbData: PublicCalendarData | null | undefined;
  sourceData: PublicCalendarData;
  observedData?: PublicCalendarData | null | undefined;
}): PublicCalendarData {
  if (!dbData) {
    return supplementPublicCalendarWithObservedData({ publicData: sourceData, observedData });
  }

  const dbGeneratedAt = timestampMs(dbData.generatedAt);
  const sourceGeneratedAt = timestampMs(sourceData.generatedAt);
  if (dbGeneratedAt > sourceGeneratedAt) {
    return supplementPublicCalendarWithObservedData({ publicData: dbData, observedData });
  }
  if (sourceGeneratedAt > dbGeneratedAt) {
    return supplementPublicCalendarWithObservedData({ publicData: sourceData, observedData });
  }

  // When a full release embeds a richer calendar JSON snapshot but an
  // older live D1 projection has the same generatedAt with fewer rows,
  // prefer the complete source snapshot. That keeps static HTML and the
  // hydration refresh from showing different event sets.
  return supplementPublicCalendarWithObservedData({
    publicData: sourceData.events.length > dbData.events.length ? sourceData : dbData,
    observedData,
  });
}

export function selectPublicCalendarHydrationData({
  currentData,
  refreshedData,
}: {
  currentData: PublicCalendarData;
  refreshedData: PublicCalendarData;
}): PublicCalendarData {
  const refreshedGeneratedAt = timestampMs(refreshedData.generatedAt);
  const currentGeneratedAt = timestampMs(currentData.generatedAt);
  const responseIsNotNewer = refreshedGeneratedAt <= currentGeneratedAt;
  const refreshedIds = new Set(refreshedData.events.map((event) => event.id));
  const refreshedContainsCurrent = currentData.events.every((event) =>
    refreshedIds.has(event.id),
  );

  if (responseIsNotNewer && !refreshedContainsCurrent) {
    return currentData;
  }
  if (refreshedContainsCurrent) {
    return refreshedData;
  }

  // The live calendar endpoint can briefly return a newer but partial
  // overlay while a desktop sync/write is still settling. Hydration
  // should never make visible events disappear on page load; merge the
  // refreshed rows over the static rows so new/updated events appear
  // without dropping rows the static shell already proved renderable.
  const carried = currentData.events.filter((event) => !refreshedIds.has(event.id));
  return normalizePublicCalendarData({
    ...refreshedData,
    events: [...refreshedData.events, ...carried],
  });
}
