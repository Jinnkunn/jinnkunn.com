/** Overlap-aware layout for time-bound events on a single day.
 *
 * macOS Calendar splits each cluster of mutually-overlapping events
 * into equal-width columns. The algorithm:
 *
 *   1. Discard all-day events (rendered separately in a top strip).
 *   2. Clip each remaining event to the target day's window so events
 *      that straddle midnight render as a partial block on each day.
 *   3. Sort by start ascending, then end descending — earlier-starting
 *      and longer events get column 0 first, which keeps the leftmost
 *      column "stable" across re-renders.
 *   4. Walk in order; events whose start time is >= the current
 *      cluster's running end-time start a new cluster.
 *   5. Within a cluster, place each event in the lowest-index column
 *      whose previous occupant has already ended; track the high-water
 *      mark and assign it as `totalColumns` for the whole cluster.
 *
 * The result is rendered with `left = column * (100% / totalColumns)`
 * and `width = 100% / totalColumns`, the same equal-split layout the
 * native app uses. */

import {
  DEFAULT_CALENDAR_TIME_ZONE,
  addZonedDays,
  isSameZonedDay,
  zonedDayRange,
  zonedMinuteOfDay,
} from "../../../../../lib/shared/calendar-timezone.ts";
import type { CalendarEvent } from "./types";

export interface PositionedEvent {
  event: CalendarEvent;
  /** 0-based column index inside the event's overlap cluster. */
  column: number;
  /** Total columns in the cluster — drives the rendered width. */
  totalColumns: number;
  /** Minutes from local midnight on the target day. */
  startMinute: number;
  /** Minutes from local midnight; clamped to 24*60 for events spanning
   * past midnight, so the visual block ends at the bottom of the grid. */
  endMinute: number;
}

const MINUTES_PER_DAY = 24 * 60;
const MIN_VISIBLE_MINUTES = 15;

/** Lay out time-bound events for a single local day.
 *
 * `events` may contain events that don't touch this day; they're
 * filtered out. All-day events are also filtered — render those in a
 * separate strip so they don't visually collide with the timeline. */
export function layoutDayEvents(
  events: CalendarEvent[],
  day: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): PositionedEvent[] {
  const dayRange = zonedDayRange(day, timeZone);
  const dayStartMs = dayRange.startsAt.getTime();
  const dayEndMs = dayRange.endsAt.getTime();

  type Candidate = {
    event: CalendarEvent;
    startMinute: number;
    endMinute: number;
  };

  const candidates: Candidate[] = [];
  for (const ev of events) {
    if (ev.isAllDay) continue;
    const startMs = new Date(ev.startsAt).getTime();
    const endMs = new Date(ev.endsAt).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;
    // Skip events that don't overlap this day at all.
    if (endMs <= dayStartMs || startMs >= dayEndMs) continue;

    const clippedStart = Math.max(startMs, dayStartMs);
    const clippedEnd = Math.min(endMs, dayEndMs);
    const startMinute =
      clippedStart <= dayStartMs
        ? 0
        : zonedMinuteOfDay(new Date(clippedStart), timeZone);
    let endMinute =
      clippedEnd >= dayEndMs
        ? MINUTES_PER_DAY
        : zonedMinuteOfDay(new Date(clippedEnd), timeZone);
    // Force a minimum block height so 5-minute meetings stay clickable.
    if (endMinute - startMinute < MIN_VISIBLE_MINUTES) {
      endMinute = Math.min(MINUTES_PER_DAY, startMinute + MIN_VISIBLE_MINUTES);
    }
    candidates.push({ event: ev, startMinute, endMinute });
  }

  candidates.sort((a, b) => {
    if (a.startMinute !== b.startMinute) return a.startMinute - b.startMinute;
    // Same start: longer event first so it claims column 0.
    return b.endMinute - a.endMinute;
  });

  const result: PositionedEvent[] = [];
  let cluster: Array<Candidate & { column: number }> = [];
  let columnEnds: number[] = [];
  let clusterRunningEnd = 0;

  const flushCluster = () => {
    if (cluster.length === 0) return;
    const totalColumns = columnEnds.length;
    for (const c of cluster) {
      result.push({ ...c, totalColumns });
    }
    cluster = [];
    columnEnds = [];
    clusterRunningEnd = 0;
  };

  for (const cand of candidates) {
    if (cluster.length > 0 && cand.startMinute >= clusterRunningEnd) {
      flushCluster();
    }
    let col = columnEnds.findIndex((end) => end <= cand.startMinute);
    if (col === -1) {
      col = columnEnds.length;
      columnEnds.push(cand.endMinute);
    } else {
      columnEnds[col] = cand.endMinute;
    }
    cluster.push({ ...cand, column: col });
    clusterRunningEnd = Math.max(clusterRunningEnd, cand.endMinute);
  }
  flushCluster();

  return result;
}

/** Multi-day all-day events for the week/month strip.
 *
 * Returned in display order with span info so callers can render each
 * as a continuous bar across cells. The span is clamped to the
 * provided window — an event running Sun..Thu shown in a Sun..Sat
 * week renders as a 5-day bar starting at offset 0. */
export interface AllDayBar {
  event: CalendarEvent;
  /** Index (0-based) of the first day in the window the bar occupies. */
  startIndex: number;
  /** Number of consecutive days the bar covers, >= 1. */
  length: number;
}

export function layoutAllDayEvents(
  events: CalendarEvent[],
  windowStart: Date,
  dayCount: number,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): AllDayBar[] {
  const dayRanges = Array.from({ length: dayCount }, (_, index) =>
    zonedDayRange(addZonedDays(windowStart, index, timeZone), timeZone),
  );

  const bars: AllDayBar[] = [];
  for (const ev of events) {
    if (!ev.isAllDay && !spansMultipleDays(ev, timeZone)) continue;
    const evStartMs = new Date(ev.startsAt).getTime();
    const evEndMs = new Date(ev.endsAt).getTime();
    let firstIndex = -1;
    let lastIndex = -1;
    for (let index = 0; index < dayRanges.length; index += 1) {
      const range = dayRanges[index];
      if (evEndMs <= range.startsAt.getTime() || evStartMs >= range.endsAt.getTime()) {
        continue;
      }
      if (firstIndex === -1) firstIndex = index;
      lastIndex = index;
    }
    if (firstIndex === -1 || lastIndex === -1) continue;
    bars.push({
      event: ev,
      startIndex: firstIndex,
      length: lastIndex - firstIndex + 1,
    });
  }

  // Stable sort: earlier-starting and longer-running bars first, so
  // multi-day items stack predictably above single-day chips.
  bars.sort((a, b) => {
    if (a.startIndex !== b.startIndex) return a.startIndex - b.startIndex;
    return b.length - a.length;
  });
  return bars;
}

function spansMultipleDays(
  ev: CalendarEvent,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): boolean {
  const start = new Date(ev.startsAt);
  const end = new Date(ev.endsAt);
  return !isSameZonedDay(start, end, timeZone);
}
