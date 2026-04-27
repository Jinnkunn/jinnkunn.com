import { useEffect, useMemo, useRef } from "react";

import { isSameDay } from "./dateRange";
import { TimeGrid, HOUR_HEIGHT, TIME_GUTTER_WIDTH } from "./TimeGrid";
import type { Calendar, CalendarEvent } from "./types";

/** Single-day timeline. The header strip shows the weekday name + date
 * with a blue circle around the number when it's today, matching the
 * macOS Calendar Day view. */
export function DayView({
  day,
  events,
  calendarsById,
}: {
  day: Date;
  events: CalendarEvent[];
  calendarsById: Map<string, Calendar>;
}) {
  const allDayEvents = useMemo(
    () => events.filter((e) => e.isAllDay && touchesDay(e, day)),
    [events, day],
  );

  // On mount + on day change, scroll so 8 AM is the first thing the
  // user sees — same opening behavior as macOS Calendar.
  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = HOUR_HEIGHT * 7;
  }, [day]);

  const isToday = isSameDay(day, new Date());

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <DayHeader day={day} isToday={isToday} />
      {allDayEvents.length > 0 ? (
        <AllDayStrip events={allDayEvents} calendarsById={calendarsById} />
      ) : null}
      <div ref={scrollerRef} className="flex-1 min-h-0 overflow-y-auto">
        <TimeGrid days={[day]} events={events} calendarsById={calendarsById} />
      </div>
    </div>
  );
}

function DayHeader({ day, isToday }: { day: Date; isToday: boolean }) {
  const weekday = day
    .toLocaleDateString(undefined, { weekday: "short" })
    .toUpperCase();
  return (
    <div
      className="grid border-b border-[rgba(0,0,0,0.08)]"
      style={{
        gridTemplateColumns: `${TIME_GUTTER_WIDTH}px minmax(0, 1fr)`,
      }}
    >
      <div />
      <div className="flex items-baseline gap-2 px-3 py-2">
        <span className="text-[10.5px] font-semibold tracking-[0.06em] text-text-muted">
          {weekday}
        </span>
        <span
          className={
            isToday
              ? "inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#0A84FF] text-white text-[14px] font-semibold"
              : "text-[14px] font-semibold text-text-primary tabular-nums"
          }
        >
          {day.getDate()}
        </span>
      </div>
    </div>
  );
}

function AllDayStrip({
  events,
  calendarsById,
}: {
  events: CalendarEvent[];
  calendarsById: Map<string, Calendar>;
}) {
  return (
    <div
      className="grid border-b border-[rgba(0,0,0,0.08)]"
      style={{ gridTemplateColumns: `${TIME_GUTTER_WIDTH}px minmax(0, 1fr)` }}
    >
      <div className="text-[10.5px] text-text-muted text-right pr-2 pt-1.5">
        all-day
      </div>
      <div className="flex flex-col gap-0.5 py-1 px-1">
        {events.map((ev) => {
          const cal = calendarsById.get(ev.calendarId);
          const color = cal?.colorHex ?? "#7A7A7A";
          return (
            <span
              key={ev.eventIdentifier}
              className="text-[11.5px] truncate px-1.5 py-0.5 rounded"
              title={ev.title || "(No title)"}
              style={{
                background: tint(color),
                color,
                boxShadow: `inset 3px 0 0 0 ${color}`,
              }}
            >
              {ev.title || "(No title)"}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function touchesDay(ev: CalendarEvent, day: Date): boolean {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const start = new Date(ev.startsAt).getTime();
  const end = new Date(ev.endsAt).getTime();
  return end > dayStart.getTime() && start < dayEnd.getTime();
}

function tint(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "rgba(122,122,122,0.18)";
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, 0.18)`;
}
