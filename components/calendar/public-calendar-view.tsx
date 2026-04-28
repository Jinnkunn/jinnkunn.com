import type { CSSProperties } from "react";

import type { PublicCalendarData, PublicCalendarEvent } from "@/lib/shared/public-calendar";

export type PublicCalendarViewMode = "month" | "week" | "day" | "agenda";

const VIEW_LABELS: Array<{ value: PublicCalendarViewMode; label: string }> = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
  { value: "agenda", label: "Agenda" },
];

function dayKey(iso: string): string {
  const date = new Date(iso);
  return keyForDate(date);
}

function keyForDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDayKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfDay(date: Date): Date {
  const out = new Date(date);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(date: Date, days: number): Date {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  return out;
}

function startOfWeek(date: Date): Date {
  const out = startOfDay(date);
  const day = out.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addDays(out, mondayOffset);
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthGridDays(anchor: Date): Date[] {
  const first = startOfMonth(anchor);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

function formatDay(key: string): string {
  return parseDayKey(key).toLocaleDateString("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatToolbarTitle(view: PublicCalendarViewMode, anchor: Date): string {
  if (view === "day") {
    return anchor.toLocaleDateString("en", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }
  if (view === "week") {
    const start = startOfWeek(anchor);
    const end = addDays(start, 6);
    return `${start.toLocaleDateString("en", {
      month: "short",
      day: "numeric",
    })} - ${end.toLocaleDateString("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;
  }
  return anchor.toLocaleDateString("en", { month: "long", year: "numeric" });
}

function shiftAnchor(
  anchor: Date,
  view: PublicCalendarViewMode,
  direction: -1 | 1,
): Date {
  const out = new Date(anchor);
  if (view === "month" || view === "agenda") {
    out.setMonth(out.getMonth() + direction);
  } else if (view === "week") {
    out.setDate(out.getDate() + direction * 7);
  } else {
    out.setDate(out.getDate() + direction);
  }
  return out;
}

function formatTime(event: PublicCalendarEvent): string {
  if (event.isAllDay) return "All day";
  const starts = new Date(event.startsAt);
  const ends = new Date(event.endsAt);
  const sameDay = dayKey(event.startsAt) === dayKey(event.endsAt);
  const startLabel = starts.toLocaleTimeString("en", {
    hour: "numeric",
    minute: "2-digit",
  });
  const endLabel = ends.toLocaleTimeString("en", {
    hour: "numeric",
    minute: "2-digit",
  });
  if (sameDay) return `${startLabel} - ${endLabel}`;
  return `${startLabel} - ${ends.toLocaleDateString("en", {
    month: "short",
    day: "numeric",
  })}, ${endLabel}`;
}

function eventTouchesDay(event: PublicCalendarEvent, day: Date): boolean {
  const start = new Date(event.startsAt).getTime();
  const end = new Date(event.endsAt).getTime();
  const dayStart = startOfDay(day).getTime();
  const dayEnd = addDays(startOfDay(day), 1).getTime();
  return end > dayStart && start < dayEnd;
}

function eventsForDay(events: PublicCalendarEvent[], day: Date) {
  return events
    .filter((event) => eventTouchesDay(event, day))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

function groupEvents(events: PublicCalendarEvent[]): Array<[string, PublicCalendarEvent[]]> {
  const map = new Map<string, PublicCalendarEvent[]>();
  for (const event of events) {
    const key = dayKey(event.startsAt);
    const bucket = map.get(key) ?? [];
    bucket.push(event);
    map.set(key, bucket);
  }
  for (const bucket of map.values()) {
    bucket.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function PublicCalendarView({
  data,
  view = "agenda",
  anchorIso,
  onViewChange,
  onAnchorChange,
}: {
  data: PublicCalendarData;
  view?: PublicCalendarViewMode;
  anchorIso?: string;
  onViewChange?: (view: PublicCalendarViewMode) => void;
  onAnchorChange?: (date: Date) => void;
}) {
  const anchor = Number.isFinite(Date.parse(anchorIso ?? ""))
    ? new Date(anchorIso ?? "")
    : new Date();
  const sortedEvents = [...data.events].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  );

  if (sortedEvents.length === 0) {
    return (
      <div className="public-calendar public-calendar--empty notion-text notion-text__content">
        <p>No public calendar events are currently listed.</p>
      </div>
    );
  }

  return (
    <div className="public-calendar">
      <div className="public-calendar__toolbar">
        <div className="public-calendar__nav">
          <button
            type="button"
            className="public-calendar__nav-button"
            onClick={() => onAnchorChange?.(shiftAnchor(anchor, view, -1))}
            aria-label="Previous calendar range"
          >
            ‹
          </button>
          <button
            type="button"
            className="public-calendar__today-button"
            onClick={() => onAnchorChange?.(new Date())}
          >
            Today
          </button>
          <button
            type="button"
            className="public-calendar__nav-button"
            onClick={() => onAnchorChange?.(shiftAnchor(anchor, view, 1))}
            aria-label="Next calendar range"
          >
            ›
          </button>
          <strong className="public-calendar__range-title">
            {formatToolbarTitle(view, anchor)}
          </strong>
        </div>
        <div className="public-calendar__view-switch" aria-label="Calendar view">
          {VIEW_LABELS.map((item) => (
            <button
              key={item.value}
              type="button"
              className="public-calendar__view-button"
              data-active={view === item.value ? "true" : "false"}
              onClick={() => onViewChange?.(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {view === "month" ? (
        <MonthCalendar events={sortedEvents} anchor={anchor} />
      ) : null}
      {view === "week" ? (
        <WeekCalendar events={sortedEvents} anchor={anchor} />
      ) : null}
      {view === "day" ? <DayCalendar events={sortedEvents} anchor={anchor} /> : null}
      {view === "agenda" ? <AgendaCalendar events={sortedEvents} /> : null}
    </div>
  );
}

function WeekdayLabels() {
  const monday = new Date(2024, 0, 1);
  return (
    <div className="public-calendar__weekdays">
      {Array.from({ length: 7 }, (_, i) => {
        const day = addDays(monday, i);
        return (
          <span key={day.toISOString()}>
            {day.toLocaleDateString("en", { weekday: "short" })}
          </span>
        );
      })}
    </div>
  );
}

function MonthCalendar({
  events,
  anchor,
}: {
  events: PublicCalendarEvent[];
  anchor: Date;
}) {
  const days = monthGridDays(anchor);
  const todayKey = keyForDate(new Date());
  return (
    <div className="public-calendar__month">
      <WeekdayLabels />
      <div className="public-calendar__month-grid">
        {days.map((day) => {
          const key = keyForDate(day);
          const dayEvents = eventsForDay(events, day);
          const inMonth = day.getMonth() === anchor.getMonth();
          return (
            <section
              className="public-calendar__month-cell"
              data-muted={inMonth ? "false" : "true"}
              key={key}
            >
              <span
                className="public-calendar__date-number"
                data-today={key === todayKey ? "true" : "false"}
              >
                {day.getDate()}
              </span>
              <div className="public-calendar__month-events">
                {dayEvents.slice(0, 3).map((event) => (
                  <EventPill event={event} key={`${event.id}-${event.startsAt}`} />
                ))}
                {dayEvents.length > 3 ? (
                  <span className="public-calendar__more">
                    +{dayEvents.length - 3} more
                  </span>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function WeekCalendar({
  events,
  anchor,
}: {
  events: PublicCalendarEvent[];
  anchor: Date;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i));
  return (
    <div className="public-calendar__week">
      <WeekdayLabels />
      <div className="public-calendar__week-grid">
        {days.map((day) => (
          <section className="public-calendar__week-day" key={day.toISOString()}>
            <div className="public-calendar__week-date">
              <span>{day.getDate()}</span>
            </div>
            <div className="public-calendar__week-events">
              {eventsForDay(events, day).map((event) => (
                <EventCard event={event} key={`${event.id}-${event.startsAt}`} compact />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function DayCalendar({
  events,
  anchor,
}: {
  events: PublicCalendarEvent[];
  anchor: Date;
}) {
  const dayEvents = eventsForDay(events, anchor);
  return (
    <div className="public-calendar__day-list">
      {dayEvents.length > 0 ? (
        dayEvents.map((event) => (
          <EventCard event={event} key={`${event.id}-${event.startsAt}`} />
        ))
      ) : (
        <p className="public-calendar__empty-day">No public events for this day.</p>
      )}
    </div>
  );
}

function AgendaCalendar({ events }: { events: PublicCalendarEvent[] }) {
  const groups = groupEvents(events);
  return (
    <div className="public-calendar__agenda">
      {groups.map(([day, dayEvents]) => (
        <section className="public-calendar__day" key={day}>
          <h2 className="public-calendar__day-title">{formatDay(day)}</h2>
          <ol className="public-calendar__events">
            {dayEvents.map((event) => (
              <li className="public-calendar__event" key={`${event.id}-${event.startsAt}`}>
                <EventCard event={event} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function EventPill({ event }: { event: PublicCalendarEvent }) {
  return (
    <span
      className="public-calendar__event-pill"
      title={`${formatTime(event)} ${event.title}`}
      style={{ "--calendar-color": event.colorHex ?? "#9b9a97" } as CSSProperties}
    >
      <span>{event.isAllDay ? "" : formatTime(event)}</span>
      {event.title}
    </span>
  );
}

function EventCard({
  event,
  compact = false,
}: {
  event: PublicCalendarEvent;
  compact?: boolean;
}) {
  return (
    <div className="public-calendar__event-card" data-compact={compact ? "true" : "false"}>
      <span
        className="public-calendar__event-color"
        style={{ background: event.colorHex ?? "#9b9a97" }}
        aria-hidden="true"
      />
      <div className="public-calendar__event-main">
        <div className="public-calendar__event-topline">
          <span className="public-calendar__event-time">{formatTime(event)}</span>
          <strong className="public-calendar__event-title">{event.title}</strong>
        </div>
        {event.visibility === "full" && event.location ? (
          <p className="public-calendar__event-meta">{event.location}</p>
        ) : null}
        {event.visibility === "full" && event.description ? (
          <p className="public-calendar__event-description">{event.description}</p>
        ) : null}
        {event.visibility === "full" && event.url ? (
          <p className="public-calendar__event-link">
            <a href={event.url}>Event link</a>
          </p>
        ) : null}
      </div>
    </div>
  );
}
