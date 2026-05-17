export type CalendarSyncProvider =
  | "apple"
  | "google"
  | "outlook"
  | "caldav"
  | "ics"
  | "local"
  | "unknown";

export type CalendarCollectorKind = "tauri-macos" | "ios" | "server" | "manual";

export type CalendarSyncMode = "snapshot" | "incremental";

export interface CalendarCollectorDescriptor {
  id: string;
  kind: CalendarCollectorKind;
  title?: string;
}

export interface CalendarSourceDescriptor {
  id: string;
  provider: CalendarSyncProvider;
  title: string;
  accountKey?: string | null;
  externalSourceId?: string | null;
  syncScope?: Record<string, unknown>;
}

export interface CalendarObservationInput {
  sourceId: string;
  collectorId?: string;
  sourceEventId?: string | null;
  iCalUid?: string | null;
  recurrenceInstanceId?: string | null;
  calendarId?: string | null;
  calendarTitle?: string | null;
  title?: string | null;
  notes?: string | null;
  location?: string | null;
  url?: string | null;
  startsAt: string;
  endsAt: string;
  isAllDay?: boolean;
  isRecurring?: boolean;
  timezone?: string | null;
  updatedAt?: string | null;
}

export interface CalendarObservation extends CalendarObservationInput {
  observationId: string;
  collectorId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  isAllDay: boolean;
  isRecurring: boolean;
  normalizedTitle: string;
  normalizedLocation: string;
  meetingUrl: string;
  identityKey: string;
  dedupeKey: string;
}

export interface CalendarEntitySourceRef {
  observationId: string;
  sourceId: string;
  collectorId: string;
  sourceEventId?: string | null;
  iCalUid?: string | null;
}

export interface CalendarEntity {
  id: string;
  dedupeKey: string;
  title: string;
  startsAt: string;
  endsAt: string;
  isAllDay: boolean;
  confidence: number;
  sourceRefs: CalendarEntitySourceRef[];
  observations: CalendarObservation[];
}

export interface CalendarObservationSyncPayload {
  schemaVersion: 1;
  collector: CalendarCollectorDescriptor;
  sources: CalendarSourceDescriptor[];
  range: {
    startsAt: string;
    endsAt: string;
  };
  syncMode: CalendarSyncMode;
  observedAt: string;
  observations: CalendarObservation[];
}

const PROVIDERS = new Set<CalendarSyncProvider>([
  "apple",
  "google",
  "outlook",
  "caldav",
  "ics",
  "local",
  "unknown",
]);

const COLLECTOR_KINDS = new Set<CalendarCollectorKind>([
  "tauri-macos",
  "ios",
  "server",
  "manual",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanOptionalString(value: unknown): string | null {
  const str = cleanString(value);
  return str ? str : null;
}

function normalizeIso(value: unknown, fallback = ""): string {
  const raw = cleanString(value);
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return fallback;
  return new Date(ms).toISOString();
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

export function normalizeCalendarText(value: unknown): string {
  return cleanString(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}\s:/.-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function minuteIso(value: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(Math.floor(ms / 60_000) * 60_000).toISOString();
}

function extractMeetingUrl(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (!value) continue;
    const match = value.match(/https?:\/\/[^\s)>\]]+/i);
    if (!match) continue;
    try {
      const url = new URL(match[0]);
      url.hash = "";
      const host = url.hostname.replace(/^www\./, "").toLowerCase();
      return `${host}${url.pathname.replace(/\/$/, "")}${url.search}`.toLowerCase();
    } catch {
      return match[0].toLowerCase();
    }
  }
  return "";
}

function canonicalObservationId(input: {
  sourceId: string;
  sourceEventId?: string | null;
  iCalUid?: string | null;
  recurrenceInstanceId?: string | null;
  startsAt: string;
  title: string;
}): string {
  const identity =
    input.iCalUid ||
    input.sourceEventId ||
    `${input.title}:${input.startsAt}:${input.recurrenceInstanceId ?? ""}`;
  return `obs_${stableHash(`${input.sourceId}:${identity}:${input.startsAt}`)}`;
}

export function calendarObservationIdentityKey(
  observation: Pick<
    CalendarObservationInput,
    "sourceId" | "sourceEventId" | "iCalUid" | "recurrenceInstanceId" | "startsAt"
  >,
): string {
  const recurrence = cleanString(observation.recurrenceInstanceId) || minuteIso(observation.startsAt);
  const uid = normalizeCalendarText(observation.iCalUid);
  if (uid) return `ical:${uid}:${recurrence}`;
  const sourceEventId = normalizeCalendarText(observation.sourceEventId);
  if (sourceEventId) {
    return `source:${normalizeCalendarText(observation.sourceId)}:${sourceEventId}:${recurrence}`;
  }
  return "";
}

export function calendarObservationDedupeKey(
  observation: Pick<
    CalendarObservation,
    "normalizedTitle" | "startsAt" | "endsAt" | "normalizedLocation" | "meetingUrl"
  >,
): string {
  const input = [
    observation.normalizedTitle,
    minuteIso(observation.startsAt),
    minuteIso(observation.endsAt),
    observation.meetingUrl,
    observation.normalizedLocation,
  ].join("|");
  return `fp:${stableHash(input)}`;
}

export function normalizeCalendarCollector(raw: unknown): CalendarCollectorDescriptor {
  const obj = asRecord(raw);
  const id = cleanString(obj.id) || "unknown-collector";
  const kind = COLLECTOR_KINDS.has(obj.kind as CalendarCollectorKind)
    ? (obj.kind as CalendarCollectorKind)
    : "manual";
  return {
    id,
    kind,
    title: cleanOptionalString(obj.title) ?? undefined,
  };
}

export function normalizeCalendarSource(raw: unknown): CalendarSourceDescriptor | null {
  const obj = asRecord(raw);
  const id = cleanString(obj.id);
  if (!id) return null;
  const provider = PROVIDERS.has(obj.provider as CalendarSyncProvider)
    ? (obj.provider as CalendarSyncProvider)
    : "unknown";
  const syncScope = asRecord(obj.syncScope);
  return {
    id,
    provider,
    title: cleanString(obj.title) || "Calendar",
    accountKey: cleanOptionalString(obj.accountKey),
    externalSourceId: cleanOptionalString(obj.externalSourceId),
    syncScope,
  };
}

export function normalizeCalendarObservation(
  raw: unknown,
  collectorId: string,
): CalendarObservation | null {
  const obj = asRecord(raw);
  const sourceId = cleanString(obj.sourceId);
  const startsAt = normalizeIso(obj.startsAt);
  const endsAt = normalizeIso(obj.endsAt);
  if (!sourceId || !startsAt || !endsAt) return null;
  if (Date.parse(endsAt) <= Date.parse(startsAt)) return null;

  const title = cleanString(obj.title) || "(No title)";
  const normalizedTitle = normalizeCalendarText(title);
  const normalizedLocation = normalizeCalendarText(obj.location);
  const meetingUrl = extractMeetingUrl(
    cleanOptionalString(obj.url),
    cleanOptionalString(obj.location),
    cleanOptionalString(obj.notes),
  );
  const observationBase = {
    sourceId,
    collectorId: cleanString(obj.collectorId) || collectorId,
    sourceEventId: cleanOptionalString(obj.sourceEventId),
    iCalUid: cleanOptionalString(obj.iCalUid),
    recurrenceInstanceId: cleanOptionalString(obj.recurrenceInstanceId),
    calendarId: cleanOptionalString(obj.calendarId),
    calendarTitle: cleanOptionalString(obj.calendarTitle),
    title,
    notes: cleanOptionalString(obj.notes),
    location: cleanOptionalString(obj.location),
    url: cleanOptionalString(obj.url),
    startsAt,
    endsAt,
    isAllDay: normalizeBoolean(obj.isAllDay),
    isRecurring: normalizeBoolean(obj.isRecurring),
    timezone: cleanOptionalString(obj.timezone),
    updatedAt: normalizeIso(obj.updatedAt, "") || null,
  };
  const identityKey = calendarObservationIdentityKey(observationBase);
  const observationId =
    cleanString(obj.observationId) ||
    canonicalObservationId({
      sourceId,
      sourceEventId: observationBase.sourceEventId,
      iCalUid: observationBase.iCalUid,
      recurrenceInstanceId: observationBase.recurrenceInstanceId,
      startsAt,
      title,
    });
  const dedupeKey = calendarObservationDedupeKey({
    normalizedTitle,
    startsAt,
    endsAt,
    normalizedLocation,
    meetingUrl,
  });
  return {
    ...observationBase,
    observationId,
    normalizedTitle,
    normalizedLocation,
    meetingUrl,
    identityKey,
    dedupeKey,
  };
}

export function normalizeCalendarObservationSyncPayload(
  raw: unknown,
): CalendarObservationSyncPayload {
  const obj = asRecord(raw);
  const collector = normalizeCalendarCollector(obj.collector);
  const now = new Date().toISOString();
  const rangeObj = asRecord(obj.range);
  const rangeStartsAt = normalizeIso(rangeObj.startsAt, now);
  const rangeEndsAt = normalizeIso(rangeObj.endsAt, rangeStartsAt);
  const sources = Array.isArray(obj.sources)
    ? obj.sources
        .map(normalizeCalendarSource)
        .filter((source): source is CalendarSourceDescriptor => source !== null)
    : [];
  const observations = Array.isArray(obj.observations)
    ? obj.observations
        .map((entry) => normalizeCalendarObservation(entry, collector.id))
        .filter((entry): entry is CalendarObservation => entry !== null)
    : [];
  const sourceIds = new Set(sources.map((source) => source.id));
  for (const observation of observations) {
    if (!sourceIds.has(observation.sourceId)) {
      sources.push({
        id: observation.sourceId,
        provider: "unknown",
        title: observation.calendarTitle || "Calendar",
      });
      sourceIds.add(observation.sourceId);
    }
  }
  return {
    schemaVersion: 1,
    collector,
    sources,
    range: {
      startsAt: rangeStartsAt,
      endsAt:
        Date.parse(rangeEndsAt) > Date.parse(rangeStartsAt)
          ? rangeEndsAt
          : rangeStartsAt,
    },
    syncMode: obj.syncMode === "incremental" ? "incremental" : "snapshot",
    observedAt: normalizeIso(obj.observedAt, now),
    observations,
  };
}

function rangesOverlap(
  left: Pick<CalendarObservation, "startsAt" | "endsAt">,
  right: Pick<CalendarObservation, "startsAt" | "endsAt">,
): boolean {
  return Date.parse(left.startsAt) < Date.parse(right.endsAt) &&
    Date.parse(left.endsAt) > Date.parse(right.startsAt);
}

function scoreCalendarObservationMatch(
  entity: CalendarEntity,
  observation: CalendarObservation,
): number {
  if (!rangesOverlap(entity, observation)) return 0;
  if (
    observation.identityKey &&
    entity.observations.some((entry) => entry.identityKey === observation.identityKey)
  ) {
    return 100;
  }
  if (
    observation.iCalUid &&
    entity.observations.some((entry) => entry.iCalUid === observation.iCalUid)
  ) {
    return 95;
  }
  if (
    observation.meetingUrl &&
    entity.observations.some((entry) => entry.meetingUrl === observation.meetingUrl)
  ) {
    return observation.normalizedTitle === entity.observations[0]?.normalizedTitle ? 92 : 88;
  }
  if (
    observation.dedupeKey === entity.dedupeKey &&
    observation.normalizedTitle === entity.observations[0]?.normalizedTitle
  ) {
    return 90;
  }
  return 0;
}

function entityIdForObservations(observations: readonly CalendarObservation[]): string {
  const identity = observations
    .map((observation) => observation.identityKey)
    .find(Boolean);
  if (identity) return `evt_${stableHash(identity)}`;
  return `evt_${stableHash(observations.map((entry) => entry.dedupeKey).sort().join("|"))}`;
}

function toSourceRef(observation: CalendarObservation): CalendarEntitySourceRef {
  return {
    observationId: observation.observationId,
    sourceId: observation.sourceId,
    collectorId: observation.collectorId,
    sourceEventId: observation.sourceEventId,
    iCalUid: observation.iCalUid,
  };
}

function rebuildEntity(observations: CalendarObservation[], confidence: number): CalendarEntity {
  const sorted = [...observations].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt) ||
    a.title.localeCompare(b.title) ||
    a.observationId.localeCompare(b.observationId),
  );
  const preferred = [...sorted].sort((a, b) => b.title.length - a.title.length)[0];
  return {
    id: entityIdForObservations(sorted),
    dedupeKey: sorted[0]?.dedupeKey ?? "",
    title: preferred?.title ?? "(No title)",
    startsAt: sorted.reduce((min, entry) =>
      Date.parse(entry.startsAt) < Date.parse(min) ? entry.startsAt : min,
    sorted[0]?.startsAt ?? ""),
    endsAt: sorted.reduce((max, entry) =>
      Date.parse(entry.endsAt) > Date.parse(max) ? entry.endsAt : max,
    sorted[0]?.endsAt ?? ""),
    isAllDay: sorted.every((entry) => entry.isAllDay),
    confidence,
    sourceRefs: sorted.map(toSourceRef),
    observations: sorted,
  };
}

export function mergeCalendarObservations(
  rawObservations: readonly CalendarObservation[],
): CalendarEntity[] {
  const observations = [...rawObservations].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt) ||
    a.normalizedTitle.localeCompare(b.normalizedTitle) ||
    a.observationId.localeCompare(b.observationId),
  );
  const entities: CalendarEntity[] = [];
  for (const observation of observations) {
    let bestIndex = -1;
    let bestScore = 0;
    for (let i = 0; i < entities.length; i += 1) {
      const score = scoreCalendarObservationMatch(entities[i], observation);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex >= 0 && bestScore >= 90) {
      entities[bestIndex] = rebuildEntity(
        [...entities[bestIndex].observations, observation],
        Math.min(entities[bestIndex].confidence, bestScore),
      );
      continue;
    }
    entities.push(rebuildEntity([observation], 100));
  }
  return entities.sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt) ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id),
  );
}
