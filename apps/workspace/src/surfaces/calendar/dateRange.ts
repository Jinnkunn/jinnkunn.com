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
  zonedStartOfWeek,
} from "../../../../../lib/shared/calendar-timezone.ts";

/** Date math + view-aware range/navigation/title helpers.
 *
 * All functions operate in the selected calendar time zone. The app
 * defaults to Halifax, but users can switch the display time zone
 * without mutating the underlying EventKit/local event instants.
 *
 * Week boundaries follow ISO 8601 (Monday-first). Switching to
 * Sunday-first would be a one-line change in `startOfISOWeek` plus
 * adjusting the WeekView header order. */

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

/** ISO-8601 week (Monday-first). For Sunday inputs we move *back* 6 days. */
export function startOfISOWeek(
  d: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date {
  return zonedStartOfWeek(d, timeZone);
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
 * range is intentionally widened to the rendered grid (Mon-before-1st
 * through Sun-after-last) so events on overflow days still appear. */
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
      const monday = startOfISOWeek(start, timeZone);
      return {
        startsAt: monday.toISOString(),
        endsAt: addDays(monday, 7, timeZone).toISOString(),
      };
    }
    case "month": {
      const firstOfMonth = startOfMonth(start, timeZone);
      const lastOfMonth = addDays(endOfMonth(start, timeZone), -1, timeZone);
      const gridStart = startOfISOWeek(firstOfMonth, timeZone);
      const gridEnd = addDays(startOfISOWeek(lastOfMonth, timeZone), 7, timeZone);
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
      const monday = startOfISOWeek(anchor, timeZone);
      const sunday = addDays(monday, 6, timeZone);
      const mondayParts = getZonedDateParts(monday, timeZone);
      const sundayParts = getZonedDateParts(sunday, timeZone);
      const sameMonth = mondayParts.month === sundayParts.month;
      const sameYear = mondayParts.year === sundayParts.year;
      const startStr = formatInTimeZone(monday, timeZone, {
        month: "short",
        day: "numeric",
      });
      const endOpts: Intl.DateTimeFormatOptions = {
        day: "numeric",
        ...(sameMonth ? {} : { month: "short" }),
        ...(sameYear ? {} : { year: "numeric" }),
      };
      const endStr = formatInTimeZone(sunday, timeZone, endOpts);
      const yearStr = sameYear ? `, ${mondayParts.year}` : "";
      return `${startStr} – ${endStr}${yearStr}`;
    }
    case "month":
      return formatInTimeZone(anchor, timeZone, {
        month: "long",
        year: "numeric",
      });
  }
}

/** The 7 days (Mon..Sun) that the week view should render given an
 * anchor. Returned as a fresh array of midnights in local time. */
export function weekDays(
  anchor: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date[] {
  const monday = startOfISOWeek(anchor, timeZone);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i, timeZone));
}

/** All days the month grid should show: 5 or 6 weeks (35 or 42 cells)
 * starting on the Monday before the 1st of the month. */
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
