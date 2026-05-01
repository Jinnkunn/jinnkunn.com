import { useEffect, useState, type MouseEvent, type PointerEvent } from "react";

import { isSameDay } from "./dateRange";
import { DisclosureBadge } from "./DisclosureBadge";
import { layoutDayEvents, type PositionedEvent } from "./eventLayout";
import type { Calendar, CalendarEvent, EventDisclosureResolver } from "./types";
import type { TodoRow } from "../../modules/todos/api";
import {
  DEFAULT_CALENDAR_TIME_ZONE,
  formatInTimeZone,
  zonedDateAtMinute,
  zonedMinuteOfDay,
} from "../../../../../lib/shared/calendar-timezone.ts";
import {
  todoTimelineEnd,
  todoTimelineKind,
  todoTimelineStart,
  type TodoTimelineKind,
} from "../../modules/todos/time";

/** Pixels per hour. macOS Calendar uses ~44px at default zoom; matching
 * that keeps text-block events readable without dominating the pane. */
export const HOUR_HEIGHT = 44;
/** Width of the hour-label gutter on the left. macOS uses ~56–60px. */
export const TIME_GUTTER_WIDTH = 56;

const HOURS_PER_DAY = 24;
const MINUTES_PER_DAY = HOURS_PER_DAY * 60;
const APPLE_RED = "#FF3B30";
const CREATE_SLOT_MINUTES = 15;

export interface CalendarTimeSlotSelection {
  startsAt: Date;
  endsAt?: Date;
  point: {
    x: number;
    y: number;
  };
}

/** Shared timeline used by Day and Week views. Renders one column per
 * date in `days`, each with hour gridlines and absolutely positioned
 * event blocks laid out for overlap (equal-width split). All-day events
 * are filtered out — render those in a separate strip above. Todos with
 * a `dueAt` on the day are overlaid on top of events as 22px chips so
 * users can see scheduled work and due reminders without leaving the
 * calendar. */
export function TimeGrid({
  days,
  events,
  calendarsById,
  todos = [],
  onEventSelect,
  onTodoSelect,
  onTodoToggle,
  onSlotCreate,
  getDisclosure,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
}: {
  days: Date[];
  events: CalendarEvent[];
  calendarsById: Map<string, Calendar>;
  /** Todos with a scheduled start or due timestamp. Untimed / archived
   * todos are filtered out by the timeline layout. */
  todos?: TodoRow[];
  onEventSelect?: (event: CalendarEvent) => void;
  /** Selecting a todo opens the parent inspector/editor. */
  onTodoSelect?: (todo: TodoRow) => void;
  /** Leading todo controls flip completion. The parent keeps the
   * source-of-truth list in sync (optimistic + retry). */
  onTodoToggle?: (id: string, completed: boolean) => void;
  onSlotCreate?: (selection: CalendarTimeSlotSelection) => void;
  getDisclosure?: EventDisclosureResolver;
  timeZone?: string;
}) {
  const totalHeight = HOUR_HEIGHT * HOURS_PER_DAY;
  const now = useNow();
  const todayIdx = days.findIndex((d) => isSameDay(d, now, timeZone));
  const nowMinute = zonedMinuteOfDay(now, timeZone);
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
        const positioned = layoutDayEvents(events, day, timeZone);
        const dayTodos = layoutDayTodos(todos, day, timeZone);
        const isToday = idx === todayIdx;
        return (
          <DayColumn
            key={day.toISOString()}
            day={day}
            positioned={positioned}
            todos={dayTodos}
            calendarsById={calendarsById}
            onEventSelect={onEventSelect}
            onTodoSelect={onTodoSelect}
            onTodoToggle={onTodoToggle}
            onSlotCreate={onSlotCreate}
            getDisclosure={getDisclosure}
            timeZone={timeZone}
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

/** Pixel-positioned todo for one day column. Scheduled todos may claim
 * vertical duration; due-only todos stay compact. */
interface PositionedTodo {
  todo: TodoRow;
  kind: TodoTimelineKind;
  startMinute: number;
  endMinute: number | null;
}

const TODO_CHIP_HEIGHT = 22;

/** Filter the todos array to ones that fall on `day` (local-time
 * comparison) and stamp each with the within-day minute offset the
 * chip should sit at. Untimed and archived todos are dropped — those
 * belong in the Todos surface, not the timeline. */
function layoutDayTodos(
  todos: readonly TodoRow[],
  day: Date,
  timeZone: string,
): PositionedTodo[] {
  const out: PositionedTodo[] = [];
  for (const todo of todos) {
    if (todo.archivedAt !== null) continue;
    const start = todoTimelineStart(todo);
    if (start === null) continue;
    const startDate = new Date(start);
    if (!isSameDay(startDate, day, timeZone)) continue;
    const end = todoTimelineEnd(todo);
    const endDate = end === null ? null : new Date(end);
    const endMinute =
      endDate !== null && isSameDay(endDate, day, timeZone)
        ? zonedMinuteOfDay(endDate, timeZone)
        : null;
    out.push({
      todo,
      kind: todoTimelineKind(todo),
      startMinute: zonedMinuteOfDay(startDate, timeZone),
      endMinute,
    });
  }
  out.sort((a, b) => a.startMinute - b.startMinute);
  return out;
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
  todos,
  calendarsById,
  onEventSelect,
  onTodoSelect,
  onTodoToggle,
  onSlotCreate,
  getDisclosure,
  timeZone,
  totalHeight,
  nowTopPx,
  withRightBorder,
}: {
  day: Date;
  positioned: PositionedEvent[];
  todos: PositionedTodo[];
  calendarsById: Map<string, Calendar>;
  onEventSelect?: (event: CalendarEvent) => void;
  onTodoSelect?: (todo: TodoRow) => void;
  onTodoToggle?: (id: string, completed: boolean) => void;
  onSlotCreate?: (selection: CalendarTimeSlotSelection) => void;
  getDisclosure?: EventDisclosureResolver;
  timeZone: string;
  totalHeight: number;
  nowTopPx: number | null;
  withRightBorder: boolean;
}) {
  const [dragSelection, setDragSelection] = useState<{
    startMinute: number;
    endMinute: number;
    originY: number;
    pointerId: number;
    point: { x: number; y: number };
  } | null>(null);
  const selectedStartMinute = dragSelection
    ? Math.min(dragSelection.startMinute, dragSelection.endMinute)
    : 0;
  const selectedEndMinute = dragSelection
    ? Math.max(dragSelection.startMinute, dragSelection.endMinute)
    : 0;
  const selectedHeight = Math.max(
    CREATE_SLOT_MINUTES,
    selectedEndMinute - selectedStartMinute,
  );

  const minuteFromPointer = (
    event: PointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const rawY = Math.max(0, Math.min(totalHeight, event.clientY - rect.top));
    const rawMinute = (rawY / HOUR_HEIGHT) * 60;
    return Math.max(
      0,
      Math.min(
        MINUTES_PER_DAY,
        Math.round(rawMinute / CREATE_SLOT_MINUTES) * CREATE_SLOT_MINUTES,
      ),
    );
  };

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
      onPointerDown={(event) => {
        if (!onSlotCreate) return;
        if (event.button !== 0) return;
        if ((event.target as HTMLElement | null)?.closest("button")) return;
        const minute = minuteFromPointer(event);
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragSelection({
          startMinute: minute,
          endMinute: minute,
          originY: event.clientY,
          pointerId: event.pointerId,
          point: { x: event.clientX, y: event.clientY },
        });
      }}
      onPointerMove={(event) => {
        if (!dragSelection || event.pointerId !== dragSelection.pointerId) return;
        const minute = minuteFromPointer(event);
        setDragSelection((current) =>
          current && current.pointerId === event.pointerId
            ? { ...current, endMinute: minute }
            : current,
        );
      }}
      onPointerUp={(event) => {
        if (!dragSelection || event.pointerId !== dragSelection.pointerId) return;
        const moved = Math.abs(event.clientY - dragSelection.originY);
        const startMinute = Math.min(
          dragSelection.startMinute,
          dragSelection.endMinute,
        );
        let endMinute = Math.max(
          dragSelection.startMinute,
          dragSelection.endMinute,
        );
        if (endMinute <= startMinute) endMinute = startMinute + CREATE_SLOT_MINUTES;
        endMinute = Math.min(MINUTES_PER_DAY, endMinute);
        setDragSelection(null);
        if (moved < 6 && endMinute - startMinute <= CREATE_SLOT_MINUTES) return;
        onSlotCreate?.({
          startsAt: zonedDateAtMinute(day, startMinute, timeZone),
          endsAt: zonedDateAtMinute(day, endMinute, timeZone),
          point: dragSelection.point,
        });
      }}
      onPointerCancel={() => setDragSelection(null)}
      onDoubleClick={(event) => {
        if (!onSlotCreate) return;
        if ((event.target as HTMLElement | null)?.closest("button")) return;
        const minute = minuteFromPointer(event);
        onSlotCreate({
          startsAt: zonedDateAtMinute(day, minute, timeZone),
          endsAt: zonedDateAtMinute(
            day,
            Math.min(MINUTES_PER_DAY, minute + CREATE_SLOT_MINUTES * 4),
            timeZone,
          ),
          point: { x: event.clientX, y: event.clientY },
        });
      }}
    >
      {dragSelection ? (
        <div
          className="calendar-time-selection"
          style={{
            top: `${(selectedStartMinute / 60) * HOUR_HEIGHT}px`,
            height: `${(selectedHeight / 60) * HOUR_HEIGHT}px`,
          }}
          aria-hidden="true"
        >
          <span>
            {formatMinuteOfDay(selectedStartMinute)}
            {" - "}
            {formatMinuteOfDay(
              Math.min(MINUTES_PER_DAY, selectedStartMinute + selectedHeight),
            )}
          </span>
        </div>
      ) : null}
      {positioned.map((p) => (
        <EventBlock
          key={`${p.event.eventIdentifier}-${day.toISOString()}`}
          positioned={p}
          calendarsById={calendarsById}
          onEventSelect={onEventSelect}
          getDisclosure={getDisclosure}
          timeZone={timeZone}
        />
      ))}
      {todos.map((t) => (
        <TodoChip
          key={`todo-${t.todo.id}-${day.toISOString()}`}
          positioned={t}
          onTodoSelect={onTodoSelect}
          onTodoToggle={onTodoToggle}
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
  onEventSelect,
  getDisclosure,
  timeZone,
}: {
  positioned: PositionedEvent;
  calendarsById: Map<string, Calendar>;
  onEventSelect?: (event: CalendarEvent) => void;
  getDisclosure?: EventDisclosureResolver;
  timeZone: string;
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
    <button
      type="button"
      className="absolute overflow-hidden text-left text-[11.5px] leading-tight rounded-[4px] border-0 p-0 cursor-pointer"
      onClick={() => onEventSelect?.(event)}
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
        {getDisclosure ? (
          <DisclosureBadge visibility={getDisclosure(event)} compact />
        ) : null}
        {height >= HOUR_HEIGHT * 0.6 && !event.isAllDay ? (
          <div className="text-text-secondary truncate">
            {formatHM(event.startsAt, timeZone)}
            {event.location ? ` · ${event.location}` : ""}
          </div>
        ) : null}
      </div>
    </button>
  );
}

/** A todo chip pinned to its scheduled start or due minute. The title
 * opens the todo inspector while the leading control flips completion;
 * chips render above events so they remain clickable when an event
 * happens to occupy the same minute. */
function TodoChip({
  positioned,
  onTodoSelect,
  onTodoToggle,
}: {
  positioned: PositionedTodo;
  onTodoSelect?: (todo: TodoRow) => void;
  onTodoToggle?: (id: string, completed: boolean) => void;
}) {
  const { todo, kind, startMinute, endMinute } = positioned;
  const top = (startMinute / 60) * HOUR_HEIGHT;
  const durationHeight =
    endMinute !== null && endMinute > startMinute
      ? ((endMinute - startMinute) / 60) * HOUR_HEIGHT - 1
      : TODO_CHIP_HEIGHT;
  const height = Math.max(TODO_CHIP_HEIGHT, durationHeight);
  const completed = todo.completedAt !== null;
  return (
    <div
      className="absolute overflow-hidden text-left text-[11.5px] leading-tight flex items-start gap-1.5 px-1.5 py-1 rounded-[4px]"
      title={
        todo.notes
          ? `${todo.title || "(Untitled)"}\n${todo.notes}`
          : todo.title || "(Untitled)"
      }
      data-completed={completed ? "true" : undefined}
      data-kind={kind}
      style={{
        left: "1px",
        right: "1px",
        top: `${top}px`,
        height: `${height}px`,
        background: completed
          ? "transparent"
          : kind === "scheduled"
            ? "color-mix(in srgb, var(--color-accent, #0A84FF) 10%, var(--color-bg-surface, #fff))"
            : "color-mix(in srgb, var(--color-bg-surface, #fff) 88%, transparent)",
        boxShadow: `inset 0 0 0 1px ${
          completed
            ? "rgba(0,0,0,0.18)"
            : "color-mix(in srgb, var(--color-accent, #0A84FF) 55%, transparent)"
        }`,
        color: "var(--color-text-primary)",
        opacity: completed ? 0.55 : 1,
        zIndex: 6,
      }}
    >
      <button
        type="button"
        aria-label={completed ? "Mark open" : "Mark done"}
        className="calendar-todo-chip__toggle"
        onClick={() => onTodoToggle?.(todo.id, !completed)}
        style={{
          width: "12px",
          height: "12px",
          boxShadow: completed
            ? "inset 0 0 0 1px rgba(0,0,0,0.35)"
            : "inset 0 0 0 1.5px var(--color-accent, #0A84FF)",
          background: completed ? "rgba(0,0,0,0.35)" : "transparent",
        }}
      >
        {completed ? (
          <svg
            viewBox="0 0 12 12"
            width="8"
            height="8"
            fill="none"
            stroke="white"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2.5 6.25l2.25 2L9.5 3.75" />
          </svg>
        ) : null}
      </button>
      <button
        type="button"
        className="calendar-todo-chip__body truncate"
        onClick={() => onTodoSelect?.(todo)}
        style={{
          textDecoration: completed ? "line-through" : "none",
          textDecorationColor: completed ? "rgba(0,0,0,0.45)" : undefined,
        }}
      >
        <span className="block truncate">{todo.title || "(Untitled)"}</span>
        {height >= 36 ? (
          <span className="block truncate text-[10.5px] text-text-muted">
            {kind === "scheduled"
              ? formatTodoTimeRange(startMinute, endMinute)
              : "due"}
          </span>
        ) : null}
      </button>
    </div>
  );
}

/** Locale-aware "1 AM" / "13:00" formatter for the hour gutter. */
function formatHourLabel(hour: number): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric" });
}

function formatHM(iso: string, timeZone: string): string {
  return formatInTimeZone(iso, timeZone, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTodoTimeRange(
  startMinute: number,
  endMinute: number | null,
): string {
  const start = formatMinuteOfDay(startMinute);
  if (endMinute === null || endMinute <= startMinute) return start;
  return `${start} - ${formatMinuteOfDay(endMinute)}`;
}

function formatMinuteOfDay(minuteOfDay: number): string {
  const d = new Date();
  d.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  return d.toLocaleTimeString(undefined, {
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
