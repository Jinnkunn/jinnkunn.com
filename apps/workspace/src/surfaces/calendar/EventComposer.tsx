import { useEffect, useMemo, useState, type FormEvent } from "react";

import { calendarCreateEvent, type RecurrenceFrequency } from "./api";
import {
  isLocalCalendarId,
  localCalendarCreateEvent,
} from "../../modules/calendar/localCalendarApi";
import type { Calendar, CalendarEvent } from "./types";
import {
  calendarTimeZoneShortLabel,
  fromZonedDateTimeInputValue,
  formatInTimeZone,
  toZonedDateTimeInputValue,
  zonedDateAtMinute,
  zonedMinuteOfDay,
} from "../../../../../lib/shared/calendar-timezone.ts";

const RECURRENCE_OPTIONS: Array<{
  value: "none" | RecurrenceFrequency;
  label: string;
}> = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
  { value: "biweekly", label: "Every other week" },
  { value: "monthly", label: "Every month" },
];

const RECURRENCE_DEFAULT_COUNT: Record<RecurrenceFrequency, number> = {
  daily: 14,
  weekly: 14, // class-meeting default — a typical North American semester
  biweekly: 7,
  monthly: 12,
};

// Quick "+ Event" composer that lives in the calendar surface header.
// The operator clicks "+ Event", picks a calendar, types a title, and
// confirms — most events get their start/end from the currently-
// anchored hour and end an hour later, which matches macOS Calendar's
// keyboard-create flow ("Cmd+N → here-now → 1h"). Power-edit fields
// (notes / location / URL / RRULE) stay in macOS Calendar.app where
// the Apple form is already excellent — this composer is for fast
// "drop a class meeting on the schedule" operations, not full
// authoring.
//
// On save the parent receives the saved CalendarEvent and is
// expected to splice it into its events list optimistically;
// EventKit will also fire its own change notification right after,
// so a redundant refetch from the listener still results in a no-op.

const ROUND_TO_NEAREST_MINUTES = 15;

function roundUpToQuarterHour(d: Date, timeZone: string): Date {
  const minute = zonedMinuteOfDay(d, timeZone);
  const rem = minute % ROUND_TO_NEAREST_MINUTES;
  const rounded =
    rem === 0 ? minute : minute + (ROUND_TO_NEAREST_MINUTES - rem);
  return zonedDateAtMinute(d, Math.min(24 * 60, rounded), timeZone);
}

export interface EventComposerProps {
  /** Calendars the operator can write to. The Rust side rejects
   * read-only calendars (delegate, Birthdays) but we filter here to
   * skip them at the picker stage. */
  calendars: Calendar[];
  /** Anchored time the operator is currently looking at. Defaults
   * to now. */
  anchor: Date;
  /** Optional end time from timeline drag-create. */
  initialEndsAt?: Date;
  /** Display / input time zone. Underlying events are still saved as
   * absolute ISO instants. */
  timeZone: string;
  /** Fires after a successful save so the parent can splice + refocus. */
  onCreated: (event: CalendarEvent) => void;
  /** Fires on cancel / dismiss so the parent can hide the composer. */
  onClose: () => void;
  /** Presentation mode. Popover matches macOS quick-create; inspector
   * remains available for narrow fallback surfaces. */
  variant?: "popover" | "inspector";
  /** Optional escape hatch when the user has no writable platform
   * calendar yet. Creates a local-first workspace calendar and returns
   * it so the composer can select it immediately. */
  onCreateWorkspaceCalendar?: () => Promise<Calendar | null>;
}

export function EventComposer({
  calendars,
  anchor,
  initialEndsAt,
  timeZone,
  onCreated,
  onClose,
  variant = "popover",
  onCreateWorkspaceCalendar,
}: EventComposerProps) {
  const writableCalendars = useMemo(
    () => calendars.filter((c) => c.allowsModifications),
    [calendars],
  );
  const [calendarId, setCalendarId] = useState<string>(
    () => writableCalendars[0]?.id ?? "",
  );
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState(() =>
    toZonedDateTimeInputValue(
      initialEndsAt ? anchor : roundUpToQuarterHour(anchor, timeZone),
      timeZone,
    ),
  );
  const [endsAt, setEndsAt] = useState(() => {
    if (initialEndsAt) return toZonedDateTimeInputValue(initialEndsAt, timeZone);
    const start = roundUpToQuarterHour(anchor, timeZone);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return toZonedDateTimeInputValue(end, timeZone);
  });
  const [isAllDay, setIsAllDay] = useState(false);
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [recurrence, setRecurrence] = useState<"none" | RecurrenceFrequency>(
    "none",
  );
  const [recurrenceCount, setRecurrenceCount] = useState(14);
  const [busy, setBusy] = useState(false);
  const [creatingWorkspaceCalendar, setCreatingWorkspaceCalendar] =
    useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (calendarId && writableCalendars.some((calendar) => calendar.id === calendarId)) {
      return;
    }
    setCalendarId(writableCalendars[0]?.id ?? "");
  }, [calendarId, writableCalendars]);

  // ESC dismisses the composer; matches the rest of the surface's
  // popover convention. Mounted on the window (rather than the form)
  // so it works even when the user hasn't moved focus into the form
  // — clicking "+ Event" still leaves focus on the trigger button
  // until the input is interacted with.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (!calendarId) {
      setError("No writable calendar available.");
      return;
    }
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    const startDate = fromZonedDateTimeInputValue(startsAt, timeZone);
    const endDate = fromZonedDateTimeInputValue(endsAt, timeZone);
    const startIso = startDate?.toISOString() ?? "";
    const endIso = endDate?.toISOString() ?? "";
    if (!startIso || !endIso) {
      setError("Couldn't parse the start/end time.");
      return;
    }
    setBusy(true);
    try {
      // Local-first calendars route to a separate Tauri command — no
      // EventKit involved. Recurrence isn't supported in v1; the form
      // disables the dropdown for local calendars so we don't have to
      // worry about silently dropping it here.
      const saved = isLocalCalendarId(calendarId)
        ? await localCalendarCreateEvent({
            calendarId,
            title: title.trim(),
            startsAt: startIso,
            endsAt: endIso,
            isAllDay,
            notes: notes.trim() || null,
            location: location.trim() || null,
            url: null,
          })
        : await calendarCreateEvent({
            calendarId,
            title: title.trim(),
            startsAt: startIso,
            endsAt: endIso,
            isAllDay,
            notes: notes.trim() || undefined,
            location: location.trim() || undefined,
            recurrence:
              recurrence === "none"
                ? undefined
                : { frequency: recurrence, count: recurrenceCount },
          });
      onCreated(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function createWorkspaceCalendar() {
    if (!onCreateWorkspaceCalendar || creatingWorkspaceCalendar) return;
    setError(null);
    setCreatingWorkspaceCalendar(true);
    try {
      const calendar = await onCreateWorkspaceCalendar();
      if (calendar) setCalendarId(calendar.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingWorkspaceCalendar(false);
    }
  }

  return (
    <form
      className={`calendar-event-composer calendar-event-composer--${variant}`}
      onSubmit={onSubmit}
    >
      <header className="calendar-event-composer__header">
        <div>
          <strong>New Event</strong>
          <span>
            {formatComposerRange(startsAt, endsAt, isAllDay, timeZone)}
            {" · "}
            {calendarTimeZoneShortLabel(timeZone)}
          </span>
        </div>
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Close
        </button>
      </header>
      {writableCalendars.length === 0 && onCreateWorkspaceCalendar ? (
        <div className="calendar-event-composer__empty">
          <p>No writable calendar yet.</p>
          <button
            type="button"
            className="btn btn--primary"
            disabled={creatingWorkspaceCalendar}
            onClick={() => void createWorkspaceCalendar()}
          >
            {creatingWorkspaceCalendar
              ? "Creating..."
              : "Create Workspace calendar"}
          </button>
        </div>
      ) : null}
      <div className="calendar-event-composer__row">
        <label className="calendar-event-composer__field">
          <span>Event</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New Event"
            autoFocus
            required
          />
        </label>
      </div>
      <div className="calendar-event-composer__row">
        <label className="calendar-event-composer__field">
          <span>Calendar</span>
          <select
            value={calendarId}
            onChange={(e) => setCalendarId(e.target.value)}
            disabled={writableCalendars.length === 0}
          >
            {writableCalendars.length === 0 ? (
              <option value="">No writable calendars</option>
            ) : (
              writableCalendars.map((cal) => (
                <option key={cal.id} value={cal.id}>
                  {cal.title}
                </option>
              ))
            )}
          </select>
        </label>
        <label className="calendar-event-composer__field calendar-event-composer__checkbox">
          <input
            type="checkbox"
            checked={isAllDay}
            onChange={(e) => setIsAllDay(e.target.checked)}
          />
          <span>All-day</span>
        </label>
      </div>
      <div className="calendar-event-composer__row">
        <label className="calendar-event-composer__field">
          <span>Starts</span>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            required
          />
        </label>
        <label className="calendar-event-composer__field">
          <span>Ends</span>
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            required
          />
        </label>
      </div>
      {detailsOpen ? (
        <>
          <div className="calendar-event-composer__row">
            <label className="calendar-event-composer__field">
              <span>Location</span>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Location"
              />
            </label>
          </div>
          <div className="calendar-event-composer__row">
            <label className="calendar-event-composer__field">
              <span>Notes</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes"
                rows={3}
              />
            </label>
          </div>
          <div className="calendar-event-composer__row">
            <label className="calendar-event-composer__field">
              <span>Repeats</span>
              <select
                value={isLocalCalendarId(calendarId) ? "none" : recurrence}
                disabled={isLocalCalendarId(calendarId)}
                title={
                  isLocalCalendarId(calendarId)
                    ? "Workspace calendars do not repeat yet"
                    : undefined
                }
                onChange={(e) => {
                  const next = e.target.value as "none" | RecurrenceFrequency;
                  setRecurrence(next);
                  if (next !== "none") {
                    setRecurrenceCount(RECURRENCE_DEFAULT_COUNT[next]);
                  }
                }}
              >
                {RECURRENCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            {recurrence !== "none" && !isLocalCalendarId(calendarId) ? (
              <label className="calendar-event-composer__field">
                <span>Occurrences</span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  step={1}
                  value={recurrenceCount}
                  onChange={(e) => {
                    const parsed = Number.parseInt(e.target.value, 10);
                    setRecurrenceCount(
                      Number.isFinite(parsed) && parsed > 0 ? parsed : 1,
                    );
                  }}
                />
              </label>
            ) : null}
          </div>
        </>
      ) : null}
      {!detailsOpen ? (
        <button
          type="button"
          className="calendar-event-composer__details-toggle"
          onClick={() => setDetailsOpen(true)}
        >
          Add location, notes, or repeat
        </button>
      ) : null}
      {error ? (
        <p className="calendar-event-composer__error">{error}</p>
      ) : null}
      <div className="calendar-event-composer__actions">
        <button type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? "Saving…" : "Add"}
        </button>
      </div>
    </form>
  );
}

function formatComposerRange(
  startsAt: string,
  endsAt: string,
  isAllDay: boolean,
  timeZone: string,
): string {
  const start = fromZonedDateTimeInputValue(startsAt, timeZone);
  const end = fromZonedDateTimeInputValue(endsAt, timeZone);
  if (
    !start ||
    !end ||
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime())
  ) {
    return "Calendar";
  }
  if (isAllDay) {
    return formatInTimeZone(start, timeZone, {
      day: "numeric",
      month: "short",
      weekday: "short",
    });
  }
  const date = formatInTimeZone(start, timeZone, {
    day: "numeric",
    month: "short",
    weekday: "short",
  });
  const startTime = formatInTimeZone(start, timeZone, {
    hour: "numeric",
    minute: "2-digit",
  });
  const endTime = formatInTimeZone(end, timeZone, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date}, ${startTime} - ${endTime}`;
}
