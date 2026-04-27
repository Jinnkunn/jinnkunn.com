import { useCallback, useEffect, useMemo, useState } from "react";

import {
  calendarAuthorizationStatus,
  calendarFetchEvents,
  calendarListCalendars,
  calendarListSources,
  calendarRequestAccess,
  onCalendarChanged,
} from "./api";
import type {
  Calendar,
  CalendarAuthorizationStatus,
  CalendarEvent,
  CalendarSource,
} from "./types";

/** How many days forward we ask EventKit for. The backend pre-expands
 * recurring events, so a wider window gets noticeably more rows; we
 * keep it modest until there's a real date picker. */
const RANGE_DAYS = 14;

type LoadState = "idle" | "loading" | "ready" | "error";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function defaultRange(): { startsAt: string; endsAt: string } {
  const start = startOfToday();
  const end = new Date(start);
  end.setDate(end.getDate() + RANGE_DAYS);
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
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
  // Construct from the YYYY-MM-DD parts to avoid TZ drift on parse.
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = startOfToday();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const prefix = sameDay(date, today)
    ? "Today · "
    : sameDay(date, tomorrow)
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

function isAuthorized(status: CalendarAuthorizationStatus): boolean {
  return status === "fullAccess" || status === "writeOnly";
}

export function CalendarSurface() {
  const [auth, setAuth] = useState<CalendarAuthorizationStatus>("notDetermined");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sources, setSources] = useState<CalendarSource[]>([]);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<Set<string>>(
    new Set(),
  );
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  // Range is currently fixed; future iteration: date picker drives this.
  const [range] = useState(defaultRange);

  // Read the current authorization on first mount (no prompt yet).
  useEffect(() => {
    let cancelled = false;
    void calendarAuthorizationStatus()
      .then((status) => {
        if (!cancelled) setAuth(status);
      })
      .catch((err) => {
        if (!cancelled) {
          setAuth("denied");
          setErrorMessage(String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadAll = useCallback(async () => {
    setLoadState("loading");
    setErrorMessage(null);
    try {
      const [src, cal] = await Promise.all([
        calendarListSources(),
        calendarListCalendars(),
      ]);
      setSources(src);
      setCalendars(cal);
      // Select-all by default so the first paint isn't an empty pane.
      setSelectedCalendarIds((prev) =>
        prev.size === 0 ? new Set(cal.map((c) => c.id)) : prev,
      );
      const evs = await calendarFetchEvents({ ...range, calendarIds: [] });
      setEvents(evs);
      setLoadState("ready");
    } catch (err) {
      setLoadState("error");
      setErrorMessage(String(err));
    }
  }, [range]);

  // Once authorized, kick off the initial load.
  useEffect(() => {
    if (!isAuthorized(auth)) return;
    void loadAll();
  }, [auth, loadAll]);

  // Refetch whenever EventKit broadcasts a change. The backend installs
  // the observer once at startup; we just listen for the rebroadcast.
  useEffect(() => {
    if (!isAuthorized(auth)) return;
    let active = true;
    let unlisten: (() => void) | null = null;
    void onCalendarChanged(() => {
      if (active) void loadAll();
    }).then((fn) => {
      if (!active) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [auth, loadAll]);

  const calendarsBySource = useMemo(() => {
    const map = new Map<string, Calendar[]>();
    for (const c of calendars) {
      const arr = map.get(c.sourceId) ?? [];
      arr.push(c);
      map.set(c.sourceId, arr);
    }
    return map;
  }, [calendars]);

  const calendarsById = useMemo(() => {
    const map = new Map<string, Calendar>();
    for (const c of calendars) map.set(c.id, c);
    return map;
  }, [calendars]);

  const visibleEvents = useMemo(
    () => events.filter((e) => selectedCalendarIds.has(e.calendarId)),
    [events, selectedCalendarIds],
  );

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of visibleEvents) {
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
  }, [visibleEvents]);

  const toggleCalendar = (id: string) => {
    setSelectedCalendarIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const requestAccess = async () => {
    setErrorMessage(null);
    try {
      const next = await calendarRequestAccess();
      setAuth(next);
    } catch (err) {
      setErrorMessage(String(err));
    }
  };

  if (auth === "notDetermined") {
    return <PermissionGate onRequest={requestAccess} error={errorMessage} />;
  }
  if (auth === "denied" || auth === "restricted") {
    return <PermissionBlocked status={auth} />;
  }

  return (
    <section className="panel-shell">
      <header className="panel-shell__header">
        <div className="panel-shell__titleblock">
          <h1 className="panel-shell__title">Calendar</h1>
          <p className="panel-shell__description">
            {sources.length} {sources.length === 1 ? "account" : "accounts"} ·{" "}
            {calendars.length}{" "}
            {calendars.length === 1 ? "calendar" : "calendars"} · next{" "}
            {RANGE_DAYS} days
          </p>
        </div>
      </header>
      <div className="panel-shell__body grid grid-cols-[240px_1fr] gap-4">
        <SourceSidebar
          sources={sources}
          calendarsBySource={calendarsBySource}
          selected={selectedCalendarIds}
          onToggle={toggleCalendar}
        />
        <EventsPane
          loadState={loadState}
          errorMessage={errorMessage}
          eventsByDay={eventsByDay}
          calendarsById={calendarsById}
          rangeDays={RANGE_DAYS}
        />
      </div>
    </section>
  );
}

function PermissionGate({
  onRequest,
  error,
}: {
  onRequest: () => void;
  error: string | null;
}) {
  return (
    <section className="surface-card" aria-labelledby="calendar-gate-title">
      <header>
        <h1
          id="calendar-gate-title"
          className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]"
        >
          Connect your calendars
        </h1>
        <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">
          We read directly from macOS Calendar — every account you've already
          added in System Settings (iCloud, Outlook, Google, CalDAV) shows up
          automatically. No separate sign-in.
        </p>
      </header>
      <p className="text-[13px] text-text-secondary">
        macOS will show a one-time permission prompt. You can revoke it any
        time in System Settings → Privacy &amp; Security → Calendars.
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn btn--primary" onClick={onRequest}>
          Allow calendar access
        </button>
      </div>
      {error ? (
        <p className="mt-3 text-[12.5px] text-text-danger">{error}</p>
      ) : null}
    </section>
  );
}

function PermissionBlocked({ status }: { status: CalendarAuthorizationStatus }) {
  const reason =
    status === "restricted"
      ? "Calendar access is restricted on this device — usually by an MDM profile."
      : "Calendar access was denied.";
  return (
    <section className="surface-card" aria-live="polite">
      <header>
        <h1 className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]">
          Calendar access blocked
        </h1>
        <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">{reason}</p>
      </header>
      <p className="text-[13px] text-text-secondary">
        Open System Settings → Privacy &amp; Security → Calendars and enable
        access for <strong>Jinnkunn Workspace</strong>, then relaunch the app.
      </p>
    </section>
  );
}

function SourceSidebar({
  sources,
  calendarsBySource,
  selected,
  onToggle,
}: {
  sources: CalendarSource[];
  calendarsBySource: Map<string, Calendar[]>;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <aside
      className="overflow-y-auto pr-2 -mr-2"
      aria-label="Calendar sources"
    >
      {sources.length === 0 ? (
        <p className="text-[12.5px] text-text-muted">
          No accounts found. Add one in System Settings → Internet Accounts.
        </p>
      ) : null}
      {sources.map((src) => {
        const cals = calendarsBySource.get(src.id) ?? [];
        if (cals.length === 0) return null;
        return (
          <section key={src.id} className="mb-4">
            <h2 className="m-0 mb-1.5 text-[10.5px] uppercase tracking-[0.06em] font-semibold text-text-muted">
              {src.title}
            </h2>
            <ul className="m-0 p-0 list-none flex flex-col gap-0.5">
              {cals.map((cal) => (
                <li key={cal.id}>
                  <label className="flex items-center gap-2 px-1.5 py-1 rounded text-[12.5px] text-text-primary hover:bg-bg-surface-alt cursor-pointer">
                    <input
                      type="checkbox"
                      className="accent-current"
                      style={{ accentColor: cal.colorHex }}
                      checked={selected.has(cal.id)}
                      onChange={() => onToggle(cal.id)}
                    />
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
                      style={{ background: cal.colorHex }}
                      aria-hidden="true"
                    />
                    <span className="truncate">{cal.title}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </aside>
  );
}

function EventsPane({
  loadState,
  errorMessage,
  eventsByDay,
  calendarsById,
  rangeDays,
}: {
  loadState: LoadState;
  errorMessage: string | null;
  eventsByDay: [string, CalendarEvent[]][];
  calendarsById: Map<string, Calendar>;
  rangeDays: number;
}) {
  if (loadState === "loading" && eventsByDay.length === 0) {
    return (
      <div className="text-[12.5px] text-text-muted" role="status">
        Loading events…
      </div>
    );
  }
  if (loadState === "error") {
    return (
      <div className="text-[12.5px] text-text-danger" role="alert">
        Failed to load events: {errorMessage}
      </div>
    );
  }
  if (eventsByDay.length === 0) {
    return (
      <div className="text-[12.5px] text-text-muted">
        No events in the next {rangeDays} days for the selected calendars.
      </div>
    );
  }
  return (
    <div className="overflow-y-auto pr-2 -mr-2 flex flex-col gap-4">
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
