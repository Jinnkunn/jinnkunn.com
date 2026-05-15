export const PUBLIC_CALENDAR_CACHE_TAG = "public-calendar";
export const PUBLIC_CALENDAR_SERVED_AT_HEADER = "X-Calendar-Served-At";

export type PublicCalendarVisibility = "busy" | "titleOnly" | "full";

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

export function selectPublicCalendarRuntimeData({
  dbData,
  sourceData,
}: {
  dbData: PublicCalendarData | null | undefined;
  sourceData: PublicCalendarData;
}): PublicCalendarData {
  if (!dbData) return sourceData;

  const dbGeneratedAt = timestampMs(dbData.generatedAt);
  const sourceGeneratedAt = timestampMs(sourceData.generatedAt);
  if (dbGeneratedAt > sourceGeneratedAt) return dbData;
  if (sourceGeneratedAt > dbGeneratedAt) return sourceData;

  // When a full release embeds a richer calendar JSON snapshot but an
  // older live D1 projection has the same generatedAt with fewer rows,
  // prefer the complete source snapshot. That keeps static HTML and the
  // hydration refresh from showing different event sets.
  return sourceData.events.length > dbData.events.length ? sourceData : dbData;
}
