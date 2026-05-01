export const DEFAULT_CALENDAR_TIME_ZONE = "America/Halifax";

export type CalendarTimeZoneOption = {
  value: string;
  label: string;
  shortLabel: string;
};

export const CALENDAR_TIME_ZONE_OPTIONS: CalendarTimeZoneOption[] = [
  {
    value: "America/Halifax",
    label: "Halifax",
    shortLabel: "Halifax",
  },
  {
    value: "America/Toronto",
    label: "Toronto / New York",
    shortLabel: "ET",
  },
  {
    value: "America/Vancouver",
    label: "Vancouver / Los Angeles",
    shortLabel: "PT",
  },
  {
    value: "Europe/London",
    label: "London",
    shortLabel: "London",
  },
  {
    value: "Europe/Berlin",
    label: "Berlin",
    shortLabel: "Berlin",
  },
  {
    value: "Asia/Shanghai",
    label: "Shanghai",
    shortLabel: "Shanghai",
  },
  {
    value: "Asia/Tokyo",
    label: "Tokyo",
    shortLabel: "Tokyo",
  },
  {
    value: "Australia/Sydney",
    label: "Sydney",
    shortLabel: "Sydney",
  },
  {
    value: "UTC",
    label: "UTC",
    shortLabel: "UTC",
  },
];

export type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterForParts(timeZone: string): Intl.DateTimeFormat {
  const normalized = normalizeCalendarTimeZone(timeZone);
  const cached = dateTimeFormatters.get(normalized);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    calendar: "gregory",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: normalized,
    year: "numeric",
  });
  dateTimeFormatters.set(normalized, formatter);
  return formatter;
}

export function normalizeCalendarTimeZone(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    return DEFAULT_CALENDAR_TIME_ZONE;
  }
  const candidate = value.trim();
  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_CALENDAR_TIME_ZONE;
  }
}

export function calendarTimeZoneLabel(timeZone: string): string {
  const normalized = normalizeCalendarTimeZone(timeZone);
  return (
    CALENDAR_TIME_ZONE_OPTIONS.find((option) => option.value === normalized)
      ?.label ?? normalized.replaceAll("_", " ")
  );
}

export function calendarTimeZoneShortLabel(timeZone: string): string {
  const normalized = normalizeCalendarTimeZone(timeZone);
  return (
    CALENDAR_TIME_ZONE_OPTIONS.find((option) => option.value === normalized)
      ?.shortLabel ?? normalized.replace(/^.*\//, "").replaceAll("_", " ")
  );
}

export function getZonedDateParts(
  value: Date | string | number,
  timeZone: string,
): ZonedDateParts {
  const date = new Date(value);
  const parts = formatterForParts(timeZone).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getZonedDateParts(date, timeZone);
  const wallAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return wallAsUtc - date.getTime();
}

export function dateFromZonedTimeParts(
  parts: {
    year: number;
    month: number;
    day: number;
    hour?: number;
    minute?: number;
    second?: number;
  },
  timeZone: string,
): Date {
  const normalized = normalizeCalendarTimeZone(timeZone);
  const wallAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  let instant = wallAsUtc;
  for (let i = 0; i < 4; i += 1) {
    const offset = timeZoneOffsetMs(new Date(instant), normalized);
    const next = wallAsUtc - offset;
    if (Math.abs(next - instant) < 1) break;
    instant = next;
  }
  return new Date(instant);
}

export function zonedDayKey(
  value: Date | string | number,
  timeZone: string,
): string {
  const parts = getZonedDateParts(value, timeZone);
  return `${parts.year.toString().padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function zonedDateFromDayKey(key: string, timeZone: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return dateFromZonedTimeParts({ year, month, day }, timeZone);
}

export function zonedStartOfDay(value: Date, timeZone: string): Date {
  const parts = getZonedDateParts(value, timeZone);
  return dateFromZonedTimeParts(
    { year: parts.year, month: parts.month, day: parts.day },
    timeZone,
  );
}

export function addZonedDays(
  value: Date,
  days: number,
  timeZone: string,
): Date {
  const parts = getZonedDateParts(value, timeZone);
  const wallDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return dateFromZonedTimeParts(
    {
      year: wallDate.getUTCFullYear(),
      month: wallDate.getUTCMonth() + 1,
      day: wallDate.getUTCDate(),
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second,
    },
    timeZone,
  );
}

export function addZonedMonths(
  value: Date,
  months: number,
  timeZone: string,
): Date {
  const parts = getZonedDateParts(value, timeZone);
  const target = new Date(Date.UTC(parts.year, parts.month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return dateFromZonedTimeParts(
    {
      year: target.getUTCFullYear(),
      month: target.getUTCMonth() + 1,
      day: Math.min(parts.day, lastDay),
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second,
    },
    timeZone,
  );
}

export function zonedStartOfWeek(value: Date, timeZone: string): Date {
  const start = zonedStartOfDay(value, timeZone);
  const parts = getZonedDateParts(start, timeZone);
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
    .getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  return addZonedDays(start, mondayOffset, timeZone);
}

export function zonedStartOfMonth(value: Date, timeZone: string): Date {
  const parts = getZonedDateParts(value, timeZone);
  return dateFromZonedTimeParts(
    { year: parts.year, month: parts.month, day: 1 },
    timeZone,
  );
}

export function zonedEndOfMonth(value: Date, timeZone: string): Date {
  const parts = getZonedDateParts(value, timeZone);
  const target = new Date(Date.UTC(parts.year, parts.month, 1));
  return dateFromZonedTimeParts(
    {
      year: target.getUTCFullYear(),
      month: target.getUTCMonth() + 1,
      day: target.getUTCDate(),
    },
    timeZone,
  );
}

export function zonedDayRange(
  value: Date,
  timeZone: string,
): { startsAt: Date; endsAt: Date } {
  const startsAt = zonedStartOfDay(value, timeZone);
  return {
    startsAt,
    endsAt: addZonedDays(startsAt, 1, timeZone),
  };
}

export function isSameZonedDay(
  left: Date,
  right: Date,
  timeZone: string,
): boolean {
  return zonedDayKey(left, timeZone) === zonedDayKey(right, timeZone);
}

export function isSameZonedMonth(
  left: Date,
  right: Date,
  timeZone: string,
): boolean {
  const a = getZonedDateParts(left, timeZone);
  const b = getZonedDateParts(right, timeZone);
  return a.year === b.year && a.month === b.month;
}

export function zonedMinuteOfDay(
  value: Date | string | number,
  timeZone: string,
): number {
  const parts = getZonedDateParts(value, timeZone);
  return parts.hour * 60 + parts.minute;
}

export function zonedDateAtMinute(
  day: Date,
  minuteOfDay: number,
  timeZone: string,
): Date {
  const parts = getZonedDateParts(day, timeZone);
  return dateFromZonedTimeParts(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: Math.floor(minuteOfDay / 60),
      minute: minuteOfDay % 60,
    },
    timeZone,
  );
}

export function formatInTimeZone(
  value: Date | string | number,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
  locale: string | string[] | undefined = undefined,
): string {
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: normalizeCalendarTimeZone(timeZone),
  }).format(new Date(value));
}

export function toZonedDateTimeInputValue(
  value: Date,
  timeZone: string,
): string {
  const parts = getZonedDateParts(value, timeZone);
  return `${parts.year.toString().padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function fromZonedDateTimeInputValue(
  value: string,
  timeZone: string,
): Date | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return dateFromZonedTimeParts(
    {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: second ? Number(second) : 0,
    },
    timeZone,
  );
}
