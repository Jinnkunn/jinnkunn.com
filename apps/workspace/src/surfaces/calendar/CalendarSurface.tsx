import { useCallback, useEffect, useMemo, useState } from "react";

import {
  WorkspaceCheckboxField,
  WorkspaceInspector,
  WorkspaceInspectorHeader,
  WorkspaceInspectorSection,
  WorkspaceSelectField,
  WorkspaceSurfaceFrame,
  WorkspaceTextareaField,
  WorkspaceTextField,
} from "../../ui/primitives";
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
import {
  buildPublicCalendarPayload,
  calendarEventKey,
  loadCalendarPublishMetadata,
  metadataForEvent,
  saveCalendarPublishMetadata,
  updateMetadataForEvent,
  type CalendarPublishMetadataStore,
  type CalendarPublicVisibility,
} from "./publicProjection";
import { publishPublicCalendarSnapshot } from "./siteAdminBridge";
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
type PublishState = "idle" | "publishing" | "success" | "error";

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
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [publishMetadata, setPublishMetadata] =
    useState<CalendarPublishMetadataStore>(() => loadCalendarPublishMetadata());
  const [publishState, setPublishState] = useState<PublishState>("idle");
  const [publishMessage, setPublishMessage] = useState<string>("");

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

  const publicEventCount = useMemo(
    () =>
      visibleEvents.filter(
        (event) => metadataForEvent(publishMetadata, event).visibility !== "hidden",
      ).length,
    [publishMetadata, visibleEvents],
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

  const updateSelectedMetadata = useCallback(
    (patch: Parameters<typeof updateMetadataForEvent>[2]) => {
      if (!selectedEvent) return;
      setPublishMetadata((prev) => {
        const next = updateMetadataForEvent(prev, selectedEvent, patch);
        saveCalendarPublishMetadata(next);
        return next;
      });
    },
    [selectedEvent],
  );

  const publishSnapshot = useCallback(async () => {
    if (!isAuthorized(auth)) return;
    setPublishState("publishing");
    setPublishMessage("");
    const starts = startOfDay(new Date());
    const ends = new Date(starts);
    ends.setFullYear(ends.getFullYear() + 1);
    const publishWindow = {
      startsAt: starts.toISOString(),
      endsAt: ends.toISOString(),
    };
    try {
      const snapshotEvents = await calendarFetchEvents({
        ...publishWindow,
        calendarIds: [...selectedCalendarIds],
      });
      const mergedEvents = mergeCalendarEvents(snapshotEvents, visibleEvents);
      const projectedRange = {
        startsAt:
          Date.parse(range.startsAt) < Date.parse(publishWindow.startsAt)
            ? range.startsAt
            : publishWindow.startsAt,
        endsAt:
          Date.parse(range.endsAt) > Date.parse(publishWindow.endsAt)
            ? range.endsAt
            : publishWindow.endsAt,
      };
      const payload = buildPublicCalendarPayload({
        events: mergedEvents,
        calendarsById,
        metadata: publishMetadata,
        range: projectedRange,
      });
      const result = await publishPublicCalendarSnapshot(payload);
      if (!result.ok) {
        setPublishState("error");
        setPublishMessage(`Publish failed via ${result.baseUrl}: ${result.error}`);
        return;
      }
      setPublishState("success");
      setPublishMessage(
        `Published ${payload.events.length} public events to ${result.baseUrl}. Included current view plus the next 12 months. Save SHA ${result.fileSha.slice(0, 8) || "updated"}.`,
      );
    } catch (err) {
      setPublishState("error");
      setPublishMessage(`Publish failed: ${String(err)}`);
    }
  }, [
    auth,
    calendarsById,
    publishMetadata,
    range.endsAt,
    range.startsAt,
    selectedCalendarIds,
    visibleEvents,
  ]);

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
    <WorkspaceSurfaceFrame
      className="panel-shell"
      style={{ flex: 1, minHeight: 0 }}
    >
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
          <div
            className="grid flex-1 min-h-0"
            style={{
              gridTemplateColumns: selectedEvent
                ? "220px minmax(0, 1fr) minmax(280px, 340px)"
                : "220px minmax(0, 1fr)",
            }}
          >
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
              onEventSelect={setSelectedEvent}
            />
            {selectedEvent ? (
              <CalendarEventInspector
                event={selectedEvent}
                calendar={calendarsById.get(selectedEvent.calendarId)}
                metadata={metadataForEvent(publishMetadata, selectedEvent)}
                publicEventCount={publicEventCount}
                publishMessage={publishMessage}
                publishState={publishState}
                onClose={() => setSelectedEvent(null)}
                onMetadataChange={updateSelectedMetadata}
                onPublish={publishSnapshot}
              />
            ) : null}
          </div>
        </section>
      </div>
    </WorkspaceSurfaceFrame>
  );
}

function ViewPane({
  view,
  anchor,
  events,
  calendarsById,
  loadState,
  errorMessage,
  onEventSelect,
}: {
  view: ViewKind;
  anchor: Date;
  events: CalendarEvent[];
  calendarsById: Map<string, Calendar>;
  loadState: LoadState;
  errorMessage: string | null;
  onEventSelect: (event: CalendarEvent) => void;
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
        <DayView
          day={anchor}
          events={events}
          calendarsById={calendarsById}
          onEventSelect={onEventSelect}
        />
      );
    case "week":
      return (
        <WeekView
          anchor={anchor}
          events={events}
          calendarsById={calendarsById}
          onEventSelect={onEventSelect}
        />
      );
    case "month":
      return (
        <MonthView
          anchor={anchor}
          events={events}
          calendarsById={calendarsById}
          onEventSelect={onEventSelect}
        />
      );
    case "agenda":
      return (
        <AgendaView
          events={events}
          calendarsById={calendarsById}
          rangeLabel={formatViewTitle("agenda", anchor)}
          onEventSelect={onEventSelect}
        />
      );
  }
}

function mergeCalendarEvents(
  primary: CalendarEvent[],
  secondary: CalendarEvent[],
): CalendarEvent[] {
  const seen = new Set<string>();
  const out: CalendarEvent[] = [];
  for (const event of [...primary, ...secondary]) {
    const key = `${calendarEventKey(event)}::${event.startsAt}::${event.endsAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}

function CalendarEventInspector({
  event,
  calendar,
  metadata,
  publicEventCount,
  publishMessage,
  publishState,
  onClose,
  onMetadataChange,
  onPublish,
}: {
  event: CalendarEvent;
  calendar: Calendar | undefined;
  metadata: {
    visibility: CalendarPublicVisibility;
    titleOverride?: string;
    descriptionOverride?: string;
    locationOverride?: string;
    urlOverride?: string;
  };
  publicEventCount: number;
  publishMessage: string;
  publishState: PublishState;
  onClose: () => void;
  onMetadataChange: (patch: Partial<typeof metadata>) => void;
  onPublish: () => void;
}) {
  const showPublicFields = metadata.visibility === "titleOnly" || metadata.visibility === "full";
  const showDetailsFields = metadata.visibility === "full";
  return (
    <WorkspaceInspector
      className="calendar-inspector"
      label="Calendar event publishing"
      style={{
        borderTop: 0,
        borderRight: 0,
        borderBottom: 0,
        borderRadius: 0,
        padding: "14px",
      }}
    >
      <WorkspaceInspectorHeader
        heading={event.title || "(No title)"}
        kicker={calendar?.title ?? "Calendar event"}
        actions={
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        }
      />
      <div className="workspace-inspector__body">
        <WorkspaceInspectorSection heading="Event">
          <dl className="workspace-inspector__meta">
            <div>
              <dt>Time</dt>
              <dd>{event.isAllDay ? "All day" : `${formatDateTime(event.startsAt)} - ${formatDateTime(event.endsAt)}`}</dd>
            </div>
            {event.location ? (
              <div>
                <dt>Location</dt>
                <dd>{event.location}</dd>
              </div>
            ) : null}
            <div>
              <dt>Key</dt>
              <dd>
                <code>{calendarEventKey(event)}</code>
              </dd>
            </div>
          </dl>
        </WorkspaceInspectorSection>
        <WorkspaceInspectorSection
          heading="Website"
          description="Only this sanitized projection is sent to the public site."
        >
          <WorkspaceSelectField
            label="Public visibility"
            value={metadata.visibility}
            onChange={(e) =>
              onMetadataChange({
                visibility: e.currentTarget.value as CalendarPublicVisibility,
              })
            }
          >
            <option value="hidden">Hidden</option>
            <option value="busy">Busy only</option>
            <option value="titleOnly">Title only</option>
            <option value="full">Full details</option>
          </WorkspaceSelectField>
          {showPublicFields ? (
            <WorkspaceTextField
              label="Public title override"
              placeholder={event.title || "(No title)"}
              value={metadata.titleOverride ?? ""}
              onChange={(e) => onMetadataChange({ titleOverride: e.currentTarget.value })}
            />
          ) : null}
          {showDetailsFields ? (
            <>
              <WorkspaceTextareaField
                label="Public description"
                placeholder={event.notes ?? "Uses event notes when empty"}
                rows={4}
                value={metadata.descriptionOverride ?? ""}
                onChange={(e) =>
                  onMetadataChange({ descriptionOverride: e.currentTarget.value })
                }
              />
              <WorkspaceTextField
                label="Public location"
                placeholder={event.location ?? ""}
                value={metadata.locationOverride ?? ""}
                onChange={(e) =>
                  onMetadataChange({ locationOverride: e.currentTarget.value })
                }
              />
              <WorkspaceTextField
                label="Public URL"
                placeholder={event.url ?? ""}
                value={metadata.urlOverride ?? ""}
                onChange={(e) => onMetadataChange({ urlOverride: e.currentTarget.value })}
              />
            </>
          ) : null}
          <WorkspaceCheckboxField
            checked={metadata.visibility !== "hidden"}
            onChange={(e) =>
              onMetadataChange({
                visibility: e.currentTarget.checked ? "busy" : "hidden",
              })
            }
            hint="Busy events publish only the blocked time. Hidden events are never written into content/calendar-public.json."
          >
            Include this event on /calendar
          </WorkspaceCheckboxField>
        </WorkspaceInspectorSection>
        <WorkspaceInspectorSection heading="Publish">
          <p className="m-0 text-[12px] text-text-muted">
            {publicEventCount} visible events in the current view will appear on
            /calendar. Unconfigured events publish as Busy by default, with no
            title, notes, location, or URL.
          </p>
          <button
            type="button"
            className="btn btn--primary"
            disabled={publishState === "publishing"}
            onClick={onPublish}
          >
            {publishState === "publishing" ? "Publishing..." : "Publish calendar snapshot"}
          </button>
          {publishMessage ? (
            <p
              className={
                publishState === "error"
                  ? "m-0 text-[12px] text-text-danger"
                  : "m-0 text-[12px] text-text-muted"
              }
            >
              {publishMessage}
            </p>
          ) : null}
        </WorkspaceInspectorSection>
      </div>
    </WorkspaceInspector>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
