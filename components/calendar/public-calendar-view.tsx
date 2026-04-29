"use client";

import { useMemo, type CSSProperties } from "react";

import type { PublicCalendarData, PublicCalendarEvent } from "@/lib/shared/public-calendar";

export type PublicCalendarViewMode = "month" | "week" | "day" | "agenda";

const VIEW_LABELS: Array<{ value: PublicCalendarViewMode; label: string }> = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
  { value: "agenda", label: "Agenda" },
];

type DecoratedEvent = PublicCalendarEvent & {
  startTimestamp: number;
  endTimestamp: number;
  startDayKey: string;
  formattedTime: string;
  touchedDayKeys: string[];
};

type DayIndex = Map<string, DecoratedEvent[]>;

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

function decorateEvent(event: PublicCalendarEvent): DecoratedEvent {
  const startTimestamp = Date.parse(event.startsAt);
  const endTimestamp = Date.parse(event.endsAt);
  const startDate = new Date(startTimestamp);
  const endDate = new Date(endTimestamp);
  const startDayKey = keyForDate(startDate);

  // Walk the calendar days the event covers, matching the original
  // eventTouchesDay rule: a day is included when end > dayStart && start < dayEnd.
  // Using setDate (via addDays) handles DST transitions correctly.
  const touchedDayKeys: string[] = [];
  let cursor = startOfDay(startDate);
  while (cursor.getTime() < endTimestamp) {
    touchedDayKeys.push(keyForDate(cursor));
    cursor = addDays(cursor, 1);
  }
  if (touchedDayKeys.length === 0) {
    // Defensive: if endTimestamp <= startTimestamp slipped past normalize,
    // still surface the event on its start day rather than dropping it.
    touchedDayKeys.push(startDayKey);
  }

  let formattedTime: string;
  if (event.isAllDay) {
    formattedTime = "All day";
  } else {
    const startLabel = startDate.toLocaleTimeString("en", {
      hour: "numeric",
      minute: "2-digit",
    });
    const endLabel = endDate.toLocaleTimeString("en", {
      hour: "numeric",
      minute: "2-digit",
    });
    const sameDay = startDayKey === keyForDate(endDate);
    formattedTime = sameDay
      ? `${startLabel} - ${endLabel}`
      : `${startLabel} - ${endDate.toLocaleDateString("en", {
          month: "short",
          day: "numeric",
        })}, ${endLabel}`;
  }

  return {
    ...event,
    startTimestamp,
    endTimestamp,
    startDayKey,
    formattedTime,
    touchedDayKeys,
  };
}

function buildDayIndex(events: DecoratedEvent[]): DayIndex {
  const index: DayIndex = new Map();
  for (const event of events) {
    for (const key of event.touchedDayKeys) {
      const bucket = index.get(key);
      if (bucket) {
        bucket.push(event);
      } else {
        index.set(key, [event]);
      }
    }
  }
  for (const bucket of index.values()) {
    bucket.sort((a, b) => a.startTimestamp - b.startTimestamp);
  }
  return index;
}

function eventsForDayKey(index: DayIndex, key: string): DecoratedEvent[] {
  return index.get(key) ?? [];
}

function eventsForDay(index: DayIndex, day: Date): DecoratedEvent[] {
  return eventsForDayKey(index, keyForDate(day));
}

function buildAgendaGroups(
  events: DecoratedEvent[],
  index: DayIndex,
  windowDays: number,
): Array<[string, DecoratedEvent[]]> {
  const startMs = startOfDay(new Date()).getTime();
  const endMs = addDays(new Date(), windowDays).getTime();
  // Group by start-day so each event appears once even when multi-day.
  const buckets = new Map<string, DecoratedEvent[]>();
  for (const event of events) {
    if (event.endTimestamp < startMs || event.startTimestamp > endMs) continue;
    const bucket = buckets.get(event.startDayKey);
    if (bucket) {
      bucket.push(event);
    } else {
      buckets.set(event.startDayKey, [event]);
    }
  }
  // Reuse the index's sort: each bucket already references events in
  // index ordering, but to guarantee stable order we re-sort by start.
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => a.startTimestamp - b.startTimestamp);
  }
  // Suppress unused-parameter lint without changing the call site contract.
  void index;
  return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function PublicCalendarView({
  data,
  view = "agenda",
  anchorIso,
  agendaDays = 30,
  onViewChange,
  onAnchorChange,
  onAgendaDaysChange,
  onDaySelect,
  expandedEventId,
  onEventToggle,
}: {
  data: PublicCalendarData;
  view?: PublicCalendarViewMode;
  anchorIso?: string;
  agendaDays?: 30 | 90;
  onViewChange?: (view: PublicCalendarViewMode) => void;
  onAnchorChange?: (date: Date) => void;
  onAgendaDaysChange?: (days: 30 | 90) => void;
  onDaySelect?: (date: Date) => void;
  expandedEventId?: string | null;
  onEventToggle?: (id: string) => void;
}) {
  const anchor = Number.isFinite(Date.parse(anchorIso ?? ""))
    ? new Date(anchorIso ?? "")
    : new Date();

  // Decorate each event once: parse timestamps, compute day keys + formatted
  // time. Without this, MonthView would Date-parse every event 42 times per
  // render.
  const decoratedEvents = useMemo(
    () =>
      [...data.events]
        .map(decorateEvent)
        .sort((a, b) => a.startTimestamp - b.startTimestamp),
    [data.events],
  );

  // Index events by the day-keys they touch, so MonthView/WeekView/DayView
  // get O(1) per-day lookups instead of O(n) filters.
  const dayIndex = useMemo(() => buildDayIndex(decoratedEvents), [decoratedEvents]);

  const agendaGroups = useMemo(
    () => buildAgendaGroups(decoratedEvents, dayIndex, agendaDays),
    [decoratedEvents, dayIndex, agendaDays],
  );

  const lastUpdatedLabel = useMemo(
    () =>
      new Date(data.generatedAt).toLocaleString("en", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    [data.generatedAt],
  );

  const resolvedTimeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );

  if (decoratedEvents.length === 0) {
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
        {view === "agenda" ? (
          <div className="public-calendar__view-switch" aria-label="Agenda range">
            {([30, 90] as const).map((days) => (
              <button
                key={days}
                type="button"
                className="public-calendar__view-button"
                data-active={agendaDays === days ? "true" : "false"}
                onClick={() => onAgendaDaysChange?.(days)}
              >
                {days} days
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <p className="public-calendar__sync-note">
        Last updated {lastUpdatedLabel}. Times shown in {resolvedTimeZone}.
      </p>
      {view === "month" ? (
        <MonthCalendar
          dayIndex={dayIndex}
          anchor={anchor}
          onDaySelect={onDaySelect}
          onEventToggle={onEventToggle}
        />
      ) : null}
      {view === "week" ? (
        <WeekCalendar
          dayIndex={dayIndex}
          anchor={anchor}
          expandedEventId={expandedEventId}
          onEventToggle={onEventToggle}
        />
      ) : null}
      {view === "day" ? (
        <DayCalendar
          dayIndex={dayIndex}
          anchor={anchor}
          expandedEventId={expandedEventId}
          onEventToggle={onEventToggle}
        />
      ) : null}
      {view === "agenda" ? (
        <AgendaCalendar
          groups={agendaGroups}
          expandedEventId={expandedEventId}
          onEventToggle={onEventToggle}
        />
      ) : null}
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
  dayIndex,
  anchor,
  onDaySelect,
  onEventToggle,
}: {
  dayIndex: DayIndex;
  anchor: Date;
  onDaySelect?: (date: Date) => void;
  onEventToggle?: (id: string) => void;
}) {
  const days = useMemo(() => monthGridDays(anchor), [anchor]);
  const todayKey = keyForDate(new Date());
  return (
    <div className="public-calendar__month">
      <WeekdayLabels />
      <div className="public-calendar__month-grid">
        {days.map((day) => {
          const key = keyForDate(day);
          const dayEvents = eventsForDayKey(dayIndex, key);
          const inMonth = day.getMonth() === anchor.getMonth();
          return (
            <section
              className="public-calendar__month-cell"
              data-muted={inMonth ? "false" : "true"}
              key={key}
              onClick={() => onDaySelect?.(day)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                onDaySelect?.(day);
              }}
              role="button"
              tabIndex={0}
            >
              <span
                className="public-calendar__date-number"
                data-today={key === todayKey ? "true" : "false"}
              >
                {day.getDate()}
              </span>
              <div className="public-calendar__month-events">
                {dayEvents.slice(0, 3).map((event) => (
                  <EventPill
                    event={event}
                    key={`${event.id}-${event.startTimestamp}`}
                    onEventToggle={onEventToggle}
                  />
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
  dayIndex,
  anchor,
  expandedEventId,
  onEventToggle,
}: {
  dayIndex: DayIndex;
  anchor: Date;
  expandedEventId?: string | null;
  onEventToggle?: (id: string) => void;
}) {
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i)),
    [anchor],
  );
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
              {eventsForDay(dayIndex, day).map((event) => (
                <EventCard
                  event={event}
                  key={`${event.id}-${event.startTimestamp}`}
                  compact
                  expanded={expandedEventId === event.id}
                  onEventToggle={onEventToggle}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function DayCalendar({
  dayIndex,
  anchor,
  expandedEventId,
  onEventToggle,
}: {
  dayIndex: DayIndex;
  anchor: Date;
  expandedEventId?: string | null;
  onEventToggle?: (id: string) => void;
}) {
  const dayEvents = eventsForDay(dayIndex, anchor);
  return (
    <div className="public-calendar__day-list">
      {dayEvents.length > 0 ? (
        dayEvents.map((event) => (
          <EventCard
            event={event}
            key={`${event.id}-${event.startTimestamp}`}
            expanded={expandedEventId === event.id}
            onEventToggle={onEventToggle}
          />
        ))
      ) : (
        <p className="public-calendar__empty-day">No public events for this day.</p>
      )}
    </div>
  );
}

function AgendaCalendar({
  groups,
  expandedEventId,
  onEventToggle,
}: {
  groups: Array<[string, DecoratedEvent[]]>;
  expandedEventId?: string | null;
  onEventToggle?: (id: string) => void;
}) {
  return (
    <div className="public-calendar__agenda">
      {groups.map(([day, dayEvents]) => (
        <section className="public-calendar__day" key={day}>
          <h2 className="public-calendar__day-title">{formatDay(day)}</h2>
          <ol className="public-calendar__events">
            {dayEvents.map((event) => (
              <li
                className="public-calendar__event"
                key={`${event.id}-${event.startTimestamp}`}
              >
                <EventCard
                  event={event}
                  expanded={expandedEventId === event.id}
                  onEventToggle={onEventToggle}
                />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function EventPill({
  event,
  onEventToggle,
}: {
  event: DecoratedEvent;
  onEventToggle?: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className="public-calendar__event-pill"
      title={`${event.formattedTime} ${event.title}`}
      onClick={(e) => {
        e.stopPropagation();
        onEventToggle?.(event.id);
      }}
      style={{ "--calendar-color": event.colorHex ?? "#9b9a97" } as CSSProperties}
    >
      <span>{event.isAllDay ? "" : event.formattedTime}</span>
      {event.title}
    </button>
  );
}

function EventCard({
  event,
  compact = false,
  expanded = false,
  onEventToggle,
}: {
  event: DecoratedEvent;
  compact?: boolean;
  expanded?: boolean;
  onEventToggle?: (id: string) => void;
}) {
  return (
    <div
      className="public-calendar__event-card"
      data-compact={compact ? "true" : "false"}
    >
      <span
        className="public-calendar__event-color"
        style={{ background: event.colorHex ?? "#9b9a97" }}
        aria-hidden="true"
      />
      <div className="public-calendar__event-main">
        <button
          type="button"
          className="public-calendar__event-toggle"
          onClick={() => onEventToggle?.(event.id)}
        >
          <div className="public-calendar__event-topline">
            <span className="public-calendar__event-time">{event.formattedTime}</span>
            <strong className="public-calendar__event-title">{event.title}</strong>
          </div>
        </button>
        {expanded && event.visibility === "busy" ? (
          <p className="public-calendar__event-description">
            Details are hidden for this blocked time.
          </p>
        ) : null}
        {expanded && event.visibility === "full" && event.location ? (
          <p className="public-calendar__event-meta">{event.location}</p>
        ) : null}
        {expanded && event.visibility === "full" && event.description ? (
          <p className="public-calendar__event-description">{event.description}</p>
        ) : null}
        {expanded && event.visibility === "full" && event.url ? (
          <p className="public-calendar__event-link">
            <a href={event.url}>Event link</a>
          </p>
        ) : null}
      </div>
    </div>
  );
}
