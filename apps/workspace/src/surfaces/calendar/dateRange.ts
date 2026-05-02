import {
  DEFAULT_CALENDAR_TIME_ZONE,
  addZonedDays,
  addZonedMonths,
  formatInTimeZone,
  getZonedDateParts,
  isSameZonedDay,
  isSameZonedMonth,
  zonedEndOfMonth,
  zonedStartOfDay,
  zonedStartOfMonth,
} from "../../../../../lib/shared/calendar-timezone.ts";

/** Date math + view-aware range/navigation/title helpers.
 *
 * All functions operate in the selected calendar time zone. The app
 * defaults to Halifax, but users can switch the display time zone
 * without mutating the underlying EventKit/local event instants.
 *
 * Week boundaries follow the same Sunday-first convention as macOS
 * Calendar in North American locales. */

export type ViewKind = "day" | "week" | "month" | "agenda";

export interface DateRange {
  /** Inclusive start, ISO 8601. */
  startsAt: string;
  /** Exclusive end, ISO 8601. */
  endsAt: string;
}

export function startOfDay(
  d: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date {
  return zonedStartOfDay(d, timeZone);
}

export function addDays(
  d: Date,
  n: number,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date {
  return addZonedDays(d, n, timeZone);
}

export function addMonths(
  d: Date,
  n: number,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date {
  return addZonedMonths(d, n, timeZone);
}

export function daysInMonth(
  d: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): number {
  const parts = getZonedDateParts(d, timeZone);
  return new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
}

function dayOfWeek(
  d: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): number {
  const parts = getZonedDateParts(d, timeZone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

export function startOfCalendarWeek(
  d: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date {
  const start = startOfDay(d, timeZone);
  return addDays(start, -dayOfWeek(start, timeZone), timeZone);
}

export function isWeekend(
  d: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): boolean {
  const weekday = dayOfWeek(d, timeZone);
  return weekday === 0 || weekday === 6;
}

export function startOfMonth(
  d: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date {
  return zonedStartOfMonth(d, timeZone);
}

export function endOfMonth(
  d: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date {
  return zonedEndOfMonth(d, timeZone);
}

export function isSameDay(
  a: Date,
  b: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): boolean {
  return isSameZonedDay(a, b, timeZone);
}

export function isSameMonth(
  a: Date,
  b: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): boolean {
  return isSameZonedMonth(a, b, timeZone);
}

/** Range of events to fetch for the given view + anchor. The month
 * range is intentionally widened to the rendered grid (Sun-before-1st
 * through Sat-after-last) so events on overflow days still appear. */
export function rangeForView(
  view: ViewKind,
  anchor: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): DateRange {
  const start = startOfDay(anchor, timeZone);
  switch (view) {
    case "day":
      return {
        startsAt: start.toISOString(),
        endsAt: addDays(start, 1, timeZone).toISOString(),
      };
    case "week":
    case "agenda": {
      const weekStart = startOfCalendarWeek(start, timeZone);
      return {
        startsAt: weekStart.toISOString(),
        endsAt: addDays(weekStart, 7, timeZone).toISOString(),
      };
    }
    case "month": {
      const firstOfMonth = startOfMonth(start, timeZone);
      const lastOfMonth = addDays(endOfMonth(start, timeZone), -1, timeZone);
      const gridStart = startOfCalendarWeek(firstOfMonth, timeZone);
      const gridEnd = addDays(
        startOfCalendarWeek(lastOfMonth, timeZone),
        7,
        timeZone,
      );
      return {
        startsAt: gridStart.toISOString(),
        endsAt: gridEnd.toISOString(),
      };
    }
  }
}

/** Compute the next anchor date when the user clicks prev/today/next.
 * `direction` of 0 jumps to today; ±1 pages by the view's natural unit
 * (day for Day, week for Week/Agenda, month for Month). */
export function navigateView(
  view: ViewKind,
  anchor: Date,
  direction: -1 | 0 | 1,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date {
  if (direction === 0) return startOfDay(new Date(), timeZone);
  switch (view) {
    case "day":
      return addDays(anchor, direction, timeZone);
    case "week":
    case "agenda":
      return addDays(anchor, direction * 7, timeZone);
    case "month":
      return addMonths(anchor, direction, timeZone);
  }
}

/** macOS Calendar-style title: "April 27, 2026", "Apr 27 – May 3, 2026",
 * or "April 2026" depending on the active view. */
export function formatViewTitle(
  view: ViewKind,
  anchor: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): string {
  switch (view) {
    case "day":
      return formatInTimeZone(anchor, timeZone, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    case "week":
    case "agenda": {
      const weekStart = startOfCalendarWeek(anchor, timeZone);
      const weekEnd = addDays(weekStart, 6, timeZone);
      const weekStartParts = getZonedDateParts(weekStart, timeZone);
      const weekEndParts = getZonedDateParts(weekEnd, timeZone);
      const sameMonth = weekStartParts.month === weekEndParts.month;
      const sameYear = weekStartParts.year === weekEndParts.year;
      const startStr = formatInTimeZone(weekStart, timeZone, {
        month: "short",
        day: "numeric",
      });
      const endOpts: Intl.DateTimeFormatOptions = {
        day: "numeric",
        ...(sameMonth ? {} : { month: "short" }),
        ...(sameYear ? {} : { year: "numeric" }),
      };
      const endStr = formatInTimeZone(weekEnd, timeZone, endOpts);
      const yearStr = sameYear ? `, ${weekStartParts.year}` : "";
      return `${startStr} – ${endStr}${yearStr}`;
    }
    case "month":
      return formatInTimeZone(anchor, timeZone, {
        month: "long",
        year: "numeric",
      });
  }
}

/** The 7 days (Sun..Sat) that the week view should render given an
 * anchor. Returned as a fresh array of midnights in local time. */
export function weekDays(
  anchor: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date[] {
  const weekStart = startOfCalendarWeek(anchor, timeZone);
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i, timeZone));
}

/** All days the month grid should show: 5 or 6 weeks (35 or 42 cells)
 * starting on the Sunday before the 1st of the month. */
export function monthGridDays(
  anchor: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date[] {
  const range = rangeForView("month", anchor, timeZone);
  const start = new Date(range.startsAt);
  const end = new Date(range.endsAt);
  const days: Date[] = [];
  for (let d = start; d < end; d = addDays(d, 1, timeZone)) {
    days.push(new Date(d));
  }
  return days;
}
