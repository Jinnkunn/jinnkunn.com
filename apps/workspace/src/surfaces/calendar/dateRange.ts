/** Date math + view-aware range/navigation/title helpers.
 *
 * All functions operate in *local* time on the user's machine — events
 * coming back from EventKit already encode their absolute instant in
 * ISO 8601 with offset, so display-side calculations should match what
 * the user sees in the macOS Calendar app on the same Mac.
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

export function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function addMonths(d: Date, n: number): Date {
  const out = new Date(d);
  // Pin to day=1 first so months with 30/31 don't roll over (Jan 31 →
  // adding 1 month should give Feb 28, not Mar 3).
  out.setDate(1);
  out.setMonth(out.getMonth() + n);
  // Then restore the day, clamped to the new month's length.
  const day = Math.min(d.getDate(), daysInMonth(out));
  out.setDate(day);
  out.setHours(d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  return out;
}

export function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/** ISO-8601 week (Monday-first). For Sunday inputs we move *back* 6 days. */
export function startOfISOWeek(d: Date): Date {
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, ...
  const offset = day === 0 ? -6 : 1 - day;
  return startOfDay(addDays(d, offset));
}

export function startOfMonth(d: Date): Date {
  const out = startOfDay(d);
  out.setDate(1);
  return out;
}

export function endOfMonth(d: Date): Date {
  const out = startOfMonth(d);
  out.setMonth(out.getMonth() + 1);
  return out; // exclusive
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** Range of events to fetch for the given view + anchor. The month
 * range is intentionally widened to the rendered grid (Mon-before-1st
 * through Sun-after-last) so events on overflow days still appear. */
export function rangeForView(view: ViewKind, anchor: Date): DateRange {
  const start = startOfDay(anchor);
  switch (view) {
    case "day":
      return {
        startsAt: start.toISOString(),
        endsAt: addDays(start, 1).toISOString(),
      };
    case "week":
    case "agenda": {
      const monday = startOfISOWeek(start);
      return {
        startsAt: monday.toISOString(),
        endsAt: addDays(monday, 7).toISOString(),
      };
    }
    case "month": {
      const firstOfMonth = startOfMonth(start);
      const lastOfMonth = addDays(endOfMonth(start), -1);
      const gridStart = startOfISOWeek(firstOfMonth);
      const gridEnd = addDays(startOfISOWeek(lastOfMonth), 7);
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
): Date {
  if (direction === 0) return startOfDay(new Date());
  switch (view) {
    case "day":
      return addDays(anchor, direction);
    case "week":
    case "agenda":
      return addDays(anchor, direction * 7);
    case "month":
      return addMonths(anchor, direction);
  }
}

/** macOS Calendar-style title: "April 27, 2026", "Apr 27 – May 3, 2026",
 * or "April 2026" depending on the active view. */
export function formatViewTitle(view: ViewKind, anchor: Date): string {
  switch (view) {
    case "day":
      return anchor.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    case "week":
    case "agenda": {
      const monday = startOfISOWeek(anchor);
      const sunday = addDays(monday, 6);
      const sameMonth = monday.getMonth() === sunday.getMonth();
      const sameYear = monday.getFullYear() === sunday.getFullYear();
      const startStr = monday.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      const endOpts: Intl.DateTimeFormatOptions = {
        day: "numeric",
        ...(sameMonth ? {} : { month: "short" }),
        ...(sameYear ? {} : { year: "numeric" }),
      };
      const endStr = sunday.toLocaleDateString(undefined, endOpts);
      const yearStr = sameYear ? `, ${monday.getFullYear()}` : "";
      return `${startStr} – ${endStr}${yearStr}`;
    }
    case "month":
      return anchor.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      });
  }
}

/** The 7 days (Mon..Sun) that the week view should render given an
 * anchor. Returned as a fresh array of midnights in local time. */
export function weekDays(anchor: Date): Date[] {
  const monday = startOfISOWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** All days the month grid should show: 5 or 6 weeks (35 or 42 cells)
 * starting on the Monday before the 1st of the month. */
export function monthGridDays(anchor: Date): Date[] {
  const range = rangeForView("month", anchor);
  const start = new Date(range.startsAt);
  const end = new Date(range.endsAt);
  const days: Date[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) {
    days.push(new Date(d));
  }
  return days;
}
