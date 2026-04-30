import { useMemo } from "react";

import { isSameDay, startOfDay } from "./dateRange";
import { DisclosureBadge } from "./DisclosureBadge";
import type { Calendar, CalendarEvent, EventDisclosureResolver } from "./types";
import type { TodoRow } from "../../modules/todos/api";

type AgendaTodoEntry =
  | { kind: "event"; event: CalendarEvent; sortKey: string }
  | { kind: "todo"; todo: TodoRow; sortKey: string };

/** Flat list of events grouped by local day. Used as the "Agenda"
 * tab — same data the time-grid views render, just in a denser linear
 * layout that's easier to scan when you only care about "what's next".
 * Todos with a `dueAt` get folded into the same per-day buckets so the
 * agenda also reads as "everything due today" rather than just events. */
export function AgendaView({
  events,
  calendarsById,
  todos = [],
  rangeLabel,
  getDisclosure,
  onEventSelect,
  onTodoToggle,
}: {
  events: CalendarEvent[];
  calendarsById: Map<string, Calendar>;
  todos?: TodoRow[];
  /** Human-readable summary shown in the empty state, e.g. "this week". */
  rangeLabel: string;
  getDisclosure?: EventDisclosureResolver;
  onEventSelect?: (event: CalendarEvent) => void;
  onTodoToggle?: (id: string, completed: boolean) => void;
}) {
  const entriesByDay = useMemo(() => {
    const map = new Map<string, AgendaTodoEntry[]>();
    for (const e of events) {
      const key = localDayKey(e.startsAt);
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
      if (todo.dueAt === null) continue;
      const dueIso = new Date(todo.dueAt).toISOString();
      const key = localDayKey(dueIso);
      const arr = map.get(key) ?? [];
      arr.push({ kind: "todo", todo, sortKey: `1:${dueIso}` });
      map.set(key, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [events, todos]);

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
            {formatDayHeader(day)}
          </h3>
          <ul className="m-0 p-0 list-none flex flex-col gap-1">
            {entries.map((entry) =>
              entry.kind === "event"
                ? renderEventEntry(
                    entry.event,
                    calendarsById,
                    getDisclosure,
                    onEventSelect,
                  )
                : renderTodoEntry(entry.todo, onTodoToggle),
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
          {ev.isAllDay ? "All day" : formatTime(ev.startsAt)}
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
  onTodoToggle: ((id: string, completed: boolean) => void) | undefined,
) {
  const completed = todo.completedAt !== null;
  const dueLabel = todo.dueAt
    ? formatTime(new Date(todo.dueAt).toISOString())
    : "—";
  return (
    <li key={`todo-${todo.id}`}>
      <button
        type="button"
        className="w-full flex items-start gap-3 px-2 py-1.5 rounded hover:bg-bg-surface-alt border-0 bg-transparent text-left cursor-pointer"
        data-completed={completed ? "true" : undefined}
        onClick={() => onTodoToggle?.(todo.id, !completed)}
      >
        <span
          aria-hidden="true"
          className="mt-1 inline-flex items-center justify-center flex-shrink-0 rounded-full"
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
        </span>
        <span className="w-[72px] flex-shrink-0 text-[12px] text-text-muted tabular-nums">
          {dueLabel}
        </span>
        <span className="flex-1 min-w-0">
          <span
            className="block text-[13px] text-text-primary truncate"
            style={{
              textDecoration: completed ? "line-through" : "none",
              opacity: completed ? 0.6 : 1,
            }}
          >
            {todo.title || "(Untitled)"}
          </span>
          {todo.notes ? (
            <span className="block text-[11.5px] text-text-muted truncate">
              {todo.notes}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

/** Local-time YYYY-MM-DD key used to bucket events by display day. We
 * can't slice the ISO string — that would group by UTC date and split
 * evenings into "tomorrow" for users east of GMT. */
function localDayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDayHeader(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = startOfDay(new Date());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const prefix = isSameDay(date, today)
    ? "Today · "
    : isSameDay(date, tomorrow)
      ? "Tomorrow · "
      : "";
  return (
    prefix +
    date.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    })
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
