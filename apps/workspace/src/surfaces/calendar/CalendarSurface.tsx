import { useCallback, useEffect, useMemo, useState } from "react";

import { AgendaView } from "./AgendaView";
import {
  calendarAuthorizationStatus,
  calendarFetchEvents,
  calendarListCalendars,
  calendarListSources,
  calendarRequestAccess,
  onCalendarChanged,
} from "./api";
import {
  formatViewTitle,
  rangeForView,
  startOfDay,
  type ViewKind,
} from "./dateRange";
import { DateNav } from "./DateNav";
import { DayView } from "./DayView";
import { MonthView } from "./MonthView";
import { SourceSidebar } from "./SourceSidebar";
import type {
  Calendar,
  CalendarAuthorizationStatus,
  CalendarEvent,
  CalendarSource,
} from "./types";
import { ViewSwitcher } from "./ViewSwitcher";
import { WeekView } from "./WeekView";

type LoadState = "idle" | "loading" | "ready" | "error";

function isAuthorized(status: CalendarAuthorizationStatus): boolean {
  return status === "fullAccess" || status === "writeOnly";
}

/** Top-level orchestrator. Owns the auth handshake, the
 * sources/calendars/events data fetch, and the active view +
 * navigation anchor. Each rendered view (Day / Week / Month / Agenda)
 * is a thin presentation component over the same event list. */
export function CalendarSurface() {
  const [view, setView] = useState<ViewKind>("week");
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));

  const [auth, setAuth] = useState<CalendarAuthorizationStatus>("notDetermined");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sources, setSources] = useState<CalendarSource[]>([]);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<Set<string>>(
    new Set(),
  );
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  // Refetch whenever the user pages forward/back or switches view —
  // each combination implies a different EventKit query window.
  const range = useMemo(() => rangeForView(view, anchor), [view, anchor]);

  // Read authorization status (no prompt) on mount.
  useEffect(() => {
    let cancelled = false;
    void calendarAuthorizationStatus()
      .then((s) => {
        if (!cancelled) setAuth(s);
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
      // Select-all the first time we see calendars; preserve any prior
      // user choice on subsequent reloads.
      setSelectedCalendarIds((prev) =>
        prev.size === 0 ? new Set(cal.map((c) => c.id)) : prev,
      );
      const evs = await calendarFetchEvents({
        startsAt: range.startsAt,
        endsAt: range.endsAt,
        calendarIds: [],
      });
      setEvents(evs);
      setLoadState("ready");
    } catch (err) {
      setLoadState("error");
      setErrorMessage(String(err));
    }
  }, [range]);

  useEffect(() => {
    if (!isAuthorized(auth)) return;
    // Initial EventKit hydration is an async external sync; loadAll awaits
    // native APIs before committing state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAll();
  }, [auth, loadAll]);

  // Re-subscribe to EventKit changes whenever loadAll's identity
  // changes (i.e. when range changes); the listener captures the
  // current range via its closure.
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
    // panel-shell normally lets its content overflow up into the App's
    // <main>, which auto-scrolls. For the calendar we want the time
    // grid to scroll internally instead — so we lock the shell to the
    // available <main> height (flex:1 + min-height:0) and clip the
    // body, then let `WeekView` / `DayView` own a single inner scroller.
    <section className="panel-shell" style={{ flex: 1, minHeight: 0 }}>
      <header className="panel-shell__header">
        <div className="flex items-center justify-between flex-wrap gap-2 w-full">
          <DateNav view={view} anchor={anchor} onAnchorChange={setAnchor} />
          <ViewSwitcher view={view} onChange={setView} />
        </div>
      </header>
      <div
        className="panel-shell__body flex flex-1 min-h-0 overflow-hidden"
      >
        {/* Wrap the whole sidebar+timeline in the same `surface-card`
         * site-admin uses, so the calendar reads as a single bordered
         * panel sitting above the window's vibrancy. We zero the
         * card's padding (the time grid wants to hit the edges) and
         * push internal padding into the sidebar instead. */}
        <section
          className="surface-card"
          style={{
            flex: 1,
            minHeight: 0,
            padding: 0,
            gap: 0,
            overflow: "hidden",
          }}
        >
          <div className="grid grid-cols-[220px_1fr] flex-1 min-h-0">
            <SourceSidebar
              sources={sources}
              calendarsBySource={calendarsBySource}
              selected={selectedCalendarIds}
              onToggle={toggleCalendar}
            />
            <ViewPane
              view={view}
              anchor={anchor}
              events={visibleEvents}
              calendarsById={calendarsById}
              loadState={loadState}
              errorMessage={errorMessage}
            />
          </div>
        </section>
      </div>
    </section>
  );
}

function ViewPane({
  view,
  anchor,
  events,
  calendarsById,
  loadState,
  errorMessage,
}: {
  view: ViewKind;
  anchor: Date;
  events: CalendarEvent[];
  calendarsById: Map<string, Calendar>;
  loadState: LoadState;
  errorMessage: string | null;
}) {
  if (loadState === "error") {
    return (
      <div className="text-[12.5px] text-text-danger px-1" role="alert">
        Failed to load events: {errorMessage}
      </div>
    );
  }
  // First load with no data yet — show a message so the pane isn't
  // blank. Subsequent loads keep prior data visible so view switches
  // don't flicker.
  if (loadState === "loading" && events.length === 0) {
    return (
      <div className="text-[12.5px] text-text-muted px-1" role="status">
        Loading events…
      </div>
    );
  }

  switch (view) {
    case "day":
      return (
        <DayView day={anchor} events={events} calendarsById={calendarsById} />
      );
    case "week":
      return (
        <WeekView
          anchor={anchor}
          events={events}
          calendarsById={calendarsById}
        />
      );
    case "month":
      return (
        <MonthView
          anchor={anchor}
          events={events}
          calendarsById={calendarsById}
        />
      );
    case "agenda":
      return (
        <AgendaView
          events={events}
          calendarsById={calendarsById}
          rangeLabel={formatViewTitle("agenda", anchor)}
        />
      );
  }
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
          We read directly from macOS Calendar — every account you&apos;ve already
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
