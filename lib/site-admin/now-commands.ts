import type { SiteAdminNowData, SiteAdminNowUpdate } from "./api-types";
import {
  NOW_CONTEXT_MAX_LENGTH,
  NOW_LOCATION_MAX_LENGTH,
  NOW_STATUS_MAX_LENGTH,
  NOW_UPDATES_MAX_COUNT,
  normalizeNowData,
} from "./now-normalize.ts";

const DISPLAY_TIME_ZONE = "America/Halifax";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class SiteAdminNowHistoryNotFoundError extends Error {
  readonly code = "NOW_HISTORY_NOT_FOUND";
  readonly status = 404;

  constructor(id: string) {
    super(`Now history item not found: ${id}`);
    this.name = "SiteAdminNowHistoryNotFoundError";
  }
}

type OptionalTextPatch = {
  hasValue: boolean;
  value?: string;
};

type TimeParts = {
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

function trimToMax(value: string, maxLength: number): string {
  const trimmed = String(value || "").trim();
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength).trim() : trimmed;
}

function applyOptionalText(
  current: string | undefined,
  patch: OptionalTextPatch,
  maxLength: number,
): string | undefined {
  if (!patch.hasValue) return current || undefined;
  return trimToMax(patch.value || "", maxLength) || undefined;
}

function readPart(parts: Intl.DateTimeFormatPart[], type: string): number {
  const value = parts.find((part) => part.type === type)?.value || "";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function zonedParts(date: Date, timeZone = DISPLAY_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return {
    year: readPart(parts, "year"),
    month: readPart(parts, "month"),
    day: readPart(parts, "day"),
    hour: readPart(parts, "hour"),
    minute: readPart(parts, "minute"),
    second: readPart(parts, "second"),
  };
}

function offsetMsForZone(date: Date, timeZone = DISPLAY_TIME_ZONE): number {
  const parts = zonedParts(date, timeZone);
  const zonedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return zonedAsUtc - date.getTime();
}

function zonedDateTimeToIso(
  date: string,
  time: TimeParts,
  timeZone = DISPLAY_TIME_ZONE,
): string {
  const [year, month, day] = date.split("-").map(Number);
  const wallClockUtc = Date.UTC(
    year,
    month - 1,
    day,
    time.hour,
    time.minute,
    time.second,
    time.millisecond,
  );
  let instant = wallClockUtc;
  for (let i = 0; i < 3; i += 1) {
    instant = wallClockUtc - offsetMsForZone(new Date(instant), timeZone);
  }
  return new Date(instant).toISOString();
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function makeUpdateId(text: string, at: string): string {
  const stamp = at.replace(/\D+/g, "").slice(0, 14) || String(Date.now());
  return `${stamp}-${hashString(`${at}\n${text}`).slice(0, 8)}`;
}

function sortUpdates(updates: SiteAdminNowUpdate[]): SiteAdminNowUpdate[] {
  return updates
    .map((item, index) => ({ item, index, atMs: new Date(item.at).getTime() }))
    .sort((a, b) => {
      const aTime = Number.isFinite(a.atMs) ? a.atMs : 0;
      const bTime = Number.isFinite(b.atMs) ? b.atMs : 0;
      if (aTime !== bTime) return bTime - aTime;
      return a.index - b.index;
    })
    .map((entry) => entry.item)
    .slice(0, NOW_UPDATES_MAX_COUNT);
}

function timePartsFromTimestamp(value: string | undefined): TimeParts | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = zonedParts(date);
  return {
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    millisecond: date.getUTCMilliseconds(),
  };
}

function todayDateInput(now = new Date()): string {
  const parts = zonedParts(now);
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

export function normalizeNowDateInput(raw: unknown, now = new Date()): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return todayDateInput(now);
  if (!DATE_RE.test(value)) return todayDateInput(now);
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return todayDateInput(now);
  }
  return value;
}

export function nowTimestampForDate(input: {
  date?: string;
  now?: Date;
  preserveTimeFrom?: string;
}): string {
  const now = input.now ?? new Date();
  const date = normalizeNowDateInput(input.date, now);
  if (date === todayDateInput(now) && !input.preserveTimeFrom) {
    return now.toISOString();
  }
  const time = timePartsFromTimestamp(input.preserveTimeFrom) ?? {
    hour: 12,
    minute: 0,
    second: 0,
    millisecond: 0,
  };
  return zonedDateTimeToIso(date, time);
}

export function createNowData(input: {
  data: SiteAdminNowData;
  text: string;
  context: OptionalTextPatch;
  location: OptionalTextPatch;
  date?: string;
  now?: Date;
}): SiteAdminNowData {
  const current = normalizeNowData(input.data);
  const text = trimToMax(input.text, NOW_STATUS_MAX_LENGTH);
  const at = nowTimestampForDate({ date: input.date, now: input.now });
  return normalizeNowData({
    ...current,
    current: {
      text,
      context: applyOptionalText(
        current.current.context,
        input.context,
        NOW_CONTEXT_MAX_LENGTH,
      ),
      location: applyOptionalText(
        current.current.location,
        input.location,
        NOW_LOCATION_MAX_LENGTH,
      ),
      updatedAt: at,
    },
    updates: sortUpdates([
      {
        id: makeUpdateId(text, at),
        text,
        at,
      },
      ...current.updates,
    ]),
  });
}

export function updateNowHistoryData(input: {
  data: SiteAdminNowData;
  id: string;
  text: string;
  date?: string;
  now?: Date;
}): SiteAdminNowData {
  const current = normalizeNowData(input.data);
  let found = false;
  const updates = current.updates.map((item) => {
    if (item.id !== input.id) return item;
    found = true;
    const text = trimToMax(input.text, NOW_STATUS_MAX_LENGTH);
    return {
      ...item,
      text,
      at: nowTimestampForDate({
        date: input.date,
        now: input.now,
        preserveTimeFrom: item.at,
      }),
    };
  });
  if (!found) throw new SiteAdminNowHistoryNotFoundError(input.id);
  return normalizeNowData({
    ...current,
    updates: sortUpdates(updates),
  });
}

export function deleteNowHistoryData(input: {
  data: SiteAdminNowData;
  id: string;
}): SiteAdminNowData {
  const current = normalizeNowData(input.data);
  const updates = current.updates.filter((item) => item.id !== input.id);
  if (updates.length === current.updates.length) {
    throw new SiteAdminNowHistoryNotFoundError(input.id);
  }
  return normalizeNowData({
    ...current,
    updates,
  });
}
