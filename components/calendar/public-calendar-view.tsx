"use client";

import { useMemo, type CSSProperties, type MouseEvent } from "react";

import {
  eventMatchesAnyTag,
  summarizeTags,
} from "@/lib/shared/calendar-tags";
import {
  CALENDAR_TIME_ZONE_OPTIONS,
  DEFAULT_CALENDAR_TIME_ZONE,
  calendarTimeZoneLabel,
  formatInTimeZone,
} from "@/lib/shared/calendar-timezone";
import {
  PUBLIC_CALENDAR_VIEW_LABELS,
  addCalendarDays,
  buildAgendaGroups,
  buildDayIndex,
  countPublicCalendarHiddenBusyEvents,
  decoratePublicCalendarEvent,
  eventsForDay,
  eventsForDayKey,
  filterPublicCalendarAudience,
  formatDay,
  formatToolbarTitle,
  isSameZonedMonth,
  isPublicCalendarDataStale,
  isWeekend,
  keyForDate,
  monthGridDays,
  parseDayKey,
  PUBLIC_CALENDAR_AUDIENCE_LABELS,
  shiftAnchor,
  startOfCalendarDay,
  startOfWeek,
  type PublicCalendarAudienceMode,
  type DecoratedPublicCalendarEvent,
  type PublicCalendarDayIndex,
  type PublicCalendarViewMode,
} from "./public-calendar-model";
import type { PublicCalendarData } from "@/lib/shared/public-calendar";

export type { PublicCalendarViewMode } from "./public-calendar-model";
export type { PublicCalendarAudienceMode } from "./public-calendar-model";

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

export function PublicCalendarView({
  data,
  view = "agenda",
  anchorIso,
  currentDateIso,
  agendaDays = 30,
  audience = "featured",
  onViewChange,
  onAnchorChange,
  onAgendaDaysChange,
  onAudienceChange,
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
  currentDateIso?: string | null;
  agendaDays?: 30 | 90;
  audience?: PublicCalendarAudienceMode;
  onViewChange?: (view: PublicCalendarViewMode) => void;
  onAnchorChange?: (date: Date) => void;
  onAgendaDaysChange?: (days: 30 | 90) => void;
  onAudienceChange?: (audience: PublicCalendarAudienceMode) => void;
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
  const currentDate = useMemo(
    () =>
      Number.isFinite(Date.parse(currentDateIso ?? ""))
        ? new Date(currentDateIso ?? "")
        : null,
    [currentDateIso],
  );
  const anchor = useMemo(
    () =>
      Number.isFinite(Date.parse(anchorIso ?? ""))
        ? new Date(anchorIso ?? "")
        : (currentDate ?? new Date()),
    [anchorIso, currentDate],
  );

  // Tag filter — applied BEFORE decoration so the day index, agenda
  // groups, and per-view event lists all share the same filtered set.
  // The Set is rebuilt every render but `selectedTags` is typically
  // ≤5 chips and the membership test is the hot path inside
  // eventMatchesAnyTag. Memoizing the Set itself isn't worth it.
  const selectedTagSet = useMemo(
    () => new Set(selectedTags ?? []),
    [selectedTags],
  );
  const audienceEvents = useMemo(
    () => filterPublicCalendarAudience(data.events, audience),
    [data.events, audience],
  );
  const filteredEvents = useMemo(
    () =>
      selectedTagSet.size === 0
        ? audienceEvents
        : audienceEvents.filter((event) =>
            eventMatchesAnyTag(event, selectedTagSet),
          ),
    [audienceEvents, selectedTagSet],
  );
  // Prefer the parent-supplied summary (the client wrapper computes
  // it once per data change). Fall back to recomputing locally for
  // callers that don't pass it — keeps the component standalone-safe.
  const tagSummary = useMemo(
    () => tagSummaryProp ?? summarizeTags(audienceEvents),
    [tagSummaryProp, audienceEvents],
  );

  // Decorate each event once: parse timestamps, compute day keys + formatted
  // time. Without this, MonthView would Date-parse every event 42 times per
  // render.
  const decoratedEvents = useMemo(
    () =>
      [...filteredEvents]
        .map((event) => decoratePublicCalendarEvent(event, timeZone))
        .sort((a, b) => a.startTimestamp - b.startTimestamp),
    [filteredEvents, timeZone],
  );

  // Index events by the day-keys they touch, so MonthView/WeekView/DayView
  // get O(1) per-day lookups instead of O(n) filters.
  const dayIndex = useMemo(() => buildDayIndex(decoratedEvents), [decoratedEvents]);

  const agendaGroups = useMemo(
    () =>
      buildAgendaGroups(
        decoratedEvents,
        agendaDays,
        currentDate ?? anchor,
        timeZone,
      ),
    [decoratedEvents, agendaDays, currentDate, anchor, timeZone],
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
  const timeZoneLabel = calendarTimeZoneLabel(timeZone);
  const calendarDataIsStale = useMemo(
    () => isPublicCalendarDataStale(data.generatedAt, currentDate ?? new Date()),
    [data.generatedAt, currentDate],
  );
  const hiddenBusyCount = useMemo(
    () => countPublicCalendarHiddenBusyEvents(data.events, audience),
    [data.events, audience],
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
      <div className="public-calendar__toolbar ds-control-toolbar">
        <div className="public-calendar__nav ds-control-group">
          <button
            type="button"
            className="public-calendar__nav-button ds-control-button ds-control-button--icon"
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
            className="public-calendar__today-button ds-control-button"
            onClick={() =>
              onAnchorChange?.(
                startOfCalendarDay(currentDate ?? new Date(), timeZone),
              )
            }
          >
            Today
          </button>
          <button
            type="button"
            className="public-calendar__nav-button ds-control-button ds-control-button--icon"
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
        <label
          className="public-calendar__time-zone-select ds-select-pill"
          title={`Times shown in ${timeZoneLabel}`}
        >
          <span className="public-calendar__time-zone-label ds-select-pill__label">Time zone</span>
          <span className="public-calendar__time-zone-value ds-select-pill__value">
            {timeZoneLabel}
          </span>
          <select
            value={timeZone}
            aria-label="Time zone"
            title={timeZoneLabel}
            onChange={(event) => onTimeZoneChange?.(event.currentTarget.value)}
          >
            {CALENDAR_TIME_ZONE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div
          className="public-calendar__view-switch public-calendar__view-switch--views ds-control-group"
          aria-label="Calendar view"
        >
          {PUBLIC_CALENDAR_VIEW_LABELS.map((item) => (
            <button
              key={item.value}
              type="button"
              className="public-calendar__view-button ds-control-button"
              data-active={view === item.value ? "true" : "false"}
              onClick={() => onViewChange?.(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {view === "agenda" ? (
          <div
            className="public-calendar__view-switch public-calendar__view-switch--agenda ds-control-group"
            aria-label="Agenda range"
          >
            {([30, 90] as const).map((days) => (
              <button
                key={days}
                type="button"
                className="public-calendar__view-button ds-control-button"
                data-active={agendaDays === days ? "true" : "false"}
                onClick={() => onAgendaDaysChange?.(days)}
              >
                {days} days
              </button>
            ))}
          </div>
        ) : null}
        <div
          className="public-calendar__view-switch public-calendar__view-switch--audience ds-control-group"
          aria-label="Calendar scope"
        >
          {PUBLIC_CALENDAR_AUDIENCE_LABELS.map((item) => (
            <button
              key={item.value}
              type="button"
              className="public-calendar__view-button ds-control-button"
              data-active={audience === item.value ? "true" : "false"}
              aria-pressed={audience === item.value}
              onClick={() => onAudienceChange?.(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <a
          // `webcal://` is the iCal subscription scheme; macOS / iOS /
          // most desktop clients pop the "subscribe to calendar" dialog
          // when they see it. Plain HTTPS would render the ICS as text
          // in a browser tab; the title attribute spells out the
          // fallback for users on platforms that don't recognise the
          // scheme. The href is hand-crafted (not URL.toString()) so
          // the protocol stays `webcal:` rather than getting URL-coerced
          // to `https://` by Next.js's link wrappers.
          className="public-calendar__subscribe ds-control-button ds-control-button--accent"
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
      <p
        className="public-calendar__sync-note"
        data-stale={calendarDataIsStale ? "true" : "false"}
      >
        Last updated {lastUpdatedLabel}. Times shown in{" "}
        {timeZoneLabel}.{" "}
        {audience === "featured" ? (
          <>
            Showing visitor-facing events ({decoratedEvents.length} of{" "}
            {data.events.length}).
          </>
        ) : (
          <>Showing all public events.</>
        )}
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
      {calendarDataIsStale || hiddenBusyCount > 0 ? (
        <div className="public-calendar__status-hints" aria-live="polite">
          {calendarDataIsStale ? (
            <p className="public-calendar__stale-hint">
              Calendar data is older than 24 hours. Sync from iOS or macOS to
              refresh recent changes.
            </p>
          ) : null}
          {hiddenBusyCount > 0 ? (
            <p className="public-calendar__scope-hint">
              Featured hides {hiddenBusyCount} Busy{" "}
              {hiddenBusyCount === 1 ? "event" : "events"} for privacy.
              {onAudienceChange ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className="public-calendar__scope-action"
                    onClick={() => onAudienceChange("all")}
                  >
                    Show all events
                  </button>
                  .
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : null}
      {view === "month" ? (
        <MonthCalendar
          dayIndex={dayIndex}
          anchor={anchor}
          currentDate={currentDate}
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
  const sunday = parseDayKey("2024-01-07", timeZone);
  return (
    <div className="public-calendar__weekdays">
      {Array.from({ length: 7 }, (_, i) => {
        const day = addCalendarDays(sunday, i, timeZone);
        return (
          <span
            data-weekend={isWeekend(day, timeZone) ? "true" : "false"}
            key={day.toISOString()}
          >
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
  currentDate,
  timeZone,
  selectedEventId,
  onDaySelect,
  onEventToggle,
}: {
  dayIndex: PublicCalendarDayIndex;
  anchor: Date;
  currentDate: Date | null;
  timeZone: string;
  selectedEventId?: string | null;
  onDaySelect?: (date: Date) => void;
  onEventToggle?: EventToggleHandler;
}) {
  const days = useMemo(() => monthGridDays(anchor, timeZone), [anchor, timeZone]);
  const todayKey = currentDate ? keyForDate(currentDate, timeZone) : null;
  return (
    <div className="public-calendar__month">
      <WeekdayLabels timeZone={timeZone} />
      <div className="public-calendar__month-grid">
        {days.map((day) => {
          const key = keyForDate(day, timeZone);
          const dayEvents = eventsForDayKey(dayIndex, key);
          const inMonth = isSameZonedMonth(day, anchor, timeZone);
          const weekend = isWeekend(day, timeZone);
          return (
            <section
              className="public-calendar__month-cell"
              data-muted={inMonth ? "false" : "true"}
              data-weekend={weekend ? "true" : "false"}
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
  dayIndex: PublicCalendarDayIndex;
  anchor: Date;
  timeZone: string;
  expandedEventId?: string | null;
  onEventToggle?: EventToggleHandler;
}) {
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) =>
        addCalendarDays(startOfWeek(anchor, timeZone), i, timeZone),
      ),
    [anchor, timeZone],
  );
  return (
    <div className="public-calendar__week">
      <WeekdayLabels timeZone={timeZone} />
      <div className="public-calendar__week-grid">
        {days.map((day) => (
          <section
            className="public-calendar__week-day"
            data-weekend={isWeekend(day, timeZone) ? "true" : "false"}
            key={day.toISOString()}
          >
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
  dayIndex: PublicCalendarDayIndex;
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
  groups: Array<[string, DecoratedPublicCalendarEvent[]]>;
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
  event: DecoratedPublicCalendarEvent;
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
  event: DecoratedPublicCalendarEvent;
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
  event: DecoratedPublicCalendarEvent;
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
