export const PUBLIC_CALENDAR_CACHE_TAG = "public-calendar";
export const PUBLIC_CALENDAR_SERVED_AT_HEADER = "X-Calendar-Served-At";
export const PUBLIC_CALENDAR_REVISION_HEADER = "X-Calendar-Revision";

export type PublicCalendarVisibility = "busy" | "titleOnly" | "full";
export type PublicCalendarAudience = "featured" | "all";

export type PublicCalendarEvent = {
  id: string;
  /** Public projection key for reused IDs. The original id still owns permalinks. */
  occurrenceId?: string;
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
  observationSnapshot?: { revision: number; eventIds: string[]; busyComplete?: true };
};

export type LegacyCalendarExclusion = Pick<PublicCalendarEvent, "startsAt" | "endsAt" | "isAllDay"> & {
  legacyIds: string[];
};

// Server-only inputs to the public projection, never included in its response.
export type ObservedPublicCalendarData = PublicCalendarData & { legacyExclusions?: LegacyCalendarExclusion[] };

const PUBLIC_BUSY_COLOR = "#9B9A97";
const BUSY_ROUND_MINUTES = 15;
const OCCURRENCE_PREFIX = "occ-v1:";
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

type CalendarSlot = Pick<PublicCalendarEvent, "id" | "startsAt" | "endsAt" | "isAllDay">;

function slotId({ id, startsAt, endsAt, isAllDay }: CalendarSlot): string {
  // Only use fields already visible in the public feed, never source IDs or details.
  return `${OCCURRENCE_PREFIX}${isAllDay ? "d" : "t"}:${Date.parse(startsAt).toString(36)}:${Date.parse(endsAt).toString(36)}:${id}`;
}

export function publicCalendarEventKey(event: Pick<PublicCalendarEvent, "id" | "occurrenceId">): string {
  return event.occurrenceId ?? event.id;
}

export function repeatedPublicCalendarIds(events: readonly CalendarSlot[]): Set<string> {
  const first = new Map<string, CalendarSlot>();
  const repeated = new Set<string>();
  for (const event of events) {
    const previous = first.get(event.id);
    if (!previous) first.set(event.id, event);
    else if (previous.startsAt !== event.startsAt || previous.endsAt !== event.endsAt || previous.isAllDay !== event.isAllDay) repeated.add(event.id);
  }
  return repeated;
}

export function identifyPublicCalendarOccurrences(
  events: readonly PublicCalendarEvent[],
  knownRepeatedIds?: ReadonlySet<string>,
): PublicCalendarEvent[] {
  const repeats = repeatedPublicCalendarIds(events);
  const seen = new Set<string>();
  const result: PublicCalendarEvent[] = [];
  for (const event of events) {
    const needsKey = event.occurrenceId !== undefined || event.id.startsWith(OCCURRENCE_PREFIX) ||
      repeats.has(event.id) || knownRepeatedIds?.has(event.id);
    const key = needsKey ? slotId(event) : event.id;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(needsKey && event.occurrenceId !== key ? { ...event, occurrenceId: key } : event);
  }
  return result;
}

function normalizeEvent(raw: unknown, preserveOccurrenceId: boolean): PublicCalendarEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const id = normalizeString(obj.id);
  const startsAt = normalizeIso(obj.startsAt, "");
  const endsAt = normalizeIso(obj.endsAt, "");
  const visibilityRaw = normalizeString(obj.visibility) as PublicCalendarVisibility;
  const visibility = VISIBILITIES.has(visibilityRaw) ? visibilityRaw : null;
  if (!id || !startsAt || !endsAt || !visibility) return null;
  if (Date.parse(endsAt) <= Date.parse(startsAt)) return null;
  const slot = { id, startsAt, endsAt, isAllDay: Boolean(obj.isAllDay) };
  const occurrenceId = preserveOccurrenceId && typeof obj.occurrenceId === "string" &&
    obj.occurrenceId === slotId(slot) ? obj.occurrenceId : undefined;

  const title =
    visibility === "busy"
      ? "Busy"
      : normalizeString(obj.title) || "(No title)";

  return {
    ...slot,
    ...(occurrenceId ? { occurrenceId } : {}),
    calendarId: visibility === "busy" ? undefined : normalizeString(obj.calendarId) || undefined,
    calendarTitle: visibility === "busy" ? undefined : normalizeString(obj.calendarTitle) || undefined,
    colorHex: visibility === "busy" ? "#9B9A97" : normalizeColorHex(obj.colorHex),
    title,
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
  const retainedIds = data.observationSnapshot ? new Set(filtered.map(publicCalendarEventKey)) : null;
  return {
    ...data,
    events: filtered,
    ...(retainedIds && data.observationSnapshot && {
      observationSnapshot: {
        ...data.observationSnapshot,
        eventIds: data.observationSnapshot.eventIds.filter((id) => retainedIds.has(id)),
      },
    }),
  };
}

function normalizeCalendarData(raw: unknown, preserveOccurrenceId: boolean): PublicCalendarData {
  const obj =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const now = new Date().toISOString();
  const startsAt = normalizeIso((obj.range as Record<string, unknown> | undefined)?.startsAt, now);
  const endsAt = normalizeIso((obj.range as Record<string, unknown> | undefined)?.endsAt, startsAt);
  const events = Array.isArray(obj.events)
    ? obj.events
        .map((event) => normalizeEvent(event, preserveOccurrenceId))
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

export function normalizePublicCalendarData(raw: unknown): PublicCalendarData {
  return normalizeCalendarData(raw, false);
}

// Only the public runtime response carries a verified observation snapshot.
// The general normalizer intentionally strips it from editable payloads.
export function normalizePublicCalendarRuntimeData(raw: unknown): PublicCalendarData {
  const base = normalizeCalendarData(raw, true);
  const data = { ...base, events: identifyPublicCalendarOccurrences(base.events) };
  const snapshot = (raw as Partial<PublicCalendarData> | null)?.observationSnapshot;
  if (!snapshot || !Number.isSafeInteger(snapshot.revision) || snapshot.revision <= 0 ||
      !Array.isArray(snapshot.eventIds)) return data;
  const busyIds = new Set(data.events.filter((event) => event.visibility === "busy").map(publicCalendarEventKey));
  return {
    ...data,
    observationSnapshot: {
      revision: snapshot.revision,
      eventIds: [...new Set(snapshot.eventIds.filter((id) => busyIds.has(id)))],
      ...(snapshot.busyComplete === true ? { busyComplete: true } : {}),
    },
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

function eventWindow(event: PublicCalendarEvent) {
  return {
    isAllDay: event.isAllDay,
    startsAt: timestampMs(event.startsAt),
    endsAt: timestampMs(event.endsAt),
  };
}

function isCoveredByPublicEvent(
  publicEvent: ReturnType<typeof eventWindow>,
  observedBusy: ReturnType<typeof eventWindow>,
): boolean {
  if (publicEvent.isAllDay !== observedBusy.isAllDay) return false;
  const overlap = Math.min(publicEvent.endsAt, observedBusy.endsAt) -
    Math.max(publicEvent.startsAt, observedBusy.startsAt);
  if (overlap <= 0) return false;
  const shortest = Math.min(
    publicEvent.endsAt - publicEvent.startsAt,
    observedBusy.endsAt - observedBusy.startsAt,
  );
  return shortest > 0 && overlap / shortest >= 0.8;
}

type ProjectionRow = { event: PublicCalendarEvent; observed: boolean; repeatedId: boolean };

function mergeBusyRuntimeEvents(rows: readonly ProjectionRow[]): ProjectionRow[] {
  const sorted = [...rows].sort(({ event: a }, { event: b }) =>
    a.startsAt.localeCompare(b.startsAt) ||
    a.endsAt.localeCompare(b.endsAt) ||
    a.title.localeCompare(b.title),
  );
  const out: ProjectionRow[] = [];
  let joinedIds = new Set<string>();
  for (const row of sorted) {
    const { event } = row;
    const previousRow = out.at(-1);
    const previous = previousRow?.event;
    if (
      previousRow && previous &&
      previous.visibility === "busy" &&
      event.visibility === "busy" &&
      previous.isAllDay === event.isAllDay &&
      timestampMs(event.startsAt) <= timestampMs(previous.endsAt)
    ) {
      if (timestampMs(event.endsAt) > timestampMs(previous.endsAt)) {
        previous.endsAt = event.endsAt;
      }
      if (!joinedIds.has(event.id)) {
        previous.id = `${previous.id}+${event.id}`;
        joinedIds.add(event.id);
      }
      previousRow.observed ||= row.observed;
      // A merged block with a unique member doesn't reuse its composite ID.
      previousRow.repeatedId &&= row.repeatedId;
      continue;
    }
    joinedIds = new Set([event.id]);
    out.push({ ...row, event: { ...event } });
  }
  return out;
}

export function isExcludedLegacyCalendarEvent(event: PublicCalendarEvent, exclusion: LegacyCalendarExclusion): boolean {
  return event.visibility === "busy" && event.isAllDay === exclusion.isAllDay &&
    event.startsAt === exclusion.startsAt && event.endsAt === exclusion.endsAt && exclusion.legacyIds.includes(event.id);
}

export function supplementPublicCalendarWithObservedData({
  publicData,
  observedData,
  knownRepeatedIds,
}: {
  publicData: PublicCalendarData;
  observedData: ObservedPublicCalendarData | null | undefined;
  knownRepeatedIds?: ReadonlySet<string>;
}): PublicCalendarData {
  const repeatedIds = repeatedPublicCalendarIds(publicData.events);
  for (const id of knownRepeatedIds ?? []) repeatedIds.add(id);
  if (!observedData || (!observedData.events.length && !observedData.observationSnapshot)) {
    return { ...publicData, events: identifyPublicCalendarOccurrences(publicData.events, repeatedIds) };
  }

  const legacyExclusions = observedData.observationSnapshot ? observedData.legacyExclusions : undefined;
  const excludedKeys = legacyExclusions?.length ? new Set(legacyExclusions.flatMap(({ legacyIds, startsAt, endsAt, isAllDay }) =>
    legacyIds.map((id) => slotId({ id, startsAt, endsAt, isAllDay })),
  )) : null;
  const events = excludedKeys
    ? publicData.events.filter((event) => event.visibility !== "busy" || !excludedKeys.has(slotId(event)))
    : publicData.events;
  const windows = events.map(eventWindow);
  for (const id of repeatedPublicCalendarIds(observedData.events)) repeatedIds.add(id);
  const projected: ProjectionRow[] = events.map((event) => ({ event, observed: false, repeatedId: repeatedIds.has(event.id) }));
  for (const observed of observedData.events) {
    const busy = toBusySupplementEvent(observed);
    const window = eventWindow(busy);
    if (windows.some((event) => isCoveredByPublicEvent(event, window))) continue;
    windows.push(window);
    projected.push({ event: busy, observed: true, repeatedId: repeatedIds.has(busy.id) });
  }

  const merged = mergeBusyRuntimeEvents(projected);
  const inheritedRepeats = new Set(merged.filter(({ repeatedId }) => repeatedId).map(({ event }) => event.id));
  const data = normalizePublicCalendarData({
    schemaVersion: 1,
    generatedAt: laterIso(publicData.generatedAt, observedData.generatedAt),
    range: {
      startsAt: earlierIso(publicData.range.startsAt, observedData.range.startsAt),
      endsAt: laterIso(publicData.range.endsAt, observedData.range.endsAt),
    },
    events: merged.map(({ event }) => event),
  });
  data.events = identifyPublicCalendarOccurrences(data.events, inheritedRepeats);
  if (!observedData.observationSnapshot) return data;
  const observedSlots = new Set(merged.filter(({ observed }) => observed).map(({ event }) => slotId(event)));
  return {
    ...data,
    observationSnapshot: {
      revision: observedData.observationSnapshot.revision,
      eventIds: data.events.filter((event) => observedSlots.has(slotId(event))).map(publicCalendarEventKey),
      ...(legacyExclusions?.length ? { busyComplete: true } : {}),
    },
  };
}

export function selectPublicCalendarRuntimeData({
  dbData,
  sourceData,
  observedData,
  knownRepeatedIds,
}: {
  dbData: PublicCalendarData | null | undefined;
  sourceData: PublicCalendarData;
  observedData?: ObservedPublicCalendarData | null | undefined;
  knownRepeatedIds?: ReadonlySet<string>;
}): PublicCalendarData {
  let publicData = sourceData;
  if (dbData) {
    const dbGeneratedAt = timestampMs(dbData.generatedAt);
    const sourceGeneratedAt = timestampMs(sourceData.generatedAt);
    // A same-version D1 projection may already have collapsed reused IDs.
    if (dbGeneratedAt > sourceGeneratedAt ||
        (dbGeneratedAt === sourceGeneratedAt && dbData.events.length >= sourceData.events.length)) publicData = dbData;
  }

  const repeatedIds = new Set(knownRepeatedIds);
  if (publicData !== sourceData) for (const id of repeatedPublicCalendarIds(sourceData.events)) repeatedIds.add(id);
  return supplementPublicCalendarWithObservedData({
    publicData,
    observedData,
    knownRepeatedIds: repeatedIds,
  });
}

export function selectPublicCalendarHydrationData({
  currentData,
  refreshedData,
}: {
  currentData: PublicCalendarData;
  refreshedData: PublicCalendarData;
}): PublicCalendarData {
  const known = currentData.observationSnapshot;
  const received = refreshedData.observationSnapshot;
  // A cached or fallback response cannot roll back a confirmed observation view.
  if (known && (!received || received.revision < known.revision)) return currentData;
  if (known?.busyComplete && !received?.busyComplete) return currentData;
  const refreshedGeneratedAt = timestampMs(refreshedData.generatedAt);
  const currentGeneratedAt = timestampMs(currentData.generatedAt);
  const responseIsNotNewer = refreshedGeneratedAt <= currentGeneratedAt;
  const refreshedIds = new Set(refreshedData.events.map(publicCalendarEventKey));
  const refreshedSlots = new Set(refreshedData.events.map(slotId));
  // The slot match also handles a cached response from before occurrence IDs.
  const hasRefreshed = (event: PublicCalendarEvent) =>
    refreshedIds.has(publicCalendarEventKey(event)) || refreshedSlots.has(slotId(event));
  const refreshedContainsCurrent = currentData.events.every(hasRefreshed);

  if (responseIsNotNewer && !refreshedContainsCurrent && !received) {
    return currentData;
  }
  if (refreshedContainsCurrent) {
    return refreshedData;
  }

  // Preserve manually published fallback events. A complete snapshot may
  // remove previously observed Busy blocks, including ones merged with a
  // manual block whose original interval is now present in the response.
  const replaceableIds = new Set(received ? known?.eventIds : []);
  const carried = currentData.events.filter((event) => !hasRefreshed(event) &&
    !replaceableIds.has(publicCalendarEventKey(event)) && !(received?.busyComplete && event.visibility === "busy"));
  return normalizePublicCalendarRuntimeData({
    ...refreshedData,
    events: [...refreshedData.events, ...carried],
  });
}
