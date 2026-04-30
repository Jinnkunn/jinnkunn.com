import { useEffect, useMemo, useRef } from "react";

import { isSameDay, weekDays } from "./dateRange";
import { DisclosureBadge } from "./DisclosureBadge";
import { layoutAllDayEvents } from "./eventLayout";
import { TimeGrid, HOUR_HEIGHT, TIME_GUTTER_WIDTH } from "./TimeGrid";
import type { Calendar, CalendarEvent, EventDisclosureResolver } from "./types";
import type { TodoRow } from "../../modules/todos/api";

const ALL_DAY_BAR_HEIGHT = 18;
const ALL_DAY_BAR_GAP = 2;

/** Mon–Sun timeline. Header shows weekday + date number per column,
 * with a blue circle on today's number. The all-day strip stacks
 * multi-day bars vertically so a Mon..Fri trip and a Wed birthday
 * don't visually fight for the same row. */
export function WeekView({
  anchor,
  events,
  calendarsById,
  todos,
  onEventSelect,
  onTodoToggle,
  getDisclosure,
}: {
  anchor: Date;
  events: CalendarEvent[];
  calendarsById: Map<string, Calendar>;
  todos?: TodoRow[];
  onEventSelect?: (event: CalendarEvent) => void;
  onTodoToggle?: (id: string, completed: boolean) => void;
  getDisclosure?: EventDisclosureResolver;
}) {
  const days = useMemo(() => weekDays(anchor), [anchor]);

  const allDayBars = useMemo(
    () => layoutAllDayEvents(events, days[0], days.length),
    [events, days],
  );

  const allDayRowCount = stackRows(allDayBars).length;
  const stripHeight =
    allDayRowCount * (ALL_DAY_BAR_HEIGHT + ALL_DAY_BAR_GAP) + 8;

  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = HOUR_HEIGHT * 7;
  }, [anchor]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <WeekHeader days={days} />
      {allDayBars.length > 0 ? (
        <AllDayStrip
          days={days}
          bars={allDayBars}
          calendarsById={calendarsById}
          stripHeight={stripHeight}
          onEventSelect={onEventSelect}
          getDisclosure={getDisclosure}
        />
      ) : null}
      <div ref={scrollerRef} className="flex-1 min-h-0 overflow-y-auto">
        <TimeGrid
          days={days}
          events={events}
          calendarsById={calendarsById}
          todos={todos}
          onEventSelect={onEventSelect}
          onTodoToggle={onTodoToggle}
          getDisclosure={getDisclosure}
        />
      </div>
    </div>
  );
}

function WeekHeader({ days }: { days: Date[] }) {
  const today = new Date();
  return (
    <div
      className="grid border-b border-[rgba(0,0,0,0.08)]"
      style={{
        gridTemplateColumns: `${TIME_GUTTER_WIDTH}px repeat(${days.length}, minmax(0, 1fr))`,
      }}
    >
      <div />
      {days.map((day) => {
        const isToday = isSameDay(day, today);
        return (
          <div
            key={day.toISOString()}
            className="flex flex-col items-center justify-center py-2 gap-0.5"
          >
            <span className="text-[10px] font-semibold tracking-[0.06em] text-text-muted uppercase">
              {day.toLocaleDateString(undefined, { weekday: "short" })}
            </span>
            <span
              className={
                isToday
                  ? "inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#0A84FF] text-white text-[12.5px] font-semibold"
                  : "text-[13px] font-semibold text-text-primary tabular-nums"
              }
            >
              {day.getDate()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function AllDayStrip({
  days,
  bars,
  calendarsById,
  stripHeight,
  onEventSelect,
  getDisclosure,
}: {
  days: Date[];
  bars: ReturnType<typeof layoutAllDayEvents>;
  calendarsById: Map<string, Calendar>;
  stripHeight: number;
  onEventSelect?: (event: CalendarEvent) => void;
  getDisclosure?: EventDisclosureResolver;
}) {
  // Stack bars into rows so two events on the same day don't overlap.
  const rows = stackRows(bars);
  return (
    <div
      className="grid border-b border-[rgba(0,0,0,0.08)] relative"
      style={{
        gridTemplateColumns: `${TIME_GUTTER_WIDTH}px repeat(${days.length}, minmax(0, 1fr))`,
        height: `${stripHeight}px`,
      }}
    >
      <div className="text-[10.5px] text-text-muted text-right pr-2 pt-1.5">
        all-day
      </div>
      <div
        className="col-span-7 relative"
        style={{ gridColumn: `2 / span ${days.length}` }}
      >
        {rows.map((row, rowIdx) =>
          row.map((bar) => {
            const cal = calendarsById.get(bar.event.calendarId);
            const color = cal?.colorHex ?? "#7A7A7A";
            const widthPct = (bar.length / days.length) * 100;
            const leftPct = (bar.startIndex / days.length) * 100;
            return (
              <button
                type="button"
                key={`${bar.event.eventIdentifier}-${bar.startIndex}`}
                className="absolute text-[11px] truncate px-1.5 rounded leading-[16px] border-0 text-left cursor-pointer pointer-events-auto"
                onClick={() => onEventSelect?.(bar.event)}
                title={bar.event.title || "(No title)"}
                style={{
                  left: `calc(${leftPct}% + 2px)`,
                  width: `calc(${widthPct}% - 4px)`,
                  top: `${rowIdx * (ALL_DAY_BAR_HEIGHT + ALL_DAY_BAR_GAP) + 4}px`,
                  height: `${ALL_DAY_BAR_HEIGHT}px`,
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
          }),
        )}
      </div>
    </div>
  );
}

/** Greedy row packing: bars are sorted by startIndex; place each in
 * the first row that's free at its startIndex..startIndex+length. */
function stackRows<T extends { startIndex: number; length: number }>(
  bars: T[],
): T[][] {
  const rows: { items: T[]; nextFreeAt: number }[] = [];
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

function tint(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "rgba(122,122,122,0.18)";
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, 0.18)`;
}
