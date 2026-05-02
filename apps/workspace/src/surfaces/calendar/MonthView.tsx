import { useMemo } from "react";

import { isSameDay, isSameMonth, isWeekend, monthGridDays } from "./dateRange";
import { DisclosureBadge } from "./DisclosureBadge";
import { layoutAllDayEvents, type AllDayBar } from "./eventLayout";
import type { Calendar, CalendarEvent, EventDisclosureResolver } from "./types";
import {
  DEFAULT_CALENDAR_TIME_ZONE,
  addZonedDays,
  formatInTimeZone,
  isSameZonedDay,
  zonedDateAtMinute,
  zonedDayRange,
} from "../../../../../lib/shared/calendar-timezone.ts";

const BAR_HEIGHT = 18;
const BAR_GAP = 2;
const MAX_VISIBLE_BARS = 3;

/** macOS-style month grid. Each row is one week (Sun..Sat); spanning
 * events render as continuous bars across the row, single-day timed
 * events render as chips inside each cell, and a "+N more" footer
 * appears when a cell has too many to fit. */
export function MonthView({
  anchor,
  events,
  calendarsById,
  onEventSelect,
  onDayCreate,
  getDisclosure,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
}: {
  anchor: Date;
  events: CalendarEvent[];
  calendarsById: Map<string, Calendar>;
  onEventSelect?: (event: CalendarEvent) => void;
  onDayCreate?: (selection: {
    startsAt: Date;
    point: { x: number; y: number };
  }) => void;
  getDisclosure?: EventDisclosureResolver;
  timeZone?: string;
}) {
  const days = useMemo(() => monthGridDays(anchor, timeZone), [anchor, timeZone]);
  const weekRows = useMemo(() => chunk(days, 7), [days]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <WeekdayHeader timeZone={timeZone} />
      <div className="flex flex-col flex-1 min-h-0">
        {weekRows.map((week, idx) => (
          <WeekRow
            key={week[0].toISOString()}
            week={week}
            events={events}
            calendarsById={calendarsById}
            anchor={anchor}
            isFirstRow={idx === 0}
            onEventSelect={onEventSelect}
            onDayCreate={onDayCreate}
            getDisclosure={getDisclosure}
            timeZone={timeZone}
          />
        ))}
      </div>
    </div>
  );
}

function WeekdayHeader({ timeZone }: { timeZone: string }) {
  // Use a known Sunday so locale-aware short names render correctly
  // (some locales return different abbreviations than `["Mon", "Tue", ...]`).
  const sunday = new Date(2024, 0, 7); // Sun 2024-01-07
  const labels = Array.from({ length: 7 }, (_, i) => {
    const day = addZonedDays(sunday, i, timeZone);
    return {
      day,
      label: formatInTimeZone(day, timeZone, { weekday: "short" }),
    };
  });
  return (
    <div className="grid grid-cols-7 border-b border-[rgba(0,0,0,0.08)]">
      {labels.map(({ day, label }) => (
        <div
          key={day.toISOString()}
          className="calendar-weekday-cell text-center py-2 text-[10.5px] font-semibold tracking-[0.06em] uppercase text-text-muted"
          data-weekend={isWeekend(day, timeZone) ? "true" : "false"}
        >
          {label}
        </div>
      ))}
    </div>
  );
}

function WeekRow({
  week,
  events,
  calendarsById,
  anchor,
  isFirstRow,
  onEventSelect,
  onDayCreate,
  getDisclosure,
  timeZone,
}: {
  week: Date[];
  events: CalendarEvent[];
  calendarsById: Map<string, Calendar>;
  anchor: Date;
  isFirstRow: boolean;
  onEventSelect?: (event: CalendarEvent) => void;
  onDayCreate?: (selection: {
    startsAt: Date;
    point: { x: number; y: number };
  }) => void;
  getDisclosure?: EventDisclosureResolver;
  timeZone: string;
}) {
  // Anything that should render as a continuous bar — both multi-day
  // events and single-day all-day events. Single-day timed events
  // render as chips inside each cell instead.
  const spanningEvents = useMemo(
    () => events.filter((e) => e.isAllDay || crossesMidnight(e, timeZone)),
    [events, timeZone],
  );
  const bars = useMemo(
    () => layoutAllDayEvents(spanningEvents, week[0], week.length, timeZone),
    [spanningEvents, week, timeZone],
  );
  const barRows = useMemo(() => stackBars(bars), [bars]);

  // Bars take the slot directly under the date number; the per-cell
  // chip column starts below all bars to avoid collisions.
  const barsHeightPx =
    Math.max(barRows.length, 1) * (BAR_HEIGHT + BAR_GAP);

  const today = new Date();

  return (
    <div
      className="relative grid grid-cols-7 flex-1 min-h-0"
      style={{
        borderTop: isFirstRow ? undefined : "1px solid rgba(0,0,0,0.08)",
      }}
    >
      {week.map((day, dayIdx) => {
        const isToday = isSameDay(day, today, timeZone);
        const inMonth = isSameMonth(day, anchor, timeZone);
        const weekend = isWeekend(day, timeZone);
        const cellTimed = events
          .filter(
            (e) =>
              !e.isAllDay && !crossesMidnight(e, timeZone) && touchesDay(e, day, timeZone),
          )
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        // Number of bar rows that intersect this day decides how many
        // chip slots remain before we collapse to "+N more".
        const barsTouchingDay = barRows.reduce(
          (acc, row) =>
            acc + (row.some((b) => barTouchesIndex(b, dayIdx)) ? 1 : 0),
          0,
        );
        const remainingSlots = Math.max(
          0,
          MAX_VISIBLE_BARS - barsTouchingDay,
        );
        const visibleTimed = cellTimed.slice(0, remainingSlots);
        const overflowCount =
          cellTimed.length - visibleTimed.length;
        return (
          <div
            key={day.toISOString()}
            className="calendar-month-cell relative flex flex-col px-1 pt-1 pb-0.5 min-h-0"
            data-weekend={weekend ? "true" : "false"}
            style={{
              borderRight:
                dayIdx < 6 ? "1px solid rgba(0,0,0,0.08)" : undefined,
              opacity: inMonth ? 1 : 0.45,
            }}
            onDoubleClick={(event) => {
              if (!onDayCreate) return;
              if ((event.target as HTMLElement | null)?.closest("button")) return;
              onDayCreate({
                startsAt: zonedDateAtMinute(day, 9 * 60, timeZone),
                point: { x: event.clientX, y: event.clientY },
              });
            }}
          >
            <div className="flex justify-end">
              {isToday ? (
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#0A84FF] text-white text-[11px] font-semibold tabular-nums">
                  {formatInTimeZone(day, timeZone, { day: "numeric" })}
                </span>
              ) : (
                <span className="text-[11px] font-semibold text-text-primary tabular-nums">
                  {formatInTimeZone(day, timeZone, { day: "numeric" })}
                </span>
              )}
            </div>
            {/* Reserve vertical space so bars don't sit on top of chips. */}
            <div style={{ height: `${barsHeightPx}px` }} aria-hidden="true" />
            <div className="flex flex-col gap-0.5">
              {visibleTimed.map((ev) => (
                <TimedChip
                  key={ev.eventIdentifier}
                  event={ev}
                  calendarsById={calendarsById}
                  onEventSelect={onEventSelect}
                  getDisclosure={getDisclosure}
                  timeZone={timeZone}
                />
              ))}
              {overflowCount > 0 ? (
                <span className="text-[10.5px] text-text-muted px-1">
                  +{overflowCount} more
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
      {/* Continuous bars overlay — sits on top of cells but under the
          date-number badge thanks to the badge's higher stacking
          context (it's inside cell flow with implicit z-index). */}
      <div className="pointer-events-none absolute inset-x-0 grid grid-cols-7"
           style={{ top: `${24}px` }}>
        <div className="col-span-7 relative">
          {barRows.map((row, rowIdx) =>
            row.map((bar) => (
              <Bar
                key={`${bar.event.eventIdentifier}-${bar.startIndex}-${rowIdx}`}
                bar={bar}
                rowIdx={rowIdx}
                weekDayCount={week.length}
                calendarsById={calendarsById}
                onEventSelect={onEventSelect}
                getDisclosure={getDisclosure}
              />
            )),
          )}
        </div>
      </div>
    </div>
  );
}

function Bar({
  bar,
  rowIdx,
  weekDayCount,
  calendarsById,
  onEventSelect,
  getDisclosure,
}: {
  bar: AllDayBar;
  rowIdx: number;
  weekDayCount: number;
  calendarsById: Map<string, Calendar>;
  onEventSelect?: (event: CalendarEvent) => void;
  getDisclosure?: EventDisclosureResolver;
}) {
  const cal = calendarsById.get(bar.event.calendarId);
  const color = cal?.colorHex ?? "#7A7A7A";
  const widthPct = (bar.length / weekDayCount) * 100;
  const leftPct = (bar.startIndex / weekDayCount) * 100;
  return (
    <button
      type="button"
      className="absolute box-border max-w-full text-[10.5px] truncate px-1.5 rounded leading-[16px] border-0 text-left cursor-pointer pointer-events-auto"
      onClick={() => onEventSelect?.(bar.event)}
      title={bar.event.title || "(No title)"}
      style={{
        left: `calc(${leftPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
        top: `${rowIdx * (BAR_HEIGHT + BAR_GAP)}px`,
        height: `${BAR_HEIGHT}px`,
        background: tint(color),
        color,
        boxShadow: `inset 3px 0 0 0 ${color}`,
      }}
    >
      <span>{bar.event.title || "(No title)"}</span>
      {getDisclosure ? (
        <DisclosureBadge visibility={getDisclosure(bar.event)} compact />
      ) : null}
    </button>
  );
}

function TimedChip({
  event,
  calendarsById,
  onEventSelect,
  getDisclosure,
  timeZone,
}: {
  event: CalendarEvent;
  calendarsById: Map<string, Calendar>;
  onEventSelect?: (event: CalendarEvent) => void;
  getDisclosure?: EventDisclosureResolver;
  timeZone: string;
}) {
  const cal = calendarsById.get(event.calendarId);
  const color = cal?.colorHex ?? "#7A7A7A";
  const time = formatInTimeZone(event.startsAt, timeZone, {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <button
      type="button"
      className="flex items-center gap-1 text-[10.5px] truncate px-1 leading-[16px] border-0 bg-transparent text-left cursor-pointer"
      onClick={() => onEventSelect?.(event)}
      title={event.title || "(No title)"}
      style={{ color: "var(--color-text-primary, currentColor)" }}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ background: color }}
        aria-hidden="true"
      />
      <span className="text-text-muted tabular-nums flex-shrink-0">
        {time}
      </span>
      <span className="truncate text-text-primary">
        {event.title || "(No title)"}
      </span>
      {getDisclosure ? (
        <DisclosureBadge visibility={getDisclosure(event)} compact />
      ) : null}
    </button>
  );
}

/** Greedy row packing — same algorithm as WeekView's all-day strip,
 * inlined so MonthView doesn't pull on a sibling component's helper. */
function stackBars(bars: AllDayBar[]): AllDayBar[][] {
  const rows: { items: AllDayBar[]; nextFreeAt: number }[] = [];
  for (const bar of bars) {
    let placed = false;
    for (const row of rows) {
      if (row.nextFreeAt <= bar.startIndex) {
        row.items.push(bar);
        row.nextFreeAt = bar.startIndex + bar.length;
        placed = true;
        break;
      }
    }
    if (!placed) {
      rows.push({ items: [bar], nextFreeAt: bar.startIndex + bar.length });
    }
  }
  return rows.map((r) => r.items);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function crossesMidnight(ev: CalendarEvent, timeZone: string): boolean {
  const start = new Date(ev.startsAt);
  const end = new Date(ev.endsAt);
  return !isSameZonedDay(start, end, timeZone);
}

function touchesDay(ev: CalendarEvent, day: Date, timeZone: string): boolean {
  const { startsAt, endsAt } = zonedDayRange(day, timeZone);
  const start = new Date(ev.startsAt).getTime();
  const end = new Date(ev.endsAt).getTime();
  return end > startsAt.getTime() && start < endsAt.getTime();
}

function barTouchesIndex(bar: AllDayBar, idx: number): boolean {
  return idx >= bar.startIndex && idx < bar.startIndex + bar.length;
}

function tint(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "rgba(122,122,122,0.18)";
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, 0.18)`;
}
