import { useMemo } from "react";
import { Check } from "lucide-react";

import { isSameDay, startOfDay } from "./dateRange";
import { DisclosureBadge } from "./DisclosureBadge";
import type { Calendar, CalendarEvent, EventDisclosureResolver } from "./types";
import type { TodoRow } from "../../modules/todos/api";
import {
  DEFAULT_CALENDAR_TIME_ZONE,
  formatInTimeZone,
  zonedDayKey,
  zonedDateFromDayKey,
} from "../../../../../lib/shared/calendar-timezone.ts";
import {
  todoTimelineKind,
  todoTimelineStart,
} from "../../modules/todos/time";

type AgendaTodoEntry =
  | { kind: "event"; event: CalendarEvent; sortKey: string }
  | { kind: "todo"; todo: TodoRow; sortKey: string };

/** Flat list of events grouped by local day. Used as the "Agenda"
 * tab — same data the time-grid views render, just in a denser linear
 * layout that's easier to scan when you only care about "what's next".
 * Todos with a scheduled start or due time get folded into the same
 * per-day buckets so the agenda reads as "everything on deck" rather
 * than just events. */
export function AgendaView({
  events,
  calendarsById,
  todos = [],
  rangeLabel,
  getDisclosure,
  onEventSelect,
  onTodoSelect,
  onTodoToggle,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
}: {
  events: CalendarEvent[];
  calendarsById: Map<string, Calendar>;
  todos?: TodoRow[];
  /** Human-readable summary shown in the empty state, e.g. "this week". */
  rangeLabel: string;
  getDisclosure?: EventDisclosureResolver;
  onEventSelect?: (event: CalendarEvent) => void;
  onTodoSelect?: (todo: TodoRow) => void;
  onTodoToggle?: (id: string, completed: boolean) => void;
  timeZone?: string;
}) {
  const entriesByDay = useMemo(() => {
    const map = new Map<string, AgendaTodoEntry[]>();
    for (const e of events) {
      const key = zonedDayKey(e.startsAt, timeZone);
      const arr = map.get(key) ?? [];
      // All-day events sort before the rest; within a day timed
      // entries sort by ISO start. Todos compete on the same key.
      arr.push({
        kind: "event",
        event: e,
        sortKey: e.isAllDay ? `0:${e.startsAt}` : `1:${e.startsAt}`,
      });
      map.set(key, arr);
    }
    for (const todo of todos) {
      if (todo.archivedAt !== null) continue;
      const timelineStart = todoTimelineStart(todo);
      if (timelineStart === null) continue;
      const startIso = new Date(timelineStart).toISOString();
      const key = zonedDayKey(startIso, timeZone);
      const arr = map.get(key) ?? [];
      arr.push({ kind: "todo", todo, sortKey: `1:${startIso}` });
      map.set(key, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [events, todos, timeZone]);

  if (entriesByDay.length === 0) {
    return (
      <div className="text-[12.5px] text-text-muted px-1">
        No events for {rangeLabel}.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-1">
      {entriesByDay.map(([day, entries]) => (
        <section key={day}>
          <h3 className="m-0 mb-1.5 text-[11px] uppercase tracking-[0.06em] font-semibold text-text-muted">
            {formatDayHeader(day, timeZone)}
          </h3>
          <ul className="m-0 p-0 list-none flex flex-col gap-1">
            {entries.map((entry) =>
              entry.kind === "event"
                ? renderEventEntry(
                    entry.event,
                    calendarsById,
                    getDisclosure,
                    onEventSelect,
                    timeZone,
                  )
                : renderTodoEntry(
                    entry.todo,
                    onTodoSelect,
                    onTodoToggle,
                    timeZone,
                  ),
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}

function renderEventEntry(
  ev: CalendarEvent,
  calendarsById: Map<string, Calendar>,
  getDisclosure: EventDisclosureResolver | undefined,
  onEventSelect: ((event: CalendarEvent) => void) | undefined,
  timeZone: string,
) {
  const cal = calendarsById.get(ev.calendarId);
  const color = cal?.colorHex ?? "#888888";
  return (
    <li key={`event-${ev.eventIdentifier}`}>
      <button
        type="button"
        className="w-full flex items-start gap-3 px-2 py-1.5 rounded hover:bg-bg-surface-alt border-0 bg-transparent text-left cursor-pointer"
        onClick={() => onEventSelect?.(ev)}
      >
        <span
          className="mt-1 inline-block w-1 self-stretch rounded-sm flex-shrink-0"
          style={{ background: color }}
          aria-hidden="true"
        />
        <span className="w-[72px] flex-shrink-0 text-[12px] text-text-muted tabular-nums">
          {ev.isAllDay ? "All day" : formatTime(ev.startsAt, timeZone)}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] text-text-primary truncate">
            {ev.title || "(No title)"}
          </span>
          {getDisclosure ? (
            <DisclosureBadge visibility={getDisclosure(ev)} compact />
          ) : null}
          {ev.location ? (
            <span className="block text-[11.5px] text-text-muted truncate">
              {ev.location}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

function renderTodoEntry(
  todo: TodoRow,
  onTodoSelect: ((todo: TodoRow) => void) | undefined,
  onTodoToggle: ((id: string, completed: boolean) => void) | undefined,
  timeZone: string,
) {
  const completed = todo.completedAt !== null;
  const timelineStart = todoTimelineStart(todo);
  const timeLabel = timelineStart !== null
    ? formatTime(new Date(timelineStart).toISOString(), timeZone)
    : "—";
  const kindLabel = todoTimelineKind(todo) === "scheduled" ? "Scheduled" : "Due";
  return (
    <li key={`todo-${todo.id}`}>
      <div
        className="w-full flex items-start gap-3 px-2 py-1.5 rounded hover:bg-bg-surface-alt text-left"
        data-completed={completed ? "true" : undefined}
      >
        <button
          type="button"
          aria-label={completed ? "Mark open" : "Mark done"}
          className="mt-1 inline-flex items-center justify-center flex-shrink-0 rounded-full"
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
            <Check
              absoluteStrokeWidth
              aria-hidden="true"
              color="white"
              focusable="false"
              size={8}
              strokeWidth={1.8}
            />
          ) : null}
        </button>
        <span className="w-[72px] flex-shrink-0 text-[12px] text-text-muted tabular-nums">
          {timeLabel}
        </span>
        <button
          type="button"
          className="flex-1 min-w-0 border-0 bg-transparent p-0 text-left cursor-pointer"
          onClick={() => onTodoSelect?.(todo)}
        >
          <span
            className="block text-[13px] text-text-primary truncate"
            style={{
              textDecoration: completed ? "line-through" : "none",
              opacity: completed ? 0.6 : 1,
            }}
          >
            {todo.title || "(Untitled)"}
          </span>
          <span className="block text-[11.5px] text-text-muted truncate">
            {kindLabel}
            {todo.estimatedMinutes ? ` / ${todo.estimatedMinutes}m` : ""}
          </span>
          {todo.notes ? (
            <span className="block text-[11.5px] text-text-muted truncate">
              {todo.notes}
            </span>
          ) : null}
        </button>
      </div>
    </li>
  );
}

function formatDayHeader(key: string, timeZone: string): string {
  const date = zonedDateFromDayKey(key, timeZone);
  const today = startOfDay(new Date(), timeZone);
  const tomorrow = zonedDateFromDayKey(
    zonedDayKey(new Date(today.getTime() + 36 * 60 * 60 * 1000), timeZone),
    timeZone,
  );
  const prefix = isSameDay(date, today, timeZone)
    ? "Today · "
    : isSameDay(date, tomorrow, timeZone)
      ? "Tomorrow · "
      : "";
  return (
    prefix +
    formatInTimeZone(date, timeZone, {
      weekday: "short",
      month: "short",
      day: "numeric",
    })
  );
}

function formatTime(iso: string, timeZone = DEFAULT_CALENDAR_TIME_ZONE): string {
  return formatInTimeZone(iso, timeZone, {
    hour: "numeric",
    minute: "2-digit",
  });
}
