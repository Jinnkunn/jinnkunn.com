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
): PositionedEvent[] {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayStartMs + MINUTES_PER_DAY * 60_000;

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
    const startMinute = Math.round((clippedStart - dayStartMs) / 60_000);
    let endMinute = Math.round((clippedEnd - dayStartMs) / 60_000);
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
 * provided window — an event running Mon..Fri shown in a Mon..Sun
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
): AllDayBar[] {
  const startMs = startOfLocalDay(windowStart).getTime();
  const endMs = startMs + dayCount * MINUTES_PER_DAY * 60_000;

  const bars: AllDayBar[] = [];
  for (const ev of events) {
    if (!ev.isAllDay && !spansMultipleDays(ev)) continue;
    const evStartMs = new Date(ev.startsAt).getTime();
    const evEndMs = new Date(ev.endsAt).getTime();
    if (evEndMs <= startMs || evStartMs >= endMs) continue;

    const clippedStart = Math.max(evStartMs, startMs);
    const clippedEnd = Math.min(evEndMs, endMs);
    const startIndex = Math.floor(
      (clippedStart - startMs) / (MINUTES_PER_DAY * 60_000),
    );
    // EventKit reports all-day events as start-of-day to start-of-next-day,
    // so a single-day event has length 1, not 0. `Math.ceil` over the
    // remaining range keeps that consistent for both all-day and timed
    // multi-day events.
    const lengthDays = Math.max(
      1,
      Math.ceil(
        (clippedEnd - clippedStart - 1) / (MINUTES_PER_DAY * 60_000),
      ),
    );
    const length = Math.min(lengthDays, dayCount - startIndex);
    bars.push({ event: ev, startIndex, length });
  }

  // Stable sort: earlier-starting and longer-running bars first, so
  // multi-day items stack predictably above single-day chips.
  bars.sort((a, b) => {
    if (a.startIndex !== b.startIndex) return a.startIndex - b.startIndex;
    return b.length - a.length;
  });
  return bars;
}

function startOfLocalDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function spansMultipleDays(ev: CalendarEvent): boolean {
  const start = new Date(ev.startsAt);
  const end = new Date(ev.endsAt);
  return (
    start.getFullYear() !== end.getFullYear() ||
    start.getMonth() !== end.getMonth() ||
    start.getDate() !== end.getDate()
  );
}
