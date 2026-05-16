import {
  DEFAULT_CALENDAR_TIME_ZONE,
  addZonedDays,
  addZonedMonths,
  formatInTimeZone,
  getZonedDateParts,
  isSameZonedMonth,
  zonedDateFromDayKey,
  zonedDayKey,
  zonedStartOfDay,
  zonedStartOfMonth,
} from "../../lib/shared/calendar-timezone.ts";
import type { PublicCalendarEvent } from "../../lib/shared/public-calendar.ts";

export type PublicCalendarViewMode = "month" | "week" | "day" | "agenda";

export const PUBLIC_CALENDAR_VIEW_LABELS: Array<{
  value: PublicCalendarViewMode;
  label: string;
}> = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
  { value: "agenda", label: "Agenda" },
];

export type DecoratedPublicCalendarEvent = PublicCalendarEvent & {
  startTimestamp: number;
  endTimestamp: number;
  startDayKey: string;
  formattedTime: string;
  touchedDayKeys: string[];
};

export type PublicCalendarDayIndex = Map<string, DecoratedPublicCalendarEvent[]>;

export function keyForDate(
  date: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): string {
  return zonedDayKey(date, timeZone);
}

export function parseDayKey(
  key: string,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date {
  return zonedDateFromDayKey(key, timeZone);
}

export function startOfCalendarDay(
  date: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date {
  return zonedStartOfDay(date, timeZone);
}

export function addCalendarDays(
  date: Date,
  days: number,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date {
  return addZonedDays(date, days, timeZone);
}

export function dayOfWeek(
  date: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): number {
  const parts = getZonedDateParts(date, timeZone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

export function startOfWeek(
  date: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date {
  const start = startOfCalendarDay(date, timeZone);
  return addCalendarDays(start, -dayOfWeek(start, timeZone), timeZone);
}

export function isWeekend(
  date: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): boolean {
  const weekday = dayOfWeek(date, timeZone);
  return weekday === 0 || weekday === 6;
}

export function startOfMonth(
  date: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date {
  return zonedStartOfMonth(date, timeZone);
}

export function monthGridDays(
  anchor: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date[] {
  const first = startOfMonth(anchor, timeZone);
  const start = startOfWeek(first, timeZone);
  return Array.from({ length: 42 }, (_, i) =>
    addCalendarDays(start, i, timeZone),
  );
}

export function formatDay(
  key: string,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): string {
  return formatInTimeZone(parseDayKey(key, timeZone), timeZone, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatToolbarTitle(
  view: PublicCalendarViewMode,
  anchor: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): string {
  if (view === "day") {
    return formatInTimeZone(anchor, timeZone, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }
  if (view === "week") {
    const start = startOfWeek(anchor, timeZone);
    const end = addCalendarDays(start, 6, timeZone);
    return `${formatInTimeZone(start, timeZone, {
      month: "short",
      day: "numeric",
    })} - ${formatInTimeZone(end, timeZone, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;
  }
  return formatInTimeZone(anchor, timeZone, { month: "long", year: "numeric" });
}

export function shiftAnchor(
  anchor: Date,
  view: PublicCalendarViewMode,
  direction: -1 | 1,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date {
  if (view === "month" || view === "agenda") {
    return addZonedMonths(anchor, direction, timeZone);
  }
  if (view === "week") return addCalendarDays(anchor, direction * 7, timeZone);
  return addCalendarDays(anchor, direction, timeZone);
}

export function decoratePublicCalendarEvent(
  event: PublicCalendarEvent,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): DecoratedPublicCalendarEvent {
  const startTimestamp = Date.parse(event.startsAt);
  const endTimestamp = Date.parse(event.endsAt);
  const startDate = new Date(startTimestamp);
  const endDate = new Date(endTimestamp);
  const startDayKey = keyForDate(startDate, timeZone);

  const touchedDayKeys: string[] = [];
  let cursor = startOfCalendarDay(startDate, timeZone);
  while (cursor.getTime() < endTimestamp) {
    touchedDayKeys.push(keyForDate(cursor, timeZone));
    cursor = addCalendarDays(cursor, 1, timeZone);
  }
  if (touchedDayKeys.length === 0) touchedDayKeys.push(startDayKey);

  let formattedTime: string;
  if (event.isAllDay) {
    formattedTime = "All day";
  } else {
    const startLabel = formatInTimeZone(startDate, timeZone, {
      hour: "numeric",
      minute: "2-digit",
    });
    const endLabel = formatInTimeZone(endDate, timeZone, {
      hour: "numeric",
      minute: "2-digit",
    });
    const sameDay = startDayKey === keyForDate(endDate, timeZone);
    formattedTime = sameDay
      ? `${startLabel} - ${endLabel}`
      : `${startLabel} - ${formatInTimeZone(endDate, timeZone, {
          month: "short",
          day: "numeric",
        })}, ${endLabel}`;
  }

  return {
    ...event,
    startTimestamp,
    endTimestamp,
    startDayKey,
    formattedTime,
    touchedDayKeys,
  };
}

export function buildDayIndex(
  events: DecoratedPublicCalendarEvent[],
): PublicCalendarDayIndex {
  const index: PublicCalendarDayIndex = new Map();
  for (const event of events) {
    for (const key of event.touchedDayKeys) {
      const bucket = index.get(key);
      if (bucket) bucket.push(event);
      else index.set(key, [event]);
    }
  }
  for (const bucket of index.values()) {
    bucket.sort((a, b) => a.startTimestamp - b.startTimestamp);
  }
  return index;
}

export function eventsForDayKey(
  index: PublicCalendarDayIndex,
  key: string,
): DecoratedPublicCalendarEvent[] {
  return index.get(key) ?? [];
}

export function eventsForDay(
  index: PublicCalendarDayIndex,
  day: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): DecoratedPublicCalendarEvent[] {
  return eventsForDayKey(index, keyForDate(day, timeZone));
}

export function buildAgendaGroups(
  events: DecoratedPublicCalendarEvent[],
  windowDays: number,
  currentDate: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Array<[string, DecoratedPublicCalendarEvent[]]> {
  const agendaStart = startOfCalendarDay(currentDate, timeZone);
  const startMs = agendaStart.getTime();
  const endMs = addCalendarDays(agendaStart, windowDays, timeZone).getTime();
  const buckets = new Map<string, DecoratedPublicCalendarEvent[]>();

  for (const event of events) {
    if (event.endTimestamp < startMs || event.startTimestamp > endMs) continue;
    const bucket = buckets.get(event.startDayKey);
    if (bucket) bucket.push(event);
    else buckets.set(event.startDayKey, [event]);
  }
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => a.startTimestamp - b.startTimestamp);
  }
  return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export { isSameZonedMonth };
