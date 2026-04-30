import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSurfaceNav } from "../../shell/surface-nav-context";
import {
  WorkspaceCommandBar,
  WorkspaceCommandButton,
  WorkspaceCommandGroup,
  WorkspaceCheckboxField,
  WorkspaceInspector,
  WorkspaceInspectorHeader,
  WorkspaceInspectorSection,
  WorkspaceSelectField,
  WorkspaceSplitView,
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
  navigateView,
  rangeForView,
  startOfDay,
  type ViewKind,
} from "./dateRange";
import { DateNav } from "./DateNav";
import { DayView } from "./DayView";
import type { EventDisclosureResolver } from "./types";
import { MonthView } from "./MonthView";
import {
  buildPublicCalendarPayload,
  resolveVisibility,
  type ResolvedVisibility,
  calendarEventKey,
  metadataForEvent,
  emptyMetadataStore,
  updateMetadataForEvent,
  type CalendarPublishMetadataStore,
  type CalendarPublicVisibility,
} from "./publicProjection";
import {
  loadCalendarPublishRules,
  saveCalendarPublishRules,
} from "./publishRulesStore";
import { syncPublicCalendarProjection } from "./siteAdminBridge";
import { SourceSidebar } from "./SourceSidebar";
import type {
  Calendar,
  CalendarAuthorizationStatus,
  CalendarEvent,
  CalendarSource,
} from "./types";
import { ViewSwitcher } from "./ViewSwitcher";
import {
  loadCalendarDefaultRules,
  saveCalendarDefaultRules,
} from "./calendarDefaults";
import { resolveSmartDefault } from "./smartDefaults";
import { EventComposer } from "./EventComposer";
import { SmartRulesEditor } from "./SmartRulesEditor";
import {
  diffSnapshots,
  loadSyncSnapshot,
  saveSyncSnapshot,
  type SnapshotEventEntry,
} from "./syncSnapshot";
import {
  loadVisibilityPrefs,
  reconcileVisibility,
  saveVisibilityPrefs,
} from "./visibilityPrefs";
import { WeekView } from "./WeekView";
import {
  todosList,
  todosUpdate,
  type TodoRow,
} from "../../modules/todos/api";

type LoadState = "idle" | "loading" | "ready" | "error";
type PublishState = "idle" | "publishing" | "success" | "error";
type PublishSummary = Record<CalendarPublicVisibility, number>;
type CalendarSyncReason = "auto" | "manual";
type CalendarSyncHealth = {
  lastSyncedAt: string | null;
  eventCount: number;
  baseUrl: string;
  fileSha: string;
  reason: CalendarSyncReason | null;
  error: string | null;
};

function isAuthorized(status: CalendarAuthorizationStatus): boolean {
  return status === "fullAccess" || status === "writeOnly";
}

/** Top-level orchestrator. Owns the auth handshake, the
 * sources/calendars/events data fetch, and the active view +
 * navigation anchor. Each rendered view (Day / Week / Month / Agenda)
 * is a thin presentation component over the same event list. */
export function CalendarSurface() {
  const { setContextAccessory } = useSurfaceNav();
  const [view, setView] = useState<ViewKind>("week");
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));

  const [auth, setAuth] = useState<CalendarAuthorizationStatus>("notDetermined");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sources, setSources] = useState<CalendarSource[]>([]);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  // Hydrate the visibility set from localStorage on first render so a
  // restart lands on the operator's last selection instead of the
  // empty-Set placeholder. The reconcile-on-load step in `loadAll`
  // adds any net-new calendar ids (created in Apple Calendar.app
  // since last launch) as visible-by-default — without that, brand-
  // new calendars would be silently invisible.
  const [persistedVisibility] = useState(() => loadVisibilityPrefs());
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<Set<string>>(
    () => new Set(persistedVisibility?.visible ?? []),
  );
  const knownCalendarIdsRef = useRef<Set<string>>(
    new Set(persistedVisibility?.knownIds ?? []),
  );
  // Per-calendar default visibility rules. Map keys are calendar IDs;
  // values are the default visibility applied to every event in that
  // calendar that doesn't already carry a per-event override. Loaded
  // synchronously from localStorage on first render so the resolver
  // sees them on the very first projection pass.
  const [calendarDefaults, setCalendarDefaults] = useState<
    Map<string, CalendarPublicVisibility>
  >(() => loadCalendarDefaultRules());
  const setCalendarDefault = useCallback(
    (calendarId: string, visibility: CalendarPublicVisibility) => {
      setCalendarDefaults((prev) => {
        const next = new Map(prev);
        next.set(calendarId, visibility);
        saveCalendarDefaultRules(next);
        return next;
      });
    },
    [],
  );
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  // Todos overlaid on the timeline (Day / Week views) and folded into
  // the Agenda list. Loaded once at mount + after every toggle so the
  // overlay stays in sync without subscribing to a Tauri event we
  // haven't built yet.
  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [publishMetadata, setPublishMetadata] =
    useState<CalendarPublishMetadataStore>(() => emptyMetadataStore());
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [publishState, setPublishState] = useState<PublishState>("idle");
  const [publishMessage, setPublishMessage] = useState<string>("");
  const [calendarChangeRevision, setCalendarChangeRevision] = useState(0);
  const [syncHealth, setSyncHealth] = useState<CalendarSyncHealth>({
    lastSyncedAt: null,
    eventCount: 0,
    baseUrl: "",
    fileSha: "",
    reason: null,
    error: null,
  });
  const lastAutoSyncKeyRef = useRef("");
  const initializedVisibleCalendarsRef = useRef(false);

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

  useEffect(() => {
    let cancelled = false;
    void loadCalendarPublishRules().then((store) => {
      if (cancelled) return;
      setPublishMetadata(store);
      setRulesLoaded(true);
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
      // Reconcile loaded calendars against persisted visibility:
      //   - First launch (no persisted entry) → all loaded calendars
      //     default to visible, mirroring the historical select-all
      //     behaviour the operator expects.
      //   - Subsequent launches → keep the operator's saved choices,
      //     plus any net-new calendar id (one we hadn't seen on a
      //     previous load) defaults to visible. That way adding a
      //     fresh calendar in Apple Calendar.app shows up immediately
      //     without the operator hunting for its toggle.
      // App visibility and public-site publishing stay independent:
      // hiding a calendar in the workspace must NOT remove it from
      // the public /calendar projection. Public inclusion is driven
      // by each calendar's default visibility: Hidden excludes it;
      // Busy / Title / Full include it.
      const loadedIds = cal.map((c) => c.id);
      const reconciled = reconcileVisibility(
        loadedIds,
        initializedVisibleCalendarsRef.current
          ? {
              visible: selectedCalendarIds,
              knownIds: knownCalendarIdsRef.current,
            }
          : persistedVisibility,
      );
      setSelectedCalendarIds(reconciled.visible);
      knownCalendarIdsRef.current = reconciled.knownIds;
      saveVisibilityPrefs(reconciled);
      initializedVisibleCalendarsRef.current = true;
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
    // `persistedVisibility` is a one-time-loaded snapshot of
    // localStorage captured at first render — passing it as a dep
    // would re-arm `loadAll` on every render even though the snapshot
    // never changes. `selectedCalendarIds` is intentionally read via
    // its setter callback (the reconcile branch uses `prev` semantics
    // through the ref-backed `knownCalendarIdsRef`) so we don't want
    // its identity changes to re-arm load either.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  useEffect(() => {
    if (!isAuthorized(auth)) return;
    // Initial EventKit hydration is an async external sync; loadAll awaits
    // native APIs before committing state.
    void loadAll();
  }, [auth, loadAll]);

  // Todos load independently of EventKit auth — they live in workspace.db
  // and are always available. Re-fetch on mount; toggle handler keeps
  // local state in sync between fetches via optimistic update.
  useEffect(() => {
    let cancelled = false;
    todosList()
      .then((next) => {
        if (!cancelled) setTodos(next);
      })
      .catch(() => {
        // Quiet failure — todos are an overlay, not core to the calendar
        // surface. The Todos surface itself surfaces real errors.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleTodoToggle = useCallback(
    (id: string, completed: boolean) => {
      // Optimistic update so the chip flips immediately; the reconcile
      // step replaces with the server-canonical row (sets completedAt
      // timestamp / clears it on uncheck).
      const optimisticAt = completed ? Date.now() : null;
      setTodos((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, completedAt: optimisticAt } : t,
        ),
      );
      void todosUpdate({ id, completed })
        .then((updated) => {
          setTodos((prev) => prev.map((t) => (t.id === id ? updated : t)));
        })
        .catch(() => {
          // Roll back the optimistic toggle if the backend rejected.
          setTodos((prev) =>
            prev.map((t) =>
              t.id === id
                ? { ...t, completedAt: completed ? null : optimisticAt }
                : t,
            ),
          );
        });
    },
    [],
  );

  // Re-subscribe to EventKit changes whenever loadAll's identity
  // changes (i.e. when range changes); the listener captures the
  // current range via its closure.
  useEffect(() => {
    if (!isAuthorized(auth)) return;
    let active = true;
    let unlisten: (() => void) | null = null;
    void onCalendarChanged(() => {
      if (active) {
        setCalendarChangeRevision((revision) => revision + 1);
        void loadAll();
      }
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

  // Cmd+N (macOS) / Ctrl+N opens the event composer — matches the
  // Apple Calendar keyboard convention. Skipped when a dialog is
  // already open (composer or rules editor) so we don't toggle it
  // shut on a second press, and skipped when the focus is inside an
  // editable input so the operator's typing isn't hijacked.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "n" && event.key !== "N") return;
      if (!event.metaKey && !event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      const isEditable =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (isEditable) return;
      event.preventDefault();
      setComposerOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Bridge native AppKit menubar → calendar actions. The `useNativeMenu`
  // hook (mounted in App.tsx) re-broadcasts every menu selection as a
  // `workspace:menu` CustomEvent; we filter to the calendar ids and
  // dispatch into the same setters the toolbar uses. The listener is
  // active whenever the calendar surface is mounted.
  useEffect(() => {
    function onMenu(event: Event) {
      const id = (event as CustomEvent<{ id: string }>).detail?.id;
      if (!id) return;
      switch (id) {
        case "menu-new-event":
          setComposerOpen(true);
          break;
        case "menu-cal-today":
          setAnchor(startOfDay(new Date()));
          break;
        case "menu-cal-prev":
          setAnchor((current) => navigateView(view, current, -1));
          break;
        case "menu-cal-next":
          setAnchor((current) => navigateView(view, current, 1));
          break;
        case "menu-cal-day":
          setView("day");
          break;
        case "menu-cal-week":
          setView("week");
          break;
        case "menu-cal-month":
          setView("month");
          break;
        case "menu-cal-agenda":
          setView("agenda");
          break;
        default:
          break;
      }
    }
    window.addEventListener("workspace:menu", onMenu);
    return () => window.removeEventListener("workspace:menu", onMenu);
  }, [view]);

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

  const [searchQuery, setSearchQuery] = useState("");
  // Separate event pool used only when the search box has a query —
  // pulls a much wider date range (±180 days from anchor) than the
  // current view so "office hours" matches across the year, not just
  // this week. Empty when search is inactive so the normal `events`
  // pool is what feeds the visible-events memo.
  const [searchEvents, setSearchEvents] = useState<CalendarEvent[]>([]);
  const [searchEventsLoading, setSearchEventsLoading] = useState(false);
  // Wide-range fetch for the search box. Fires when the operator has
  // typed ≥2 characters; idle otherwise so we don't burn an EventKit
  // round-trip on every keystroke. Range is ±180 days from the
  // current anchor — comfortably covers a full academic year for
  // "find that talk last March" / "next semester's office hours" use
  // cases without paying for a multi-year scan on every keystroke.
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      // Reset so a stale large pool doesn't quietly hang around when
      // the operator clears the box.
      setSearchEvents([]);
      setSearchEventsLoading(false);
      return;
    }
    if (!isAuthorized(auth)) return;
    let cancelled = false;
    const debounce = window.setTimeout(async () => {
      const startsAt = new Date(anchor.getTime() - 180 * 86_400_000).toISOString();
      const endsAt = new Date(anchor.getTime() + 180 * 86_400_000).toISOString();
      setSearchEventsLoading(true);
      try {
        const wide = await calendarFetchEvents({
          startsAt,
          endsAt,
          calendarIds: [],
        });
        if (!cancelled) setSearchEvents(wide);
      } catch {
        if (!cancelled) setSearchEvents([]);
      } finally {
        if (!cancelled) setSearchEventsLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(debounce);
    };
    // `anchor` intentionally NOT a dep — re-fetching on every nav
    // click would trash the search results. The wide window is
    // anchored at first-search time, which is fine for a session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, searchQuery]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [rulesEditorOpen, setRulesEditorOpen] = useState(false);
  // Bumped after the operator saves edited rules; resolver memos
  // depend on it so the next render re-classifies events using the
  // freshly-loaded rule sheet without needing a full reload.
  const [smartRulesRevision, setSmartRulesRevision] = useState(0);
  // Snapshot of the last successful sync — used to diff "what's
  // about to publish" before the operator clicks Sync. Lazy init
  // from localStorage so a first-load surface immediately shows
  // accurate diff counts.
  const [lastSyncSnapshot, setLastSyncSnapshot] = useState(() =>
    loadSyncSnapshot(),
  );
  const visibleEvents = useMemo(() => {
    const trimmed = searchQuery.trim().toLowerCase();
    // When search is active, draw from the wider `searchEvents` pool
    // so a query for "office hours" finds matches across ±180 days,
    // not just the current week. The calendar filter still applies
    // (hidden calendars stay hidden in search results too).
    const source =
      trimmed.length > 0 && searchEvents.length > 0 ? searchEvents : events;
    const calendarFiltered = source.filter((e) =>
      selectedCalendarIds.has(e.calendarId),
    );
    if (trimmed.length === 0) return calendarFiltered;
    // Substring match on title + location + notes. The search box
    // pairs with the existing visibility filter, not replaces it —
    // hidden calendars stay hidden even if a query matches them, so
    // the result set is "everything visible AND matching".
    return calendarFiltered.filter((event) => {
      if (event.title.toLowerCase().includes(trimmed)) return true;
      if (event.location && event.location.toLowerCase().includes(trimmed)) return true;
      if (event.notes && event.notes.toLowerCase().includes(trimmed)) return true;
      return false;
    });
  }, [events, searchEvents, searchQuery, selectedCalendarIds]);
  const publishedEvents = events;

  const publishSummary = useMemo(
    () =>
      summarizePublishVisibility(
        publishedEvents,
        publishMetadata,
        calendarDefaults,
        resolveSmartDefault,
      ),
    // smartRulesRevision is a deliberate "invalidate me" bump from
    // the SmartRulesEditor; React's lint flags it as unnecessary
    // because resolveSmartDefault reads localStorage by itself, but
    // dropping it would mean saved rules don't take effect until
    // some other state change triggers a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calendarDefaults, publishMetadata, publishedEvents, smartRulesRevision],
  );

  // Project the events that WOULD publish on the next sync, then diff
  // against the last-synced snapshot so the toolbar can show "+3
  // added · 2 visibility changed · 1 removed". This is the same
  // pattern the promote-to-production button uses for code SHAs —
  // surface the upcoming change before the operator commits.
  const pendingSyncEntries = useMemo<SnapshotEventEntry[]>(() => {
    const entries: SnapshotEventEntry[] = [];
    for (const event of publishedEvents) {
      const meta = metadataForEvent(
        publishMetadata,
        event,
        calendarDefaults,
        resolveSmartDefault,
      );
      if (meta.visibility === "hidden") continue;
      entries.push({
        id: event.externalIdentifier || event.eventIdentifier,
        title: meta.titleOverride?.trim() || event.title || "(No title)",
        visibility: meta.visibility,
      });
    }
    return entries;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishedEvents, publishMetadata, calendarDefaults, smartRulesRevision]);

  const syncPreviewDiff = useMemo(
    () => diffSnapshots(pendingSyncEntries, lastSyncSnapshot?.events ?? []),
    [lastSyncSnapshot, pendingSyncEntries],
  );
  const hasPendingSyncChanges =
    lastSyncSnapshot === null ||
    syncPreviewDiff.added.length > 0 ||
    syncPreviewDiff.visibilityChanged.length > 0 ||
    syncPreviewDiff.removed.length > 0;
  const publicEventCount =
    publishSummary.busy + publishSummary.titleOnly + publishSummary.full;
  const getDisclosure = useCallback<EventDisclosureResolver>(
    (event) =>
      metadataForEvent(
        publishMetadata,
        event,
        calendarDefaults,
        resolveSmartDefault,
      ).visibility,
    // smartRulesRevision is intentionally in the deps list even
    // though `resolveSmartDefault` reads localStorage internally —
    // bumping it invalidates the memo so views re-render against
    // the freshly-saved rule sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calendarDefaults, publishMetadata, smartRulesRevision],
  );

  const toggleCalendar = useCallback((id: string) => {
    setSelectedCalendarIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Persist immediately so a window-close mid-session lands the
      // user's choice. Cheap (one localStorage.setItem with a small
      // JSON), no need to debounce.
      saveVisibilityPrefs({
        visible: next,
        knownIds: knownCalendarIdsRef.current,
      });
      return next;
    });
  }, []);

  const sourceSidebar = useMemo(
    () => (
      <SourceSidebar
        sources={sources}
        calendarsBySource={calendarsBySource}
        visible={selectedCalendarIds}
        calendarDefaults={calendarDefaults}
        onToggleVisible={toggleCalendar}
        onSetCalendarDefault={setCalendarDefault}
      />
    ),
    [
      calendarDefaults,
      calendarsBySource,
      selectedCalendarIds,
      setCalendarDefault,
      sources,
      toggleCalendar,
    ],
  );

  useEffect(() => {
    setContextAccessory(sourceSidebar);
    return () => setContextAccessory(null);
  }, [setContextAccessory, sourceSidebar]);

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
        void saveCalendarPublishRules(next).catch((err) => {
          setPublishState("error");
          setPublishMessage(`Failed to save calendar publish rule: ${String(err)}`);
        });
        return next;
      });
    },
    [selectedEvent],
  );

  const syncCalendarProjection = useCallback(async (reason: CalendarSyncReason) => {
    if (!rulesLoaded) return;
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
        calendarIds: [],
      });
      const mergedEvents = mergeCalendarEvents(snapshotEvents, events);
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
        calendarDefaults,
        smartResolver: resolveSmartDefault,
        range: projectedRange,
      });
      const result = await syncPublicCalendarProjection(payload);
      if (!result.ok) {
        setPublishState("error");
        setPublishMessage(`Calendar sync failed via ${result.baseUrl}: ${result.error}`);
        setSyncHealth((prev) => ({
          ...prev,
          baseUrl: result.baseUrl,
          error: result.error,
          reason,
        }));
        return;
      }
      setPublishState("success");
      // Persist a thin snapshot of the just-synced projection so the
      // next sync's preview can diff against it. We only store the
      // surface fields the diff needs (id + title + visibility), not
      // the full payload — the file-sha is the source of truth on
      // the server side.
      const snapshotEntries: SnapshotEventEntry[] = payload.events.map((entry) => ({
        id: entry.id,
        title: entry.title,
        visibility: entry.visibility,
      }));
      const snapshot = {
        syncedAt: new Date().toISOString(),
        events: snapshotEntries,
      };
      saveSyncSnapshot(snapshot);
      setLastSyncSnapshot(snapshot);
      setSyncHealth({
        lastSyncedAt: new Date().toISOString(),
        eventCount: payload.events.length,
        baseUrl: result.baseUrl,
        fileSha: result.fileSha,
        reason,
        error: null,
      });
      setPublishMessage(
        `${reason === "auto" ? "Auto-synced" : "Synced"} ${payload.events.length} public events to ${result.baseUrl}. The website calendar reads this projection dynamically. Save SHA ${result.fileSha.slice(0, 8) || "updated"}.`,
      );
    } catch (err) {
      setPublishState("error");
      setPublishMessage(`Calendar sync failed: ${String(err)}`);
      setSyncHealth((prev) => ({
        ...prev,
        error: String(err),
        reason,
      }));
    }
  }, [
    auth,
    calendarDefaults,
    calendarsById,
    publishMetadata,
    range.endsAt,
    range.startsAt,
    rulesLoaded,
    events,
  ]);

  const autoSyncKey = useMemo(
    () =>
      JSON.stringify({
        calendarDefaults: serializeCalendarDefaults(calendarDefaults),
        calendarChangeRevision,
        metadata: publishMetadata,
        rulesLoaded,
        loadState,
        smartRulesRevision,
      }),
    [
      calendarChangeRevision,
      calendarDefaults,
      loadState,
      publishMetadata,
      rulesLoaded,
      smartRulesRevision,
    ],
  );

  useEffect(() => {
    if (!rulesLoaded || loadState !== "ready" || !isAuthorized(auth)) return;
    if (calendarsById.size === 0) return;
    if (lastAutoSyncKeyRef.current === autoSyncKey) return;
    const id = window.setTimeout(() => {
      lastAutoSyncKeyRef.current = autoSyncKey;
      void syncCalendarProjection("auto");
    }, 2_000);
    return () => window.clearTimeout(id);
  }, [
    auth,
    autoSyncKey,
    calendarsById.size,
    loadState,
    rulesLoaded,
    syncCalendarProjection,
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
      <WorkspaceCommandBar
        className="calendar-commandbar"
        leading={
          <DateNav view={view} anchor={anchor} onAnchorChange={setAnchor} />
        }
        center={
          <ViewSwitcher view={view} onChange={setView} />
        }
        trailing={
          <WorkspaceCommandGroup
            align="end"
            className="calendar-commandbar__actions"
          >
            <WorkspaceCommandButton
              tone="ghost"
              onClick={() => setComposerOpen((open) => !open)}
              aria-pressed={composerOpen}
              title="Create a new event in macOS Calendar (Cmd+N from native)"
            >
              + Event
            </WorkspaceCommandButton>
            <WorkspaceCommandButton
              tone="ghost"
              onClick={() => setRulesEditorOpen((open) => !open)}
              aria-pressed={rulesEditorOpen}
              title="Edit smart visibility rules (regex → visibility)"
            >
              Rules
            </WorkspaceCommandButton>
            <WorkspaceCommandButton
              className="calendar-commandbar__sync-button"
              tone={hasPendingSyncChanges ? "accent" : "default"}
              disabled={publishState === "publishing" || !rulesLoaded}
              onClick={() => void syncCalendarProjection("manual")}
              title={
                lastSyncSnapshot
                  ? `Will publish: +${syncPreviewDiff.added.length} · ~${syncPreviewDiff.visibilityChanged.length} · -${syncPreviewDiff.removed.length}`
                  : "First sync - every published event will be added."
              }
            >
              {publishState === "publishing" ? "Syncing..." : "Sync now"}
            </WorkspaceCommandButton>
          </WorkspaceCommandGroup>
        }
      />
      <div className="calendar-commandbar__supplement">
        <div className="calendar-commandbar__secondary">
          <div className="calendar-search-wrapper">
            <input
              type="search"
              className="calendar-search-input"
              placeholder="Search events..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              aria-label="Search events"
              // The fetch widens to +/-180 days on a 300ms debounce;
              // see the search effect in the parent for the rationale.
            />
            {searchEventsLoading ? (
              <span
                className="calendar-search-pending"
                aria-live="polite"
                title="Loading wider event range for search"
              >
                ...
              </span>
            ) : null}
          </div>
          <WorkspaceCommandGroup
            align="end"
            className="calendar-commandbar__sync"
            aria-label="Website calendar sync"
          >
            <CalendarPublishSummary summary={publishSummary} />
            <CalendarSyncHealthPill health={syncHealth} state={publishState} />
            <SyncPreviewChip diff={syncPreviewDiff} hasBaseline={lastSyncSnapshot !== null} />
          </WorkspaceCommandGroup>
        </div>
        {publishMessage && publishState === "error" ? (
          <p
            className="calendar-sync-error"
          >
            {publishMessage}
          </p>
        ) : null}
        <CalendarSyncHealthPanel health={syncHealth} state={publishState} />
        {rulesEditorOpen ? (
          <SmartRulesEditor
            onClose={() => setRulesEditorOpen(false)}
            onRulesSaved={() => setSmartRulesRevision((rev) => rev + 1)}
          />
        ) : null}
        {composerOpen ? (
          <EventComposer
            calendars={calendars}
            anchor={anchor}
            onClose={() => setComposerOpen(false)}
            onCreated={(saved) => {
              // Splice optimistically: EventKit will fire its change
              // notification a beat later and we'll refetch — but
              // showing the new event immediately keeps the create
              // flow feeling responsive.
              setEvents((prev) => [...prev, saved]);
              setCalendarChangeRevision((revision) => revision + 1);
              setSelectedEvent(saved);
            }}
          />
        ) : null}
      </div>
      <div
        className="panel-shell__body calendar-surface-body"
      >
        <WorkspaceSplitView
          className="calendar-workspace-split"
          inspector={
            selectedEvent ? (
              <CalendarEventInspector
                event={selectedEvent}
                calendar={calendarsById.get(selectedEvent.calendarId)}
                metadata={metadataForEvent(
                  publishMetadata,
                  selectedEvent,
                  calendarDefaults,
                  resolveSmartDefault,
                )}
                resolution={resolveVisibility(
                  publishMetadata,
                  selectedEvent,
                  calendarDefaults,
                  resolveSmartDefault,
                )}
                publicEventCount={publicEventCount}
                publishMessage={publishMessage}
                rulesLoaded={rulesLoaded}
                publishState={publishState}
                onClose={() => setSelectedEvent(null)}
                onMetadataChange={updateSelectedMetadata}
                onPublish={() => void syncCalendarProjection("manual")}
              />
            ) : null}
        >
          <ViewPane
            view={view}
            anchor={anchor}
            events={visibleEvents}
            calendarsById={calendarsById}
            todos={todos}
            loadState={loadState}
            errorMessage={errorMessage}
            getDisclosure={getDisclosure}
            onEventSelect={setSelectedEvent}
            onTodoToggle={handleTodoToggle}
          />
        </WorkspaceSplitView>
      </div>
    </WorkspaceSurfaceFrame>
  );
}

function CalendarSyncHealthPanel({
  health,
  state,
}: {
  health: CalendarSyncHealth;
  state: PublishState;
}) {
  if (!health.error && state !== "publishing") return null;
  const target = health.baseUrl || "https://staging.jinkunchen.com";
  const status =
    state === "publishing" ? "syncing" : health.error ? "error" : "ready";
  return (
    <div className="calendar-sync-health-panel" data-state={status}>
      <span>
        <strong className="text-text-primary">Status</strong>
        <br />
        {status}
      </span>
      <span>
        <strong className="text-text-primary">Target</strong>
        <br />
        {target.replace(/^https?:\/\//, "")}
      </span>
      <span>
        <strong className="text-text-primary">Events</strong>
        <br />
        {health.eventCount}
      </span>
      <span>
        <strong className="text-text-primary">Save SHA</strong>
        <br />
        {health.fileSha ? health.fileSha.slice(0, 8) : "pending"}
      </span>
    </div>
  );
}

function CalendarSyncHealthPill({
  health,
  state,
}: {
  health: CalendarSyncHealth;
  state: PublishState;
}) {
  const last = health.lastSyncedAt
    ? new Date(health.lastSyncedAt).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : "not synced";
  const label =
    state === "publishing"
      ? "Syncing"
      : health.error
        ? "Sync error"
        : `Synced ${health.eventCount} · ${last}`;
  return (
    <a
      className="calendar-sync-link"
      href={`${health.baseUrl || "https://staging.jinkunchen.com"}/calendar`}
      target="_blank"
      rel="noreferrer"
      title={
        health.error
          ? health.error
          : `Target: ${health.baseUrl || "staging"} · SHA ${health.fileSha || "n/a"}`
      }
    >
      {label}
    </a>
  );
}

function ViewPane({
  view,
  anchor,
  events,
  calendarsById,
  todos,
  loadState,
  errorMessage,
  getDisclosure,
  onEventSelect,
  onTodoToggle,
}: {
  view: ViewKind;
  anchor: Date;
  events: CalendarEvent[];
  calendarsById: Map<string, Calendar>;
  todos: TodoRow[];
  loadState: LoadState;
  errorMessage: string | null;
  getDisclosure: EventDisclosureResolver;
  onEventSelect: (event: CalendarEvent) => void;
  onTodoToggle: (id: string, completed: boolean) => void;
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
          todos={todos}
          getDisclosure={getDisclosure}
          onEventSelect={onEventSelect}
          onTodoToggle={onTodoToggle}
        />
      );
    case "week":
      return (
        <WeekView
          anchor={anchor}
          events={events}
          calendarsById={calendarsById}
          todos={todos}
          getDisclosure={getDisclosure}
          onEventSelect={onEventSelect}
          onTodoToggle={onTodoToggle}
        />
      );
    case "month":
      return (
        <MonthView
          anchor={anchor}
          events={events}
          calendarsById={calendarsById}
          getDisclosure={getDisclosure}
          onEventSelect={onEventSelect}
        />
      );
    case "agenda":
      return (
        <AgendaView
          events={events}
          calendarsById={calendarsById}
          todos={todos}
          rangeLabel={formatViewTitle("agenda", anchor)}
          getDisclosure={getDisclosure}
          onEventSelect={onEventSelect}
          onTodoToggle={onTodoToggle}
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

function serializeCalendarDefaults(
  defaults: ReadonlyMap<string, CalendarPublicVisibility>,
): Array<[string, CalendarPublicVisibility]> {
  return [...defaults.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
}

function summarizePublishVisibility(
  events: CalendarEvent[],
  store: CalendarPublishMetadataStore,
  calendarDefaults?: ReadonlyMap<string, CalendarPublicVisibility>,
  smartResolver?: (event: CalendarEvent) => CalendarPublicVisibility | null,
): PublishSummary {
  const summary: PublishSummary = {
    hidden: 0,
    busy: 0,
    titleOnly: 0,
    full: 0,
  };
  for (const event of events) {
    summary[
      metadataForEvent(store, event, calendarDefaults, smartResolver).visibility
    ] += 1;
  }
  return summary;
}

function SyncPreviewChip({
  diff,
  hasBaseline,
}: {
  diff: ReturnType<typeof diffSnapshots>;
  hasBaseline: boolean;
}) {
  // Quiet pill — empty when there's nothing pending so the toolbar
  // doesn't get noisy on a freshly-synced state. First-sync (no
  // baseline) is its own state because diff numbers there reflect
  // "everything is added" which is technically true but not useful
  // signal for the operator.
  if (!hasBaseline) {
    return (
      <span className="calendar-sync-preview" data-tone="muted">
        No previous sync
      </span>
    );
  }
  const hasChanges =
    diff.added.length + diff.visibilityChanged.length + diff.removed.length > 0;
  if (!hasChanges) {
    return (
      <span className="calendar-sync-preview" data-tone="ok">
        Up to date
      </span>
    );
  }
  return (
    <span className="calendar-sync-preview" data-tone="pending">
      {diff.added.length > 0 ? <span>+{diff.added.length}</span> : null}
      {diff.visibilityChanged.length > 0 ? (
        <span>~{diff.visibilityChanged.length}</span>
      ) : null}
      {diff.removed.length > 0 ? <span>-{diff.removed.length}</span> : null}
    </span>
  );
}

function CalendarPublishSummary({ summary }: { summary: PublishSummary }) {
  return (
    <div
      className="calendar-publish-summary"
      aria-label="Calendar publish summary for current view"
    >
      <span>Busy {summary.busy}</span>
      <span>Title {summary.titleOnly}</span>
      <span>Full {summary.full}</span>
      {summary.hidden > 0 ? (
        <span>Hidden {summary.hidden}</span>
      ) : null}
    </div>
  );
}

function CalendarEventInspector({
  event,
  calendar,
  metadata,
  resolution,
  publicEventCount,
  publishMessage,
  rulesLoaded,
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
  /** Where the resolved visibility came from. Lets the inspector tell
   * the operator whether the current setting comes from an explicit
   * per-event override, a smart-default rule, the calendar default,
   * or the global "busy" fallback. */
  resolution: ResolvedVisibility;
  publicEventCount: number;
  publishMessage: string;
  rulesLoaded: boolean;
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
        border: 0,
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
          <p
            className="calendar-inspector__visibility-source"
            data-source={resolution.source}
            // Tells the operator whether the visibility above is
            // their explicit per-event choice or a default firing
            // from the resolver chain. Without this, "Busy" looks
            // identical regardless of whether they set it manually
            // or it came from the global fallback — and that matters
            // when they wonder "why is this not showing on /calendar".
          >
            {resolution.source === "override"
              ? "Source: per-event override (clear it to fall back to defaults)"
              : resolution.source === "smart-rule"
                ? "Source: smart rule matched the event metadata"
                : resolution.source === "calendar-default"
                  ? `Source: ${calendar?.title ?? "calendar"} default`
                  : "Source: global default (no rule matched)"}
          </p>
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
            hint="Busy events sync only the blocked time. Hidden events are never written to the public calendar projection."
          >
            Include this event on /calendar
          </WorkspaceCheckboxField>
        </WorkspaceInspectorSection>
        <WorkspaceInspectorSection heading="Website sync">
          <p className="m-0 text-[12px] text-text-muted">
            {publicEventCount} visible events are eligible for /calendar. The app
            auto-syncs the public projection; unconfigured events sync as Busy
            by default, with no title, notes, location, or URL.
          </p>
          {!rulesLoaded ? (
            <p className="m-0 text-[12px] text-text-muted">
              Loading saved disclosure rules...
            </p>
          ) : null}
          <button
            type="button"
            className="btn btn--primary"
            disabled={publishState === "publishing" || !rulesLoaded}
            onClick={onPublish}
          >
            {publishState === "publishing" ? "Syncing..." : "Sync calendar now"}
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
