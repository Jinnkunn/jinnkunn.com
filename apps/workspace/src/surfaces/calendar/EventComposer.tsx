import { useEffect, useState, type FormEvent } from "react";

import { calendarCreateEvent, type RecurrenceFrequency } from "./api";
import type { Calendar, CalendarEvent } from "./types";

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

function roundUpToQuarterHour(d: Date): Date {
  const out = new Date(d);
  out.setSeconds(0, 0);
  const rem = out.getMinutes() % ROUND_TO_NEAREST_MINUTES;
  if (rem !== 0) out.setMinutes(out.getMinutes() + (ROUND_TO_NEAREST_MINUTES - rem));
  return out;
}

function toLocalInputValue(d: Date): string {
  // <input type="datetime-local"> wants `YYYY-MM-DDTHH:MM` in local
  // time. Date.toISOString() emits UTC; we splice manually instead.
  const yyyy = d.getFullYear().toString().padStart(4, "0");
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  const hh = d.getHours().toString().padStart(2, "0");
  const mi = d.getMinutes().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function fromLocalInputValue(value: string): string {
  // Convert the local-flavored datetime-local string back to an ISO
  // 8601 with offset. Date(value) interprets the input in local time;
  // toISOString gives us UTC. EventKit accepts both — we send the
  // ISO-with-Z form for clarity.
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString();
}

export interface EventComposerProps {
  /** Calendars the operator can write to. The Rust side rejects
   * read-only calendars (delegate, Birthdays) but we filter here to
   * skip them at the picker stage. */
  calendars: Calendar[];
  /** Anchored time the operator is currently looking at. Defaults
   * to now. */
  anchor: Date;
  /** Fires after a successful save so the parent can splice + refocus. */
  onCreated: (event: CalendarEvent) => void;
  /** Fires on cancel / dismiss so the parent can hide the composer. */
  onClose: () => void;
}

export function EventComposer({
  calendars,
  anchor,
  onCreated,
  onClose,
}: EventComposerProps) {
  const writableCalendars = calendars.filter((c) => c.allowsModifications);
  const [calendarId, setCalendarId] = useState<string>(
    () => writableCalendars[0]?.id ?? "",
  );
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState(() =>
    toLocalInputValue(roundUpToQuarterHour(anchor)),
  );
  const [endsAt, setEndsAt] = useState(() => {
    const start = roundUpToQuarterHour(anchor);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return toLocalInputValue(end);
  });
  const [isAllDay, setIsAllDay] = useState(false);
  const [recurrence, setRecurrence] = useState<"none" | RecurrenceFrequency>(
    "none",
  );
  const [recurrenceCount, setRecurrenceCount] = useState(14);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError("No writable calendars available.");
      return;
    }
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    const startIso = fromLocalInputValue(startsAt);
    const endIso = fromLocalInputValue(endsAt);
    if (!startIso || !endIso) {
      setError("Couldn't parse the start/end time.");
      return;
    }
    setBusy(true);
    try {
      const saved = await calendarCreateEvent({
        calendarId,
        title: title.trim(),
        startsAt: startIso,
        endsAt: endIso,
        isAllDay,
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

  return (
    <form className="calendar-event-composer" onSubmit={onSubmit}>
      <div className="calendar-event-composer__row">
        <label className="calendar-event-composer__field">
          <span>Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Office hours, talk, meeting…"
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
      <div className="calendar-event-composer__row">
        <label className="calendar-event-composer__field">
          <span>Repeats</span>
          <select
            value={recurrence}
            onChange={(e) => {
              const next = e.target.value as "none" | RecurrenceFrequency;
              setRecurrence(next);
              if (next !== "none") {
                // Reset to a sensible default count for the chosen
                // frequency so a class-meeting flow defaults to a
                // 14-week semester instead of the previous picker's
                // value.
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
        {recurrence !== "none" ? (
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
      {error ? (
        <p className="calendar-event-composer__error">{error}</p>
      ) : null}
      <div className="calendar-event-composer__actions">
        <button type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? "Saving…" : "Create event"}
        </button>
      </div>
    </form>
  );
}
