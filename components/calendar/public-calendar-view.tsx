"use client";

import { useMemo, type CSSProperties, type MouseEvent } from "react";

import {
  eventMatchesAnyTag,
  summarizeTags,
} from "@/lib/shared/calendar-tags";
import {
  CALENDAR_TIME_ZONE_OPTIONS,
  DEFAULT_CALENDAR_TIME_ZONE,
  addZonedDays,
  addZonedMonths,
  calendarTimeZoneLabel,
  formatInTimeZone,
  isSameZonedMonth,
  zonedDateFromDayKey,
  zonedDayKey,
  zonedStartOfDay,
  zonedStartOfMonth,
  zonedStartOfWeek,
} from "@/lib/shared/calendar-timezone";
import type { PublicCalendarData, PublicCalendarEvent } from "@/lib/shared/public-calendar";

export type PublicCalendarViewMode = "month" | "week" | "day" | "agenda";

export type PublicCalendarEventAnchor = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
};

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

type EventToggleHandler = (
  id: string,
  anchor?: PublicCalendarEventAnchor | null,
) => void;

type DetailPlacement = "left" | "right" | "bottom" | "center";

const DETAIL_POPOVER_WIDTH = 324;
const DETAIL_POPOVER_ESTIMATED_HEIGHT = 220;
const DETAIL_POPOVER_MARGIN = 14;

function clampNumber(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function anchorFromClick(
  event: MouseEvent<HTMLElement>,
): PublicCalendarEventAnchor {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  };
}

function detailGeometryForAnchor(anchor?: PublicCalendarEventAnchor | null): {
  placement: DetailPlacement;
  style: CSSProperties;
} {
  if (!anchor) {
    return {
      placement: "center",
      style: {
        "--detail-popover-left": `calc(100vw - ${DETAIL_POPOVER_WIDTH + 24}px)`,
        "--detail-popover-top": "104px",
        "--detail-arrow-y": "28px",
      } as CSSProperties,
    };
  }

  if (anchor.viewportWidth <= 720) {
    return {
      placement: "bottom",
      style: {
        "--detail-popover-left": "10px",
        "--detail-popover-top": "auto",
        "--detail-arrow-y": "24px",
      } as CSSProperties,
    };
  }

  const maxLeft =
    anchor.viewportWidth - DETAIL_POPOVER_WIDTH - DETAIL_POPOVER_MARGIN;
  const top = clampNumber(
    anchor.top - 18,
    86,
    anchor.viewportHeight -
      DETAIL_POPOVER_ESTIMATED_HEIGHT -
      DETAIL_POPOVER_MARGIN,
  );
  const rightSpace = anchor.viewportWidth - anchor.right - DETAIL_POPOVER_MARGIN;
  const leftSpace = anchor.left - DETAIL_POPOVER_MARGIN;
  const placeRight =
    rightSpace >= DETAIL_POPOVER_WIDTH + 12 || rightSpace >= leftSpace;
  const rawLeft = placeRight
    ? anchor.right + 12
    : anchor.left - DETAIL_POPOVER_WIDTH - 12;
  const left = clampNumber(rawLeft, DETAIL_POPOVER_MARGIN, maxLeft);
  const arrowY = clampNumber(anchor.top + anchor.height / 2 - top, 20, 178);

  return {
    placement: placeRight ? "right" : "left",
    style: {
      "--detail-popover-left": `${left}px`,
      "--detail-popover-top": `${top}px`,
      "--detail-arrow-y": `${arrowY}px`,
    } as CSSProperties,
  };
}

function keyForDate(
  date: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): string {
  return zonedDayKey(date, timeZone);
}

function parseDayKey(
  key: string,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date {
  return zonedDateFromDayKey(key, timeZone);
}

function startOfDay(
  date: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date {
  return zonedStartOfDay(date, timeZone);
}

function addDays(
  date: Date,
  days: number,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date {
  return addZonedDays(date, days, timeZone);
}

function startOfWeek(
  date: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date {
  return zonedStartOfWeek(date, timeZone);
}

function startOfMonth(
  date: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date {
  return zonedStartOfMonth(date, timeZone);
}

function monthGridDays(
  anchor: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date[] {
  const first = startOfMonth(anchor, timeZone);
  const start = startOfWeek(first, timeZone);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i, timeZone));
}

function formatDay(key: string, timeZone = DEFAULT_CALENDAR_TIME_ZONE): string {
  return formatInTimeZone(parseDayKey(key, timeZone), timeZone, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatToolbarTitle(
  view: PublicCalendarViewMode,
  anchor: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): string {
  if (view === "day") {
    return formatInTimeZone(anchor, timeZone, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }
  if (view === "week") {
    const start = startOfWeek(anchor, timeZone);
    const end = addDays(start, 6, timeZone);
    return `${formatInTimeZone(start, timeZone, {
      month: "short",
      day: "numeric",
    })} - ${formatInTimeZone(end, timeZone, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;
  }
  return formatInTimeZone(anchor, timeZone, { month: "long", year: "numeric" });
}

function shiftAnchor(
  anchor: Date,
  view: PublicCalendarViewMode,
  direction: -1 | 1,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Date {
  if (view === "month" || view === "agenda") {
    return addZonedMonths(anchor, direction, timeZone);
  }
  if (view === "week") return addDays(anchor, direction * 7, timeZone);
  return addDays(anchor, direction, timeZone);
}

function decorateEvent(
  event: PublicCalendarEvent,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): DecoratedEvent {
  const startTimestamp = Date.parse(event.startsAt);
  const endTimestamp = Date.parse(event.endsAt);
  const startDate = new Date(startTimestamp);
  const endDate = new Date(endTimestamp);
  const startDayKey = keyForDate(startDate, timeZone);

  // Walk the calendar days the event covers, matching the original
  // eventTouchesDay rule: a day is included when end > dayStart && start < dayEnd.
  // Using setDate (via addDays) handles DST transitions correctly.
  const touchedDayKeys: string[] = [];
  let cursor = startOfDay(startDate, timeZone);
  while (cursor.getTime() < endTimestamp) {
    touchedDayKeys.push(keyForDate(cursor, timeZone));
    cursor = addDays(cursor, 1, timeZone);
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
    const startLabel = formatInTimeZone(startDate, timeZone, {
      hour: "numeric",
      minute: "2-digit",
    });
    const endLabel = formatInTimeZone(endDate, timeZone, {
      hour: "numeric",
      minute: "2-digit",
    });
    const sameDay = startDayKey === keyForDate(endDate, timeZone);
    formattedTime = sameDay
      ? `${startLabel} - ${endLabel}`
      : `${startLabel} - ${formatInTimeZone(endDate, timeZone, {
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

function eventsForDay(
  index: DayIndex,
  day: Date,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): DecoratedEvent[] {
  return eventsForDayKey(index, keyForDate(day, timeZone));
}

function buildAgendaGroups(
  events: DecoratedEvent[],
  index: DayIndex,
  windowDays: number,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Array<[string, DecoratedEvent[]]> {
  const agendaStart = startOfDay(new Date(), timeZone);
  const startMs = agendaStart.getTime();
  const endMs = addDays(agendaStart, windowDays, timeZone).getTime();
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
  selectedEventAnchor,
  onEventToggle,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
  onTimeZoneChange,
  selectedTags,
  onSelectedTagsChange,
  tagSummary: tagSummaryProp,
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
  selectedEventAnchor?: PublicCalendarEventAnchor | null;
  onEventToggle?: EventToggleHandler;
  timeZone?: string;
  onTimeZoneChange?: (timeZone: string) => void;
  /** Currently-active tag filter. Empty = show every event. The
   * filter is OR-logic: an event matching any selected tag passes. */
  selectedTags?: readonly string[];
  /** Toggle handler for chip clicks. Receives the next selection set
   * (the view doesn't own filter state — the route does, so the URL
   * `?tag=foo` round-trips). */
  onSelectedTagsChange?: (next: string[]) => void;
  /** Optional pre-computed tag summary. The client wrapper hoists
   * this so it's only rebuilt when `data.events` changes, not on
   * every internal view re-render (anchor change, view switch, etc.). */
  tagSummary?: ReadonlyArray<{ tag: string; count: number }>;
}) {
  const anchor = Number.isFinite(Date.parse(anchorIso ?? ""))
    ? new Date(anchorIso ?? "")
    : new Date();

  // Tag filter — applied BEFORE decoration so the day index, agenda
  // groups, and per-view event lists all share the same filtered set.
  // The Set is rebuilt every render but `selectedTags` is typically
  // ≤5 chips and the membership test is the hot path inside
  // eventMatchesAnyTag. Memoizing the Set itself isn't worth it.
  const selectedTagSet = useMemo(
    () => new Set(selectedTags ?? []),
    [selectedTags],
  );
  const filteredEvents = useMemo(
    () =>
      selectedTagSet.size === 0
        ? data.events
        : data.events.filter((event) => eventMatchesAnyTag(event, selectedTagSet)),
    [data.events, selectedTagSet],
  );
  // Prefer the parent-supplied summary (the client wrapper computes
  // it once per data change). Fall back to recomputing locally for
  // callers that don't pass it — keeps the component standalone-safe.
  const tagSummary = useMemo(
    () => tagSummaryProp ?? summarizeTags(data.events),
    [tagSummaryProp, data.events],
  );

  // Decorate each event once: parse timestamps, compute day keys + formatted
  // time. Without this, MonthView would Date-parse every event 42 times per
  // render.
  const decoratedEvents = useMemo(
    () =>
      [...filteredEvents]
        .map((event) => decorateEvent(event, timeZone))
        .sort((a, b) => a.startTimestamp - b.startTimestamp),
    [filteredEvents, timeZone],
  );

  // Index events by the day-keys they touch, so MonthView/WeekView/DayView
  // get O(1) per-day lookups instead of O(n) filters.
  const dayIndex = useMemo(() => buildDayIndex(decoratedEvents), [decoratedEvents]);

  const agendaGroups = useMemo(
    () => buildAgendaGroups(decoratedEvents, dayIndex, agendaDays, timeZone),
    [decoratedEvents, dayIndex, agendaDays, timeZone],
  );

  const lastUpdatedLabel = useMemo(
    () =>
      formatInTimeZone(data.generatedAt, timeZone, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    [data.generatedAt, timeZone],
  );

  const selectedEvent = useMemo(
    () => decoratedEvents.find((event) => event.id === expandedEventId) ?? null,
    [decoratedEvents, expandedEventId],
  );

  if (data.events.length === 0) {
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
            onClick={() =>
              onAnchorChange?.(shiftAnchor(anchor, view, -1, timeZone))
            }
            aria-label="Previous calendar range"
          >
            <svg
              className="public-calendar__nav-icon"
              viewBox="0 0 16 16"
              width="14"
              height="14"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M10 3.5 L5.5 8 L10 12.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="public-calendar__today-button"
            onClick={() => onAnchorChange?.(startOfDay(new Date(), timeZone))}
          >
            Today
          </button>
          <button
            type="button"
            className="public-calendar__nav-button"
            onClick={() =>
              onAnchorChange?.(shiftAnchor(anchor, view, 1, timeZone))
            }
            aria-label="Next calendar range"
          >
            <svg
              className="public-calendar__nav-icon"
              viewBox="0 0 16 16"
              width="14"
              height="14"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M6 3.5 L10.5 8 L6 12.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <strong className="public-calendar__range-title">
            {formatToolbarTitle(view, anchor, timeZone)}
          </strong>
        </div>
        <label className="public-calendar__time-zone-select">
          <span>Time zone</span>
          <select
            value={timeZone}
            onChange={(event) => onTimeZoneChange?.(event.currentTarget.value)}
          >
            {CALENDAR_TIME_ZONE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
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
        <a
          // `webcal://` is the iCal subscription scheme; macOS / iOS /
          // most desktop clients pop the "subscribe to calendar" dialog
          // when they see it. Plain HTTPS would render the ICS as text
          // in a browser tab; the title attribute spells out the
          // fallback for users on platforms that don't recognise the
          // scheme. The href is hand-crafted (not URL.toString()) so
          // the protocol stays `webcal:` rather than getting URL-coerced
          // to `https://` by Next.js's link wrappers.
          className="public-calendar__subscribe"
          href="webcal://jinkunchen.com/api/public/calendar/calendar.ics"
          title="Subscribe with Apple Calendar / Outlook / Google Calendar — your calendar app keeps it auto-updating."
        >
          <svg
            viewBox="0 0 16 16"
            width="13"
            height="13"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M3 5h10M3 9h7M3 13h4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
            <path
              d="M11.5 11.25v3.5M9.75 13h3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
          <span>Subscribe</span>
        </a>
      </div>
      {tagSummary.length > 0 ? (
        <div
          className="public-calendar__tag-bar"
          role="group"
          aria-label="Filter by tag"
        >
          {tagSummary.map(({ tag, count }) => {
            const isActive = selectedTagSet.has(tag);
            return (
              <button
                key={tag}
                type="button"
                className="public-calendar__tag-chip"
                data-active={isActive ? "true" : "false"}
                onClick={() => {
                  if (!onSelectedTagsChange) return;
                  // Toggle: clicking an active chip removes it from
                  // the selection; clicking an inactive chip adds it.
                  // The route owns the array, so we hand back the
                  // new shape rather than mutating in place.
                  const next = new Set(selectedTagSet);
                  if (isActive) next.delete(tag);
                  else next.add(tag);
                  onSelectedTagsChange(Array.from(next).sort());
                }}
                aria-pressed={isActive}
                title={
                  isActive
                    ? `Remove #${tag} filter`
                    : `Show only events tagged #${tag}`
                }
              >
                <span>#{tag}</span>
                <span className="public-calendar__tag-count" aria-hidden="true">
                  {count}
                </span>
              </button>
            );
          })}
          {selectedTagSet.size > 0 ? (
            <button
              type="button"
              className="public-calendar__tag-clear"
              onClick={() => onSelectedTagsChange?.([])}
              title="Clear tag filter"
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
      <p className="public-calendar__sync-note">
        Last updated {lastUpdatedLabel}. Times shown in{" "}
        {calendarTimeZoneLabel(timeZone)}.
        {selectedTagSet.size > 0 ? (
          <>
            {" "}Filtered by{" "}
            {Array.from(selectedTagSet)
              .map((t) => `#${t}`)
              .join(", ")}{" "}
            ({decoratedEvents.length} of {data.events.length} events).
          </>
        ) : null}
      </p>
      {view === "month" ? (
        <MonthCalendar
          dayIndex={dayIndex}
          anchor={anchor}
          timeZone={timeZone}
          selectedEventId={expandedEventId}
          onDaySelect={onDaySelect}
          onEventToggle={onEventToggle}
        />
      ) : null}
      {view === "week" ? (
        <WeekCalendar
          dayIndex={dayIndex}
          anchor={anchor}
          timeZone={timeZone}
          expandedEventId={expandedEventId}
          onEventToggle={onEventToggle}
        />
      ) : null}
      {view === "day" ? (
        <DayCalendar
          dayIndex={dayIndex}
          anchor={anchor}
          timeZone={timeZone}
          expandedEventId={expandedEventId}
          onEventToggle={onEventToggle}
        />
      ) : null}
      {view === "agenda" ? (
        <AgendaCalendar
          groups={agendaGroups}
          timeZone={timeZone}
          expandedEventId={expandedEventId}
          onEventToggle={onEventToggle}
        />
      ) : null}
      {selectedEvent ? (
        <EventDetailPanel
          event={selectedEvent}
          timeZone={timeZone}
          anchor={selectedEventAnchor}
          onClose={() => onEventToggle?.(selectedEvent.id, null)}
        />
      ) : null}
    </div>
  );
}

function WeekdayLabels({ timeZone }: { timeZone: string }) {
  const monday = zonedDateFromDayKey("2024-01-01", timeZone);
  return (
    <div className="public-calendar__weekdays">
      {Array.from({ length: 7 }, (_, i) => {
        const day = addDays(monday, i, timeZone);
        return (
          <span key={day.toISOString()}>
            {formatInTimeZone(day, timeZone, { weekday: "short" })}
          </span>
        );
      })}
    </div>
  );
}

function MonthCalendar({
  dayIndex,
  anchor,
  timeZone,
  selectedEventId,
  onDaySelect,
  onEventToggle,
}: {
  dayIndex: DayIndex;
  anchor: Date;
  timeZone: string;
  selectedEventId?: string | null;
  onDaySelect?: (date: Date) => void;
  onEventToggle?: EventToggleHandler;
}) {
  const days = useMemo(() => monthGridDays(anchor, timeZone), [anchor, timeZone]);
  const todayKey = keyForDate(new Date(), timeZone);
  return (
    <div className="public-calendar__month">
      <WeekdayLabels timeZone={timeZone} />
      <div className="public-calendar__month-grid">
        {days.map((day) => {
          const key = keyForDate(day, timeZone);
          const dayEvents = eventsForDayKey(dayIndex, key);
          const inMonth = isSameZonedMonth(day, anchor, timeZone);
          return (
            <section
              className="public-calendar__month-cell"
              data-muted={inMonth ? "false" : "true"}
              key={key}
            >
              <button
                type="button"
                className="public-calendar__date-button"
                onClick={() => onDaySelect?.(day)}
                aria-label={`Open ${formatInTimeZone(day, timeZone, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}`}
              >
                <span
                  className="public-calendar__date-number"
                  data-today={key === todayKey ? "true" : "false"}
                >
                  {formatInTimeZone(day, timeZone, { day: "numeric" })}
                </span>
              </button>
              <div className="public-calendar__month-events">
                {dayEvents.slice(0, 3).map((event) => (
                  <EventPill
                    event={event}
                    key={`${event.id}-${event.startTimestamp}`}
                    selected={selectedEventId === event.id}
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
  timeZone,
  expandedEventId,
  onEventToggle,
}: {
  dayIndex: DayIndex;
  anchor: Date;
  timeZone: string;
  expandedEventId?: string | null;
  onEventToggle?: EventToggleHandler;
}) {
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) =>
        addDays(startOfWeek(anchor, timeZone), i, timeZone),
      ),
    [anchor, timeZone],
  );
  return (
    <div className="public-calendar__week">
      <WeekdayLabels timeZone={timeZone} />
      <div className="public-calendar__week-grid">
        {days.map((day) => (
          <section className="public-calendar__week-day" key={day.toISOString()}>
            <div className="public-calendar__week-date">
              <span>{formatInTimeZone(day, timeZone, { day: "numeric" })}</span>
            </div>
            <div className="public-calendar__week-events">
              {eventsForDay(dayIndex, day, timeZone).map((event) => (
                <EventCard
                  event={event}
                  key={`${event.id}-${event.startTimestamp}`}
                  compact
                  selected={expandedEventId === event.id}
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
  timeZone,
  expandedEventId,
  onEventToggle,
}: {
  dayIndex: DayIndex;
  anchor: Date;
  timeZone: string;
  expandedEventId?: string | null;
  onEventToggle?: EventToggleHandler;
}) {
  const dayEvents = eventsForDay(dayIndex, anchor, timeZone);
  return (
    <div className="public-calendar__day-list">
      {dayEvents.length > 0 ? (
        dayEvents.map((event) => (
          <EventCard
            event={event}
            key={`${event.id}-${event.startTimestamp}`}
            selected={expandedEventId === event.id}
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
  timeZone,
  expandedEventId,
  onEventToggle,
}: {
  groups: Array<[string, DecoratedEvent[]]>;
  timeZone: string;
  expandedEventId?: string | null;
  onEventToggle?: EventToggleHandler;
}) {
  return (
    <div className="public-calendar__agenda">
      {groups.map(([day, dayEvents]) => (
        <section className="public-calendar__day" key={day}>
          <h2 className="public-calendar__day-title">
            {formatDay(day, timeZone)}
          </h2>
          <ol className="public-calendar__events">
            {dayEvents.map((event) => (
              <li
                className="public-calendar__event"
                key={`${event.id}-${event.startTimestamp}`}
              >
                <EventCard
                  event={event}
                  selected={expandedEventId === event.id}
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
  selected = false,
  onEventToggle,
}: {
  event: DecoratedEvent;
  selected?: boolean;
  onEventToggle?: EventToggleHandler;
}) {
  return (
    <button
      type="button"
      className="public-calendar__event-pill"
      data-selected={selected ? "true" : "false"}
      title={`${event.formattedTime} ${event.title}`}
      onClick={(e) => {
        e.stopPropagation();
        onEventToggle?.(event.id, anchorFromClick(e));
      }}
      aria-pressed={selected}
      style={{ "--calendar-color": event.colorHex ?? "#9b9a97" } as CSSProperties}
    >
      <span>{event.isAllDay ? "" : event.formattedTime}</span>
      {event.title}
    </button>
  );
}

function EventDetailPanel({
  event,
  timeZone,
  anchor,
  onClose,
}: {
  event: DecoratedEvent;
  timeZone: string;
  anchor?: PublicCalendarEventAnchor | null;
  onClose: () => void;
}) {
  const dateLabel = formatInTimeZone(event.startsAt, timeZone, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const geometry = detailGeometryForAnchor(anchor);
  return (
    <div
      className="public-calendar__detail-layer"
      data-placement={geometry.placement}
    >
      <button
        type="button"
        className="public-calendar__detail-scrim"
        aria-label="Close event details"
        onClick={onClose}
      />
      <aside
        className="public-calendar__detail-panel"
        style={
          {
            "--calendar-color": event.colorHex ?? "#9b9a97",
            ...geometry.style,
          } as CSSProperties
        }
        role="dialog"
        aria-modal="false"
        aria-labelledby="public-calendar-detail-title"
      >
        <span className="public-calendar__detail-arrow" aria-hidden="true" />
        <div className="public-calendar__detail-rail" aria-hidden="true" />
        <div className="public-calendar__detail-main">
          <header className="public-calendar__detail-header">
            <div>
              <span className="public-calendar__detail-kicker">
                {event.calendarTitle ?? "Calendar"}
              </span>
              <h2 id="public-calendar-detail-title">{event.title}</h2>
            </div>
            <button
              type="button"
              className="public-calendar__detail-close"
              onClick={onClose}
              aria-label="Close event details"
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>
          <dl className="public-calendar__detail-meta">
            <div>
              <dt>Date</dt>
              <dd>{dateLabel}</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>{event.formattedTime}</dd>
            </div>
            {event.visibility === "full" && event.location ? (
              <div>
                <dt>Location</dt>
                <dd>{event.location}</dd>
              </div>
            ) : null}
          </dl>
          {event.visibility === "busy" ? (
            <p className="public-calendar__detail-description">
              Details are hidden for this blocked time.
            </p>
          ) : null}
          {event.visibility === "full" && event.description ? (
            <p className="public-calendar__detail-description">
              {event.description}
            </p>
          ) : null}
          <div className="public-calendar__detail-actions">
            {event.visibility === "full" && event.url ? (
              <a href={event.url}>Event link</a>
            ) : null}
            {event.visibility !== "busy" ? (
              <a href={`/calendar/${event.id}`}>Open event page</a>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}

function EventCard({
  event,
  compact = false,
  selected = false,
  onEventToggle,
}: {
  event: DecoratedEvent;
  compact?: boolean;
  selected?: boolean;
  onEventToggle?: EventToggleHandler;
}) {
  return (
    <div
      className="public-calendar__event-card"
      data-compact={compact ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
      style={{ "--calendar-color": event.colorHex ?? "#9b9a97" } as CSSProperties}
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
          onClick={(e) => onEventToggle?.(event.id, anchorFromClick(e))}
          aria-pressed={selected}
          aria-haspopup="dialog"
        >
          <div className="public-calendar__event-topline">
            <span className="public-calendar__event-time">{event.formattedTime}</span>
            <strong className="public-calendar__event-title">{event.title}</strong>
          </div>
        </button>
      </div>
    </div>
  );
}
