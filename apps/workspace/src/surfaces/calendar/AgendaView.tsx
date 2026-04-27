import { useMemo } from "react";

import { isSameDay, startOfDay } from "./dateRange";
import type { Calendar, CalendarEvent } from "./types";

/** Flat list of events grouped by local day. Used as the "Agenda"
 * tab — same data the time-grid views render, just in a denser linear
 * layout that's easier to scan when you only care about "what's next". */
export function AgendaView({
  events,
  calendarsById,
  rangeLabel,
}: {
  events: CalendarEvent[];
  calendarsById: Map<string, Calendar>;
  /** Human-readable summary shown in the empty state, e.g. "this week". */
  rangeLabel: string;
}) {
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const key = localDayKey(e.startsAt);
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
        return a.startsAt.localeCompare(b.startsAt);
      });
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [events]);

  if (eventsByDay.length === 0) {
    return (
      <div className="text-[12.5px] text-text-muted px-1">
        No events for {rangeLabel}.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-1">
      {eventsByDay.map(([day, dayEvents]) => (
        <section key={day}>
          <h3 className="m-0 mb-1.5 text-[11px] uppercase tracking-[0.06em] font-semibold text-text-muted">
            {formatDayHeader(day)}
          </h3>
          <ul className="m-0 p-0 list-none flex flex-col gap-1">
            {dayEvents.map((ev) => {
              const cal = calendarsById.get(ev.calendarId);
              const color = cal?.colorHex ?? "#888888";
              return (
                <li
                  key={ev.eventIdentifier}
                  className="flex items-start gap-3 px-2 py-1.5 rounded hover:bg-bg-surface-alt"
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
                    {ev.location ? (
                      <span className="block text-[11.5px] text-text-muted truncate">
                        {ev.location}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
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
