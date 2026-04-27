import { useEffect, useState } from "react";

import { isSameDay } from "./dateRange";
import { layoutDayEvents, type PositionedEvent } from "./eventLayout";
import type { Calendar, CalendarEvent } from "./types";

/** Pixels per hour. macOS Calendar uses ~44px at default zoom; matching
 * that keeps text-block events readable without dominating the pane. */
export const HOUR_HEIGHT = 44;
/** Width of the hour-label gutter on the left. macOS uses ~56–60px. */
export const TIME_GUTTER_WIDTH = 56;

const HOURS_PER_DAY = 24;
const APPLE_RED = "#FF3B30";

/** Shared timeline used by Day and Week views. Renders one column per
 * date in `days`, each with hour gridlines and absolutely positioned
 * event blocks laid out for overlap (equal-width split). All-day events
 * are filtered out — render those in a separate strip above. */
export function TimeGrid({
  days,
  events,
  calendarsById,
}: {
  days: Date[];
  events: CalendarEvent[];
  calendarsById: Map<string, Calendar>;
}) {
  const totalHeight = HOUR_HEIGHT * HOURS_PER_DAY;
  const now = useNow();
  const todayIdx = days.findIndex((d) => isSameDay(d, now));
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  const nowTopPx = (nowMinute / 60) * HOUR_HEIGHT;

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `${TIME_GUTTER_WIDTH}px repeat(${days.length}, minmax(0, 1fr))`,
      }}
    >
      <HourGutter totalHeight={totalHeight} nowTopPx={todayIdx >= 0 ? nowTopPx : null} />
      {days.map((day, idx) => {
        const positioned = layoutDayEvents(events, day);
        const isToday = idx === todayIdx;
        return (
          <DayColumn
            key={day.toISOString()}
            day={day}
            positioned={positioned}
            calendarsById={calendarsById}
            totalHeight={totalHeight}
            nowTopPx={isToday ? nowTopPx : null}
            // Right edge of each column except the last gets a vertical
            // separator — matches the macOS look without doubling the
            // gutter line.
            withRightBorder={idx < days.length - 1}
          />
        );
      })}
    </div>
  );
}

/** Left gutter showing one hour label per row. The labels align with
 * the *bottom* of each hour band (above the next hour's line) which is
 * how macOS does it — "1 AM" sits just above the 1 AM gridline. */
function HourGutter({
  totalHeight,
  nowTopPx,
}: {
  totalHeight: number;
  nowTopPx: number | null;
}) {
  return (
    <div
      className="relative"
      style={{ height: `${totalHeight}px` }}
      aria-hidden="true"
    >
      {Array.from({ length: HOURS_PER_DAY }, (_, hour) => (
        <div
          key={hour}
          className="absolute right-2 text-[10px] text-text-muted tabular-nums"
          style={{
            top: `${hour * HOUR_HEIGHT - 6}px`,
            // Hide the top "12 AM" label — macOS does too, since there's
            // no gridline above it for the label to anchor to.
            visibility: hour === 0 ? "hidden" : "visible",
          }}
        >
          {formatHourLabel(hour)}
        </div>
      ))}
      {nowTopPx !== null ? (
        <span
          className="absolute right-1 w-2 h-2 rounded-full"
          style={{
            top: `${nowTopPx - 4}px`,
            background: APPLE_RED,
          }}
        />
      ) : null}
    </div>
  );
}

/** One day's worth of timeline. Owns its own absolutely-positioned
 * event blocks plus the optional "now" line that crosses today's
 * column when the user is viewing the current week. */
function DayColumn({
  day,
  positioned,
  calendarsById,
  totalHeight,
  nowTopPx,
  withRightBorder,
}: {
  day: Date;
  positioned: PositionedEvent[];
  calendarsById: Map<string, Calendar>;
  totalHeight: number;
  nowTopPx: number | null;
  withRightBorder: boolean;
}) {
  return (
    <div
      className="relative"
      style={{
        height: `${totalHeight}px`,
        // 1px hour rows via repeating gradient — pixel-perfect with
        // the absolute event positions and cheaper than 24 sibling divs.
        backgroundImage:
          `repeating-linear-gradient(to bottom,` +
          ` transparent 0,` +
          ` transparent ${HOUR_HEIGHT - 1}px,` +
          ` rgba(0,0,0,0.08) ${HOUR_HEIGHT - 1}px,` +
          ` rgba(0,0,0,0.08) ${HOUR_HEIGHT}px)`,
        boxShadow: withRightBorder
          ? "inset -1px 0 0 0 rgba(0,0,0,0.08)"
          : undefined,
      }}
      data-day={day.toISOString()}
    >
      {positioned.map((p) => (
        <EventBlock
          key={`${p.event.eventIdentifier}-${day.toISOString()}`}
          positioned={p}
          calendarsById={calendarsById}
        />
      ))}
      {nowTopPx !== null ? (
        <span
          className="absolute left-0 right-0 pointer-events-none"
          style={{
            // 2px reads cleanly on the beige vibrancy background; 1px
            // disappears on Retina at default zoom.
            top: `${nowTopPx - 1}px`,
            height: "2px",
            background: APPLE_RED,
            zIndex: 5,
          }}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}

/** A single absolutely positioned event block. Color rules mirror the
 * macOS app: a 3px solid color bar on the left, a faint tint of the
 * same color filling the body, and the calendar color used for the
 * title text. Stops short of `right: 0` when the event shares its
 * cluster with others so adjacent columns don't visually merge. */
function EventBlock({
  positioned,
  calendarsById,
}: {
  positioned: PositionedEvent;
  calendarsById: Map<string, Calendar>;
}) {
  const { event, column, totalColumns, startMinute, endMinute } = positioned;
  const cal = calendarsById.get(event.calendarId);
  const color = cal?.colorHex ?? "#7A7A7A";

  const widthPct = 100 / totalColumns;
  const leftPct = column * widthPct;
  const top = (startMinute / 60) * HOUR_HEIGHT;
  const height = Math.max(
    16,
    ((endMinute - startMinute) / 60) * HOUR_HEIGHT - 1,
  );

  return (
    <article
      className="absolute overflow-hidden text-[11.5px] leading-tight rounded-[4px]"
      title={event.title || "(No title)"}
      style={{
        left: `calc(${leftPct}% + 1px)`,
        width: `calc(${widthPct}% - 2px)`,
        top: `${top}px`,
        height: `${height}px`,
        background: tintBackground(color),
        boxShadow: `inset 3px 0 0 0 ${color}`,
        color: color,
      }}
    >
      <div className="px-1.5 py-0.5">
        <div className="font-semibold truncate" style={{ color }}>
          {event.title || "(No title)"}
        </div>
        {height >= HOUR_HEIGHT * 0.6 && !event.isAllDay ? (
          <div className="text-text-secondary truncate">
            {formatHM(event.startsAt)}
            {event.location ? ` · ${event.location}` : ""}
          </div>
        ) : null}
      </div>
    </article>
  );
}

/** Locale-aware "1 AM" / "13:00" formatter for the hour gutter. */
function formatHourLabel(hour: number): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric" });
}

function formatHM(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Convert `#RRGGBB` to an `rgba(...)` with low alpha for the event-fill
 * tint. We accept the input as-is (already validated by the Rust side)
 * and fall back to mid-gray on parse failure rather than throwing. */
function tintBackground(hex: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return "rgba(122,122,122,0.18)";
  const r = parseInt(match[1], 16);
  const g = parseInt(match[2], 16);
  const b = parseInt(match[3], 16);
  return `rgba(${r}, ${g}, ${b}, 0.18)`;
}

/** Rerenders every minute so the "now" indicator drifts with real time
 * without a busy 1-second tick. Skips updates when the tab is hidden
 * since the indicator isn't visible anyway. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      // Align to the next minute boundary so the line jumps in sync
      // with the user's clock.
      const next = new Date();
      next.setSeconds(0, 0);
      next.setMinutes(next.getMinutes() + 1);
      const delay = Math.max(1000, next.getTime() - Date.now());
      timer = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, delay);
    };
    schedule();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, []);
  return now;
}
