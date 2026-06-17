import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { openCalendarAccountSettings, openMacosCalendarPrivacy } from "../../lib/tauri";
import {
  CONTEXT_MENU_SEPARATOR,
  copyTextToClipboard,
  showContextMenuWithActions,
} from "../../shell/contextMenu";
import { useSurfaceNav } from "../../shell/surface-nav-context";
import {
  WorkspaceActionMenu,
  WorkspaceCommandBar,
  WorkspaceCommandButton,
  WorkspaceCommandGroup,
  WorkspaceCheckboxField,
  WorkspaceDataHealthPill,
  WorkspaceDataStatus,
  WorkspaceInlineStatus,
  WorkspaceInspector,
  WorkspaceInspectorHeader,
  WorkspaceInspectorSection,
  WorkspaceSelectField,
  WorkspaceSplitView,
  WorkspaceSurfaceFrame,
  WorkspaceTextareaField,
  WorkspaceTextField,
} from "../../ui/primitives";
import { useWorkspaceResource } from "../../modules/useWorkspaceResource";
import { deriveWorkspaceDataHealth } from "../../modules/workspaceDataHealth";
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
  resolveVisibility,
  type ResolvedVisibility,
  metadataForEvent,
  emptyMetadataStore,
  updateMetadataForEvent,
  type CalendarPublishMetadataStore,
  type CalendarPublicAudience,
  type CalendarPublicVisibility,
} from "./publicProjection";
import {
  loadCalendarPublishRules,
  saveCalendarPublishRules,
} from "./publishRulesStore";
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
import {
  diffSnapshots,
  loadSyncSnapshot,
  type SnapshotEventEntry,
} from "./syncSnapshot";
import {
  loadVisibilityPrefs,
  reconcileVisibility,
  saveVisibilityPrefs,
} from "./visibilityPrefs";
import { WeekView } from "./WeekView";
import type { CalendarTimeSlotSelection } from "./TimeGrid";
import {
  LOCAL_CALENDAR_SOURCE,
  LOCAL_CALENDAR_SOURCE_ID,
  isLocalEventId,
  localCalendarArchiveCalendar,
  localCalendarArchiveEvent,
  localCalendarCreateCalendar,
  localCalendarFetchEvents,
  localCalendarListCalendars,
  localCalendarUpdateCalendar,
  localCalendarUpdateEvent,
  localCalendarUnarchiveEvent,
  type LocalCalendarRow,
  type LocalCalendarEventRow,
} from "../../modules/calendar/localCalendarApi";
import {
  CALENDAR_TIME_ZONE_OPTIONS,
  DEFAULT_CALENDAR_TIME_ZONE,
  formatInTimeZone,
  fromZonedDateTimeInputValue,
  normalizeCalendarTimeZone,
  toZonedDateTimeInputValue,
} from "../../../../../lib/shared/calendar-timezone.ts";
import {
  serializeCalendarDefaults,
  syncCurrentEventKitCalendarProjection,
  type CalendarSyncReason,
} from "./publicSync";
import {
  loadCalendarProductionSyncPolicy,
  saveCalendarProductionSyncPolicy,
  type CalendarProductionSyncPolicy,
} from "./productionSyncPolicy";
import {
  type CalendarPublishState,
  type CalendarSyncHealth,
} from "./CalendarSyncHealth";
import type { CalendarSettingsTab } from "./CalendarSettingsPanel";
import {
  SyncPreviewChip,
  summarizePublishVisibility,
} from "./CalendarPublishSummary";
import "../../styles/surfaces/calendar.css";

const CalendarSettingsPanel = lazy(() =>
  import("./CalendarSettingsPanel").then((module) => ({
    default: module.CalendarSettingsPanel,
  })),
);
const CalendarPublishPanel = lazy(() =>
  import("./CalendarPublishPanel").then((module) => ({
    default: module.CalendarPublishPanel,
  })),
);

/** localStorage key for the "skip EventKit gate" preference. Stored as
 * the string `"true"` when set; absent otherwise. Kept here so the
 * useState initializer has a single source of truth. */
const LOCAL_ONLY_STORAGE_KEY = "workspace.calendar.localOnly.v1";
const TIME_ZONE_STORAGE_KEY = "workspace.calendar.timeZone.v1";
const DEFAULT_EVENT_CALENDAR_STORAGE_KEY =
  "workspace.calendar.defaultEventCalendar.v1";
const DEFAULT_WORKSPACE_CALENDAR_TITLE = "Personal";
const DEFAULT_WORKSPACE_CALENDAR_COLOR = "#0a84ff";

type LoadState = "idle" | "loading" | "ready" | "error";
type PublishState = CalendarPublishState;
type EventComposerDraft = {
  anchor: Date;
  endsAt?: Date;
  point: { x: number; y: number } | null;
};

function isAuthorized(status: CalendarAuthorizationStatus): boolean {
  return status === "fullAccess" || status === "writeOnly";
}

function canAttemptNativeCalendar(status: CalendarAuthorizationStatus): boolean {
  return status === "notDetermined" || isAuthorized(status);
}

function loadCalendarTimeZone(): string {
  try {
    return normalizeCalendarTimeZone(
      localStorage.getItem(TIME_ZONE_STORAGE_KEY) ?? DEFAULT_CALENDAR_TIME_ZONE,
    );
  } catch {
    return DEFAULT_CALENDAR_TIME_ZONE;
  }
}

function loadDefaultEventCalendarId(): string {
  try {
    return localStorage.getItem(DEFAULT_EVENT_CALENDAR_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function closeContainingActionMenu(start: HTMLElement | null) {
  start?.closest("details")?.removeAttribute("open");
}

/** Top-level orchestrator. Owns the auth handshake, the
 * sources/calendars/events data fetch, and the active view +
 * navigation anchor. Each rendered view (Day / Week / Month / Agenda)
 * is a thin presentation component over the same event list. */
export function CalendarSurface() {
  const { setContextAccessory } = useSurfaceNav();
  const [timeZone, setTimeZoneState] = useState<string>(() =>
    loadCalendarTimeZone(),
  );
  const [defaultEventCalendarId, setDefaultEventCalendarIdState] =
    useState<string>(() => loadDefaultEventCalendarId());
  const [view, setView] = useState<ViewKind>("week");
  const [anchor, setAnchor] = useState<Date>(() =>
    startOfDay(new Date(), loadCalendarTimeZone()),
  );

  const [auth, setAuth] = useState<CalendarAuthorizationStatus>("notDetermined");
  const [requestingAccess, setRequestingAccess] = useState(false);
  // Opt-out of the EventKit gate. When the user clicks "Skip — use
  // workspace calendar only" on the permission prompt, we set this
  // flag so the surface renders even with `notDetermined`/`denied`
  // status, falling back to local-first calendars exclusively. The
  // setting is persisted so a relaunch lands on the same path.
  const [localOnlyMode, setLocalOnlyMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LOCAL_ONLY_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [eventKitLoadedAt, setEventKitLoadedAt] = useState<number | null>(null);
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
  // Local-first workspace calendars + their events. Live entirely in
  // workspace.db (see local_calendar.rs); loaded independently of
  // EventKit so the surface keeps working when calendar permission is
  // denied or the user hasn't granted it yet. Merged into the
  // sources/calendars/events arrays via the memos below so views,
  // SourceSidebar, and EventComposer all see one unified list.
  const [localCalendars, setLocalCalendars] = useState<LocalCalendarRow[]>([]);
  const [localCalendarsLoaded, setLocalCalendarsLoaded] = useState(false);
  const [localEvents, setLocalEvents] = useState<LocalCalendarEventRow[]>([]);
  const [localCalendarMessage, setLocalCalendarMessage] = useState<string | null>(
    null,
  );
  const [localEventUndo, setLocalEventUndo] =
    useState<LocalCalendarEventRow | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [composerDraft, setComposerDraft] = useState<EventComposerDraft | null>(
    null,
  );
  const [calendarSettingsTab, setCalendarSettingsTab] =
    useState<CalendarSettingsTab>("accounts");
  const [productionSyncPolicy, setProductionSyncPolicy] =
    useState<CalendarProductionSyncPolicy>(() =>
      loadCalendarProductionSyncPolicy(),
    );
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [rulesEditorOpen, setRulesEditorOpen] = useState(false);
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
  const defaultWorkspaceCalendarCreatedRef = useRef(false);

  const setCalendarProductionSyncPolicy = useCallback(
    (policy: CalendarProductionSyncPolicy) => {
      const next = policy === "auto-promote" ? "auto-promote" : "manual";
      setProductionSyncPolicy(next);
      saveCalendarProductionSyncPolicy(next);
    },
    [],
  );

  const openEventComposer = useCallback(
    (
      nextAnchor: Date = anchor,
      point: EventComposerDraft["point"] = null,
      endsAt?: Date,
    ) => {
      setSettingsPanelOpen(false);
      setSelectedEvent(null);
      setComposerDraft({
        anchor: new Date(nextAnchor),
        endsAt: endsAt ? new Date(endsAt) : undefined,
        point,
      });
    },
    [anchor],
  );

  const handleTimeZoneChange = useCallback((nextValue: string) => {
    const next = normalizeCalendarTimeZone(nextValue);
    try {
      localStorage.setItem(TIME_ZONE_STORAGE_KEY, next);
    } catch {
      // Keep the in-memory selection even when storage is unavailable.
    }
    setTimeZoneState(next);
    setAnchor((current) => startOfDay(current, next));
  }, []);

  const handleDefaultEventCalendarChange = useCallback((calendarId: string) => {
    try {
      if (calendarId) {
        localStorage.setItem(DEFAULT_EVENT_CALENDAR_STORAGE_KEY, calendarId);
      } else {
        localStorage.removeItem(DEFAULT_EVENT_CALENDAR_STORAGE_KEY);
      }
    } catch {
      // Keep the in-memory preference even when localStorage is unavailable.
    }
    setDefaultEventCalendarIdState(calendarId);
  }, []);

  // Refetch whenever the user pages forward/back or switches view —
  // each combination implies a different EventKit query window.
  const range = useMemo(
    () => rangeForView(view, anchor, timeZone),
    [view, anchor, timeZone],
  );

  // Read authorization status (no prompt) on mount.
  useEffect(() => {
    let cancelled = false;
    void calendarAuthorizationStatus({ force: true })
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
      if (src.length > 0 || cal.length > 0) {
        setAuth((current) =>
          current === "notDetermined" ? "fullAccess" : current,
        );
      }
      setEventKitLoadedAt(Date.now());
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
    if (localOnlyMode || !canAttemptNativeCalendar(auth)) return;
    // Initial EventKit hydration is an async external sync; loadAll awaits
    // native APIs before committing state.
    void loadAll();
  }, [auth, loadAll, localOnlyMode]);

  const localCalendarsResource = useWorkspaceResource<LocalCalendarRow[]>({
    initialData: [],
    source: "local",
    getSummary: (rows) => `${rows.length} workspace calendars`,
    hasData: (rows) => rows.length > 0,
    load: useCallback(() => localCalendarListCalendars(), []),
    onError: useCallback(() => {
      setLocalCalendarsLoaded(true);
    }, []),
    onSuccess: useCallback((rows: LocalCalendarRow[]) => {
      setLocalCalendars(rows);
      setLocalCalendarsLoaded(true);
    }, []),
  });

  const localEventsResource = useWorkspaceResource<LocalCalendarEventRow[]>({
    initialData: [],
    source: "local",
    getSummary: (rows) => `${rows.length} workspace events`,
    hasData: (rows) => rows.length > 0,
    load: useCallback(
      () =>
        localCalendarFetchEvents({
          startsAt: range.startsAt,
          endsAt: range.endsAt,
          calendarIds: [],
        }),
      [range.endsAt, range.startsAt],
    ),
    onSuccess: useCallback((rows: LocalCalendarEventRow[]) => {
      setLocalEvents(rows);
    }, []),
  });

  const upsertLocalCalendar = useCallback((row: LocalCalendarRow) => {
    setLocalCalendars((prev) => {
      const existingIdx = prev.findIndex((c) => c.id === row.id);
      if (existingIdx === -1) return [...prev, row];
      const next = [...prev];
      next[existingIdx] = row;
      return next;
    });
  }, []);

  const upsertLocalEvent = useCallback((row: LocalCalendarEventRow) => {
    setLocalEvents((prev) => {
      const existingIdx = prev.findIndex(
        (e) => e.eventIdentifier === row.eventIdentifier,
      );
      if (existingIdx === -1) return [...prev, row];
      const next = [...prev];
      next[existingIdx] = row;
      return next;
    });
  }, []);

  const handleComposerCreated = useCallback(
    (saved: CalendarEvent) => {
      if (isLocalEventId(saved.eventIdentifier)) {
        upsertLocalEvent(saved as LocalCalendarEventRow);
      } else {
        setEvents((prev) => [...prev, saved]);
        setCalendarChangeRevision((revision) => revision + 1);
      }
      setComposerDraft(null);
      setSelectedEvent(saved);
    },
    [upsertLocalEvent],
  );

  const createLocalCalendar = useCallback(
    async (
      params: { title?: string; colorHex?: string } = {},
    ): Promise<LocalCalendarRow | null> => {
      setLocalCalendarMessage(null);
      try {
        const row = await localCalendarCreateCalendar(params);
        upsertLocalCalendar(row);
        return row;
      } catch (error) {
        setLocalCalendarMessage(
          `Failed to create workspace calendar: ${String(error)}`,
        );
        return null;
      }
    },
    [upsertLocalCalendar],
  );

  const updateLocalCalendar = useCallback(
    async (id: string, patch: { title?: string; colorHex?: string }) => {
      setLocalCalendarMessage(null);
      try {
        const row = await localCalendarUpdateCalendar({ id, ...patch });
        upsertLocalCalendar(row);
      } catch (error) {
        setLocalCalendarMessage(
          `Failed to update workspace calendar: ${String(error)}`,
        );
      }
    },
    [upsertLocalCalendar],
  );

  const archiveLocalCalendar = useCallback(
    async (id: string) => {
      setLocalCalendarMessage(null);
      try {
        await localCalendarArchiveCalendar(id);
        setLocalCalendars((prev) => prev.filter((c) => c.id !== id));
        // The events list must also drop archived rows so views don't
        // keep stale data on screen until the next range refetch.
        setLocalEvents((prev) => prev.filter((e) => e.calendarId !== id));
      } catch (error) {
        setLocalCalendarMessage(
          `Failed to archive workspace calendar: ${String(error)}`,
        );
      }
    },
    [],
  );

  useEffect(() => {
    if (!localOnlyMode || !localCalendarsLoaded) return;
    if (localCalendars.length > 0) return;
    if (defaultWorkspaceCalendarCreatedRef.current) return;
    defaultWorkspaceCalendarCreatedRef.current = true;
    void createLocalCalendar({
      colorHex: DEFAULT_WORKSPACE_CALENDAR_COLOR,
      title: DEFAULT_WORKSPACE_CALENDAR_TITLE,
    }).then((row) => {
      if (!row) {
        defaultWorkspaceCalendarCreatedRef.current = false;
        return;
      }
      setLocalCalendarMessage(
        `Created ${DEFAULT_WORKSPACE_CALENDAR_TITLE} workspace calendar.`,
      );
    });
  }, [
    createLocalCalendar,
    localCalendars.length,
    localCalendarsLoaded,
    localOnlyMode,
  ]);

  const updateLocalEvent = useCallback(
    async (
      id: string,
      patch: {
        calendarId?: string;
        title?: string;
        startsAt?: string;
        endsAt?: string;
        isAllDay?: boolean;
        notes?: string | null;
        location?: string | null;
        url?: string | null;
      },
    ) => {
      setLocalCalendarMessage(null);
      try {
        const row = await localCalendarUpdateEvent({ id, ...patch });
        upsertLocalEvent(row);
        // Keep the inspector in sync with the freshly-saved row.
        if (selectedEvent && selectedEvent.eventIdentifier === id) {
          setSelectedEvent(row);
        }
      } catch (error) {
        setLocalCalendarMessage(`Failed to update event: ${String(error)}`);
      }
    },
    [selectedEvent, upsertLocalEvent],
  );

  const archiveLocalEvent = useCallback(
    async (id: string) => {
      setLocalCalendarMessage(null);
      try {
        const archived =
          localEvents.find((event) => event.eventIdentifier === id) ??
          (selectedEvent && selectedEvent.eventIdentifier === id
            ? (selectedEvent as LocalCalendarEventRow)
            : null);
        await localCalendarArchiveEvent(id);
        setLocalEvents((prev) => prev.filter((e) => e.eventIdentifier !== id));
        if (archived) setLocalEventUndo(archived);
        if (selectedEvent && selectedEvent.eventIdentifier === id) {
          setSelectedEvent(null);
        }
      } catch (error) {
        setLocalCalendarMessage(`Failed to archive event: ${String(error)}`);
      }
    },
    [localEvents, selectedEvent],
  );

  const undoArchiveLocalEvent = useCallback(async () => {
    if (!localEventUndo) return;
    setLocalCalendarMessage(null);
    try {
      const row = await localCalendarUnarchiveEvent(localEventUndo.eventIdentifier);
      upsertLocalEvent(row);
      setSelectedEvent(row);
      setLocalEventUndo(null);
    } catch (error) {
      setLocalCalendarMessage(`Failed to restore event: ${String(error)}`);
    }
  }, [localEventUndo, upsertLocalEvent]);

  const handleEventSelect = useCallback((event: CalendarEvent) => {
    setComposerDraft(null);
    setSettingsPanelOpen(false);
    setSelectedEvent(event);
  }, []);

  // Re-subscribe to EventKit changes whenever loadAll's identity
  // changes (i.e. when range changes); the listener captures the
  // current range via its closure.
  useEffect(() => {
    if (localOnlyMode || !canAttemptNativeCalendar(auth)) return;
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
  }, [auth, loadAll, localOnlyMode]);

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
      openEventComposer();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openEventComposer]);

  useEffect(() => {
    if (!composerDraft) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(".calendar-event-composer") ||
        target?.closest(".calendar-commandbar__actions")
      ) {
        return;
      }
      setComposerDraft(null);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [composerDraft]);

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
          openEventComposer();
          break;
        case "menu-cal-today":
          setAnchor(startOfDay(new Date(), timeZone));
          break;
        case "menu-cal-prev":
          setAnchor((current) => navigateView(view, current, -1, timeZone));
          break;
        case "menu-cal-next":
          setAnchor((current) => navigateView(view, current, 1, timeZone));
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
  }, [openEventComposer, timeZone, view]);

  // Merge EventKit + local-first sources. The synthetic Workspace
  // source is always included so the SourceSidebar can render an
  // "Add calendar" affordance even before any local calendars exist.
  // Local calendars carry sourceId = LOCAL_CALENDAR_SOURCE_ID; the
  // grouping by source below collects them under the synthetic header.
  const mergedSources = useMemo<CalendarSource[]>(() => {
    const out = [...sources];
    if (!out.some((s) => s.id === LOCAL_CALENDAR_SOURCE_ID)) {
      out.push(LOCAL_CALENDAR_SOURCE);
    }
    return out;
  }, [sources]);

  const mergedCalendars = useMemo<Calendar[]>(
    () => [...calendars, ...localCalendars],
    [calendars, localCalendars],
  );

  // Combined event pool seen by views. Publishing logic uses the
  // EventKit-only `events` slice instead — local events are local-
  // first by design and never go to the public /calendar projection.
  const mergedEvents = useMemo<CalendarEvent[]>(
    () => [...events, ...localEvents],
    [events, localEvents],
  );

  const calendarsBySource = useMemo(() => {
    const map = new Map<string, Calendar[]>();
    for (const c of mergedCalendars) {
      const arr = map.get(c.sourceId) ?? [];
      arr.push(c);
      map.set(c.sourceId, arr);
    }
    return map;
  }, [mergedCalendars]);

  const calendarsById = useMemo(() => {
    const map = new Map<string, Calendar>();
    for (const c of mergedCalendars) map.set(c.id, c);
    return map;
  }, [mergedCalendars]);

  // Whenever a freshly-loaded local calendar appears, treat it as
  // visible by default — same UX as a brand-new EventKit calendar.
  // The reconcile call inside loadAll only knows about EventKit
  // calendars, so this effect closes the gap for local rows.
  useEffect(() => {
    if (localCalendars.length === 0) return;
    setSelectedCalendarIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const cal of localCalendars) {
        if (knownCalendarIdsRef.current.has(cal.id)) continue;
        knownCalendarIdsRef.current.add(cal.id);
        if (!next.has(cal.id)) {
          next.add(cal.id);
          changed = true;
        }
      }
      if (!changed) return prev;
      saveVisibilityPrefs({
        visible: next,
        knownIds: knownCalendarIdsRef.current,
      });
      return next;
    });
  }, [localCalendars]);

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
    if (!canAttemptNativeCalendar(auth)) return;
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
    // not just the current week. Local events are always included in
    // the source list — they don't have a wider-window analog yet, so
    // the local pool acts as its own narrow band layered on top of
    // the EventKit search hits. The calendar filter still applies
    // (hidden calendars stay hidden in search results too).
    const source =
      trimmed.length > 0 && searchEvents.length > 0
        ? [...searchEvents, ...localEvents]
        : mergedEvents;
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
  }, [mergedEvents, localEvents, searchEvents, searchQuery, selectedCalendarIds]);
  const calendarHealthUpdatedAt = Math.max(
    eventKitLoadedAt ?? 0,
    localCalendarsResource.lastLoadedAt ?? 0,
    localEventsResource.lastLoadedAt ?? 0,
  );
  const calendarHealth = deriveWorkspaceDataHealth({
    error:
      !localOnlyMode && loadState === "error"
        ? errorMessage
        : localEventsResource.error,
    hasData:
      visibleEvents.length > 0 ||
      mergedCalendars.length > 0,
    hasLoaded:
      localOnlyMode
        ? localCalendarsResource.hasLoaded || localEventsResource.hasLoaded
        : loadState === "ready" ||
          loadState === "error" ||
          localCalendarsResource.hasLoaded ||
          localEventsResource.hasLoaded,
    loading:
      (!localOnlyMode && loadState === "loading") ||
      localCalendarsResource.loading ||
      localEventsResource.loading,
    source: localOnlyMode ? "local" : "mixed",
    summary: `${visibleEvents.length} events`,
    updatedAt: calendarHealthUpdatedAt > 0 ? calendarHealthUpdatedAt : null,
  });
  // Publishing scope is intentionally EventKit-only. Local-first events
  // never go to the public /calendar projection — that's the whole
  // point of the "Workspace" source.
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
  // pattern as release previews — surface the upcoming change before
  // the operator commits.
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
        audience: meta.audience ?? "auto",
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

  const setCalendarVisible = useCallback((id: string, visible: boolean) => {
    setSelectedCalendarIds((prev) => {
      const next = new Set(prev);
      if (visible) next.add(id);
      else next.delete(id);
      if (next.size === prev.size && next.has(id) === prev.has(id)) return prev;
      saveVisibilityPrefs({
        visible: next,
        knownIds: knownCalendarIdsRef.current,
      });
      return next;
    });
  }, []);

  const setSourceVisible = useCallback(
    (sourceId: string, visible: boolean) => {
      const sourceCalendars = calendarsBySource.get(sourceId) ?? [];
      if (sourceCalendars.length === 0) return;
      setSelectedCalendarIds((prev) => {
        const next = new Set(prev);
        for (const calendar of sourceCalendars) {
          if (visible) next.add(calendar.id);
          else next.delete(calendar.id);
        }
        saveVisibilityPrefs({
          visible: next,
          knownIds: knownCalendarIdsRef.current,
        });
        return next;
      });
    },
    [calendarsBySource],
  );

  const showOnlySource = useCallback(
    (sourceId: string) => {
      const sourceCalendars = calendarsBySource.get(sourceId) ?? [];
      if (sourceCalendars.length === 0) return;
      setSelectedCalendarIds(() => {
        const next = new Set(sourceCalendars.map((calendar) => calendar.id));
        saveVisibilityPrefs({
          visible: next,
          knownIds: knownCalendarIdsRef.current,
        });
        return next;
      });
    },
    [calendarsBySource],
  );

  const showOnlyCalendar = useCallback((calendarId: string) => {
    setSelectedCalendarIds(() => {
      const next = new Set([calendarId]);
      saveVisibilityPrefs({
        visible: next,
        knownIds: knownCalendarIdsRef.current,
      });
      return next;
    });
  }, []);

  const handleEventContextMenu = useCallback(
    (event: CalendarEvent) => {
      const calendar = calendarsById.get(event.calendarId);
      const timeSummary = event.isAllDay
        ? "All day"
        : `${formatInTimeZone(event.startsAt, timeZone, {
            hour: "numeric",
            minute: "2-digit",
          })} - ${formatInTimeZone(event.endsAt, timeZone, {
            hour: "numeric",
            minute: "2-digit",
          })}`;
      const entries = [
        {
          label: "Open details",
          run: () => handleEventSelect(event),
        },
        {
          label: "Copy title and time",
          run: () =>
            copyTextToClipboard(`${event.title || "(No title)"}\n${timeSummary}`),
        },
        CONTEXT_MENU_SEPARATOR,
        calendar && {
          label: "Hide this calendar",
          run: () => setCalendarVisible(calendar.id, false),
        },
        calendar && {
          label: "Show only this calendar",
          run: () => showOnlyCalendar(calendar.id),
        },
        isLocalEventId(event.eventIdentifier) && CONTEXT_MENU_SEPARATOR,
        isLocalEventId(event.eventIdentifier) && {
          label: "Archive event",
          run: () => void archiveLocalEvent(event.eventIdentifier),
        },
      ].filter(Boolean) as Parameters<typeof showContextMenuWithActions>[0];
      showContextMenuWithActions(entries);
    },
    [
      archiveLocalEvent,
      calendarsById,
      handleEventSelect,
      setCalendarVisible,
      showOnlyCalendar,
      timeZone,
    ],
  );

  const handleSlotContextMenu = useCallback(
    (selection: CalendarTimeSlotSelection) => {
      const startLabel = formatInTimeZone(selection.startsAt, timeZone, {
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        month: "short",
      });
      const entries = [
        {
          label: "New event here",
          run: () =>
            openEventComposer(
              selection.startsAt,
              selection.point,
              selection.endsAt,
            ),
        },
        CONTEXT_MENU_SEPARATOR,
        {
          label: "Copy date/time",
          run: () => copyTextToClipboard(startLabel),
        },
      ] as Parameters<typeof showContextMenuWithActions>[0];
      showContextMenuWithActions(entries);
    },
    [openEventComposer, timeZone],
  );

  const refreshCalendarAccounts = useCallback(async () => {
    if (!canAttemptNativeCalendar(auth)) {
      const nextAuth = await calendarAuthorizationStatus({ force: true });
      setAuth(nextAuth);
      if (!canAttemptNativeCalendar(nextAuth)) {
        setLocalCalendarMessage("Calendar access is not granted yet.");
        return;
      }
    }
    await loadAll();
    setLocalCalendarMessage("Calendar accounts refreshed.");
  }, [auth, loadAll]);

  const openSystemCalendarAccounts = useCallback(async () => {
    try {
      await openCalendarAccountSettings();
      setLocalCalendarMessage(
        "Opened macOS account settings. Return here and refresh accounts after changes.",
      );
    } catch (error) {
      setLocalCalendarMessage(`Could not open macOS account settings: ${String(error)}`);
    }
  }, []);

  const sourceSidebar = useMemo(
    () => (
      <SourceSidebar
        sources={mergedSources}
        calendarsBySource={calendarsBySource}
        visible={selectedCalendarIds}
        message={localCalendarMessage}
        onToggleVisible={toggleCalendar}
        onSetSourceVisible={setSourceVisible}
        onShowOnlySource={showOnlySource}
        onShowOnlyCalendar={showOnlyCalendar}
        onCreateLocalCalendar={() => void createLocalCalendar()}
        onRenameLocalCalendar={(id, title) =>
          void updateLocalCalendar(id, { title })
        }
        onRecolorLocalCalendar={(id, colorHex) =>
          void updateLocalCalendar(id, { colorHex })
        }
        onArchiveLocalCalendar={(id) => void archiveLocalCalendar(id)}
        onOpenAccountSettings={() => void openSystemCalendarAccounts()}
        onOpenSettingsPanel={() => setSettingsPanelOpen(true)}
        onRefreshSources={() => void refreshCalendarAccounts()}
      />
    ),
    [
      archiveLocalCalendar,
      calendarsBySource,
      createLocalCalendar,
      openSystemCalendarAccounts,
      refreshCalendarAccounts,
      localCalendarMessage,
      mergedSources,
      selectedCalendarIds,
      showOnlyCalendar,
      showOnlySource,
      setSourceVisible,
      toggleCalendar,
      updateLocalCalendar,
    ],
  );

  useEffect(() => {
    setContextAccessory(sourceSidebar);
    return () => setContextAccessory(null);
  }, [setContextAccessory, sourceSidebar]);

  const requestAccess = async () => {
    if (requestingAccess) return;
    setRequestingAccess(true);
    setErrorMessage(null);
    try {
      const current = await calendarAuthorizationStatus({ force: true });
      if (current !== "notDetermined") {
        setAuth(current);
        return;
      }
      const next = await calendarRequestAccess();
      setAuth(next);
    } catch (err) {
      setErrorMessage(String(err));
    } finally {
      setRequestingAccess(false);
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
    try {
      const result = await syncCurrentEventKitCalendarProjection({
        calendarsById,
        metadata: publishMetadata,
        calendarDefaults,
        extraEvents: events,
        extraRange: { startsAt: range.startsAt, endsAt: range.endsAt },
        productionPolicy: productionSyncPolicy,
        reason,
        skipIfUnchanged: reason !== "manual",
      });
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
      setLastSyncSnapshot(result.snapshot);
      setSyncHealth((prev) => ({
        lastSyncedAt: new Date().toISOString(),
        eventCount: result.eventCount,
        baseUrl: result.baseUrl || prev.baseUrl,
        fileSha: result.fileSha || prev.fileSha,
        reason,
        error: null,
      }));
      if (result.status === "unchanged" && result.production?.ok) {
        setPublishMessage(
          `Calendar already up to date (${result.eventCount} events). Production calendar updated.`,
        );
      } else if (result.status === "unchanged" && result.production && !result.production.ok) {
        setPublishMessage(
          `Calendar already up to date (${result.eventCount} events). Production calendar sync failed: ${result.production.error}`,
        );
      } else if (result.status === "unchanged") {
        setPublishMessage(`Calendar already up to date (${result.eventCount} events).`);
      } else if (result.production?.ok) {
        setPublishMessage(
          `${reason === "auto" ? "Auto-synced" : "Synced"} ${result.eventCount} events to staging and production.`,
        );
      } else if (result.production && !result.production.ok) {
        setPublishMessage(
          `${reason === "auto" ? "Auto-synced" : "Synced"} ${result.eventCount} events to staging. Production calendar sync failed: ${result.production.error}`,
        );
      } else {
        setPublishMessage(
          `${reason === "auto" ? "Auto-synced" : "Synced"} ${result.eventCount} events. SHA ${result.fileSha.slice(0, 8) || "updated"}.`,
        );
      }
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
    productionSyncPolicy,
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
        productionSyncPolicy,
        rulesLoaded,
        loadState,
        smartRulesRevision,
      }),
    [
      calendarChangeRevision,
      calendarDefaults,
      loadState,
      publishMetadata,
      productionSyncPolicy,
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

  const enableLocalOnlyMode = useCallback(() => {
    try {
      localStorage.setItem(LOCAL_ONLY_STORAGE_KEY, "true");
    } catch {
      // Storage may be disabled in some sandboxes — proceed in
      // memory-only mode; the user just has to re-skip on next launch.
    }
    setLocalOnlyMode(true);
  }, []);

  const needsNativeCalendarGrant =
    auth === "notDetermined" &&
    !localOnlyMode &&
    (loadState === "error" ||
      (loadState === "ready" &&
        sources.length === 0 &&
        calendars.length === 0 &&
        events.length === 0));

  if (needsNativeCalendarGrant) {
    return (
      <PermissionGate
        onRequest={requestAccess}
        onSkip={enableLocalOnlyMode}
        error={
          errorMessage ??
          "macOS has not granted Calendar access to this app build yet."
        }
        requesting={requestingAccess}
      />
    );
  }
  if ((auth === "denied" || auth === "restricted") && !localOnlyMode) {
    return (
      <PermissionBlocked
        status={auth}
        onSkip={enableLocalOnlyMode}
      />
    );
  }

  const composerPopoverStyle = composerDraft?.point
    ? ({
        "--calendar-event-composer-x": `${composerDraft.point.x}px`,
        "--calendar-event-composer-y": `${composerDraft.point.y}px`,
      } as CSSProperties)
    : undefined;

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
          <DateNav
            view={view}
            anchor={anchor}
            timeZone={timeZone}
            onAnchorChange={setAnchor}
          />
        }
        center={
          <ViewSwitcher view={view} onChange={setView} />
        }
        trailing={
          <WorkspaceCommandGroup
            align="end"
            className="calendar-commandbar__actions"
          >
            <WorkspaceDataHealthPill
              health={calendarHealth}
              label={localOnlyMode ? "Local" : "Synced"}
            />
            <WorkspaceCommandButton
              tone="accent"
              onClick={() => {
                if (composerDraft) {
                  setComposerDraft(null);
                } else {
                  openEventComposer();
                }
              }}
              aria-pressed={composerDraft !== null}
              title="Create a new calendar event"
            >
              + Event
            </WorkspaceCommandButton>
            <WorkspaceActionMenu
              className="calendar-commandbar__more"
              label="More"
            >
              <div className="workspace-action-menu__section calendar-commandbar__menu-section">
                <label className="workspace-action-menu__field">
                  <span>Search</span>
                  <div className="calendar-search-wrapper calendar-search-wrapper--menu">
                    <input
                      type="search"
                      className="calendar-search-input"
                      placeholder="Search events…"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      aria-label="Search events"
                    />
                    {searchEventsLoading ? (
                      <span
                        className="calendar-search-pending"
                        aria-live="polite"
                        title="Loading wider event range for search"
                      >
                        …
                      </span>
                    ) : null}
                  </div>
                </label>
                <label className="workspace-action-menu__field">
                  <span>Time Zone</span>
                  <select
                    value={timeZone}
                    onChange={(event) =>
                      handleTimeZoneChange(event.currentTarget.value)
                    }
                    aria-label="Calendar time zone"
                  >
                    {CALENDAR_TIME_ZONE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="workspace-action-menu__section">
                <button
                  type="button"
                  onClick={(event) => {
                    closeContainingActionMenu(event.currentTarget);
                    setCalendarSettingsTab("accounts");
                    setSettingsPanelOpen((open) => {
                      const next = !open;
                      if (next) {
                        setComposerDraft(null);
                        setSelectedEvent(null);
                      }
                      return next;
                    });
                  }}
                  aria-pressed={settingsPanelOpen}
                >
                  Settings
                </button>
                <button
                  type="button"
                  className="calendar-commandbar__menu-publish"
                  data-active={
                    settingsPanelOpen && calendarSettingsTab === "publish"
                      ? "true"
                      : undefined
                  }
                  onClick={(event) => {
                    closeContainingActionMenu(event.currentTarget);
                    setCalendarSettingsTab("publish");
                    setSettingsPanelOpen(true);
                    setComposerDraft(null);
                    setSelectedEvent(null);
                  }}
                  aria-pressed={settingsPanelOpen && calendarSettingsTab === "publish"}
                  title={
                    lastSyncSnapshot
                      ? `Publish panel: +${syncPreviewDiff.added.length} · ~${syncPreviewDiff.visibilityChanged.length} · -${syncPreviewDiff.removed.length}`
                      : "Open website calendar publish panel"
                  }
                >
                  <span>Publish</span>
                  <SyncPreviewChip
                    diff={syncPreviewDiff}
                    hasBaseline={lastSyncSnapshot !== null}
                  />
                </button>
              </div>
            </WorkspaceActionMenu>
          </WorkspaceCommandGroup>
        }
      />
      <div
        className="panel-shell__body calendar-surface-body"
      >
        {localEventUndo ? (
          <CalendarUndoToast
            event={localEventUndo}
            onDismiss={() => setLocalEventUndo(null)}
            onUndo={() => void undoArchiveLocalEvent()}
          />
        ) : null}
        <WorkspaceSplitView
          className="calendar-workspace-split"
          inspector={
            settingsPanelOpen ? (
              <Suspense
                fallback={
                  <WorkspaceInlineStatus tone="muted">
                    Loading calendar settings…
                  </WorkspaceInlineStatus>
                }
              >
                <CalendarSettingsPanel
                  calendarsBySource={calendarsBySource}
                  calendars={mergedCalendars}
                  defaultEventCalendarId={defaultEventCalendarId}
                  sources={mergedSources}
                  timeZone={timeZone}
                  visible={selectedCalendarIds}
                  onClose={() => setSettingsPanelOpen(false)}
                  onCreateLocalCalendar={() => void createLocalCalendar()}
                  onArchiveLocalCalendar={(id) => void archiveLocalCalendar(id)}
                  onRenameLocalCalendar={(id, title) =>
                    void updateLocalCalendar(id, { title })
                  }
                  onRecolorLocalCalendar={(id, colorHex) =>
                    void updateLocalCalendar(id, { colorHex })
                  }
                  onOpenAccountSettings={() => void openSystemCalendarAccounts()}
                  onRefreshAccounts={() => void refreshCalendarAccounts()}
                  onSetCalendarVisible={setCalendarVisible}
                  onSetSourceVisible={setSourceVisible}
                  onDefaultEventCalendarChange={handleDefaultEventCalendarChange}
                  onTimeZoneChange={handleTimeZoneChange}
                  initialTab={calendarSettingsTab}
                  publishPanel={
                    <Suspense
                      fallback={
                        <WorkspaceInlineStatus tone="muted">
                          Loading publish settings…
                        </WorkspaceInlineStatus>
                      }
                    >
                      <CalendarPublishPanel
                        calendarDefaults={calendarDefaults}
                        calendars={mergedCalendars}
                        diff={syncPreviewDiff}
                        hasBaseline={lastSyncSnapshot !== null}
                        health={syncHealth}
                        publishMessage={publishMessage}
                        publishState={publishState}
                        productionSyncPolicy={productionSyncPolicy}
                        rulesEditorOpen={rulesEditorOpen}
                        rulesLoaded={rulesLoaded}
                        summary={publishSummary}
                        onRulesSaved={() => setSmartRulesRevision((rev) => rev + 1)}
                        onSetCalendarDefault={setCalendarDefault}
                        onSetProductionSyncPolicy={setCalendarProductionSyncPolicy}
                        onSync={() => void syncCalendarProjection("manual")}
                        onToggleRulesEditor={() =>
                          setRulesEditorOpen((open) => !open)
                        }
                      />
                    </Suspense>
                  }
                />
              </Suspense>
            ) : selectedEvent && isLocalEventId(selectedEvent.eventIdentifier) ? (
              <LocalEventInspector
                key={`${selectedEvent.eventIdentifier}-${timeZone}`}
                event={selectedEvent}
                calendar={calendarsById.get(selectedEvent.calendarId)}
                calendars={localCalendars}
                timeZone={timeZone}
                onClose={() => setSelectedEvent(null)}
                onUpdate={(patch) =>
                  void updateLocalEvent(selectedEvent.eventIdentifier, patch)
                }
                onArchive={() =>
                  void archiveLocalEvent(selectedEvent.eventIdentifier)
                }
              />
            ) : selectedEvent ? (
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
                timeZone={timeZone}
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
            loadState={localOnlyMode ? "ready" : loadState}
            errorMessage={localOnlyMode ? null : errorMessage}
            getDisclosure={getDisclosure}
            timeZone={timeZone}
            onEventSelect={handleEventSelect}
            onEventContextMenu={handleEventContextMenu}
            onSlotCreate={({ startsAt, endsAt, point }) =>
              openEventComposer(startsAt, point, endsAt)
            }
            onSlotContextMenu={handleSlotContextMenu}
          />
        </WorkspaceSplitView>
        {composerDraft ? (
          <div
            className="calendar-event-composer-popover"
            data-anchored={composerDraft.point ? "true" : undefined}
            style={composerPopoverStyle}
          >
            <EventComposer
              key={`${composerDraft.anchor.toISOString()}-${composerDraft.endsAt?.toISOString() ?? "auto"}-${timeZone}`}
              anchor={composerDraft.anchor}
              initialEndsAt={composerDraft.endsAt}
              calendars={mergedCalendars}
              timeZone={timeZone}
              preferredCalendarId={defaultEventCalendarId}
              onClose={() => setComposerDraft(null)}
              onCreateWorkspaceCalendar={() => createLocalCalendar()}
              onCreated={handleComposerCreated}
              variant="popover"
            />
          </div>
        ) : null}
      </div>
    </WorkspaceSurfaceFrame>
  );
}

function CalendarUndoToast({
  event,
  onDismiss,
  onUndo,
}: {
  event: LocalCalendarEventRow;
  onDismiss: () => void;
  onUndo: () => void;
}) {
  return (
    <div className="calendar-undo-toast" role="status">
      <span>Archived {event.title || "event"}.</span>
      <button type="button" onClick={onUndo}>
        Undo
      </button>
      <button
        type="button"
        className="calendar-undo-toast__dismiss"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        Close
      </button>
    </div>
  );
}

function ViewPane({
  view,
  anchor,
  events,
  calendarsById,
  loadState,
  errorMessage,
  getDisclosure,
  timeZone,
  onEventSelect,
  onEventContextMenu,
  onSlotCreate,
  onSlotContextMenu,
}: {
  view: ViewKind;
  anchor: Date;
  events: CalendarEvent[];
  calendarsById: Map<string, Calendar>;
  loadState: LoadState;
  errorMessage: string | null;
  getDisclosure: EventDisclosureResolver;
  timeZone: string;
  onEventSelect: (event: CalendarEvent) => void;
  onEventContextMenu: (event: CalendarEvent) => void;
  onSlotCreate: (selection: CalendarTimeSlotSelection) => void;
  onSlotContextMenu: (selection: CalendarTimeSlotSelection) => void;
}) {
  if (loadState === "error" && events.length === 0) {
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

  const status = (
    <WorkspaceDataStatus
      error={loadState === "error" ? errorMessage : null}
      hasData={events.length > 0}
      loading={loadState === "loading"}
      loadingLabel="Refreshing events…"
      staleLabel="Unable to refresh events. Showing the last loaded calendar."
    />
  );

  const viewNode = (() => {
    switch (view) {
    case "day":
      return (
        <DayView
          day={anchor}
          events={events}
          calendarsById={calendarsById}
          getDisclosure={getDisclosure}
          timeZone={timeZone}
          onEventSelect={onEventSelect}
          onEventContextMenu={onEventContextMenu}
          onSlotCreate={onSlotCreate}
          onSlotContextMenu={onSlotContextMenu}
        />
      );
    case "week":
      return (
        <WeekView
          anchor={anchor}
          events={events}
          calendarsById={calendarsById}
          getDisclosure={getDisclosure}
          timeZone={timeZone}
          onEventSelect={onEventSelect}
          onEventContextMenu={onEventContextMenu}
          onSlotCreate={onSlotCreate}
          onSlotContextMenu={onSlotContextMenu}
        />
      );
    case "month":
      return (
        <MonthView
          anchor={anchor}
          events={events}
          calendarsById={calendarsById}
          getDisclosure={getDisclosure}
          timeZone={timeZone}
          onDayCreate={onSlotCreate}
          onDayContextMenu={onSlotContextMenu}
          onEventSelect={onEventSelect}
          onEventContextMenu={onEventContextMenu}
        />
      );
    case "agenda":
      return (
        <AgendaView
          events={events}
          calendarsById={calendarsById}
          rangeLabel={formatViewTitle("agenda", anchor, timeZone)}
          getDisclosure={getDisclosure}
          timeZone={timeZone}
          onEventSelect={onEventSelect}
          onEventContextMenu={onEventContextMenu}
        />
      );
    }
  })();

  return (
    <>
      {status}
      {viewNode}
    </>
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
  timeZone,
  onClose,
  onMetadataChange,
  onPublish,
}: {
  event: CalendarEvent;
  calendar: Calendar | undefined;
  metadata: {
    visibility: CalendarPublicVisibility;
    audience?: CalendarPublicAudience;
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
  timeZone: string;
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
              <dd>
                {event.isAllDay
                  ? "All day"
                  : `${formatDateTime(event.startsAt, timeZone)} - ${formatDateTime(event.endsAt, timeZone)}`}
              </dd>
            </div>
            {event.location ? (
              <div>
                <dt>Location</dt>
                <dd>{event.location}</dd>
              </div>
            ) : null}
          </dl>
        </WorkspaceInspectorSection>
        <WorkspaceInspectorSection heading="Website">
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
          >
            {resolution.source === "override"
              ? "Using event setting"
              : resolution.source === "smart-rule"
                ? "Using smart rule"
                : resolution.source === "calendar-default"
                  ? "Using calendar default"
                  : "Using default"}
          </p>
          {metadata.visibility !== "hidden" ? (
            <WorkspaceSelectField
              label="Featured mode"
              value={metadata.audience ?? "auto"}
              onChange={(e) =>
                onMetadataChange({
                  audience: e.currentTarget.value as CalendarPublicAudience,
                })
              }
            >
              <option value="auto">Auto</option>
              <option value="featured">Featured</option>
              <option value="all">All only</option>
            </WorkspaceSelectField>
          ) : null}
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
            hint="Busy shows time only. Hidden is not published."
          >
            Include this event on /calendar
          </WorkspaceCheckboxField>
        </WorkspaceInspectorSection>
        <WorkspaceInspectorSection heading="Website sync">
          <p className="m-0 text-[12px] text-text-muted">
            {publicEventCount} events are eligible. Busy hides title and details.
          </p>
          {!rulesLoaded ? (
            <p className="m-0 text-[12px] text-text-muted">
              Loading rules…
            </p>
          ) : null}
          <button
            type="button"
            className="btn btn--primary"
            disabled={publishState === "publishing" || !rulesLoaded}
            onClick={onPublish}
          >
            {publishState === "publishing" ? "Syncing…" : "Sync calendar now"}
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

function formatDateTime(
  iso: string,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): string {
  return formatInTimeZone(iso, timeZone, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isoToDateTimeInput(
  iso: string,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): string {
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp)
    ? toZonedDateTimeInputValue(new Date(timestamp), timeZone)
    : "";
}

function dateTimeInputToIso(
  value: string,
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
): string | null {
  return fromZonedDateTimeInputValue(value, timeZone)?.toISOString() ?? null;
}

/** Inspector for local-first workspace events. Skips the publishing /
 * disclosure controls (those don't apply to local-only events) and
 * surfaces edit + archive directly. The save path uses field-level
 * commit-on-blur so each edit is its own atomic write — same pattern
 * as the rest of the workspace's local-first surfaces. */
function LocalEventInspector({
  event,
  calendar,
  calendars,
  timeZone,
  onClose,
  onUpdate,
  onArchive,
}: {
  event: CalendarEvent;
  calendar: Calendar | undefined;
  calendars: readonly Calendar[];
  timeZone: string;
  onClose: () => void;
  onUpdate: (patch: {
    calendarId?: string;
    title?: string;
    startsAt?: string;
    endsAt?: string;
    isAllDay?: boolean;
    notes?: string | null;
    location?: string | null;
    url?: string | null;
  }) => void;
  onArchive: () => void;
}) {
  const [titleDraft, setTitleDraft] = useState(event.title);
  const [calendarIdDraft, setCalendarIdDraft] = useState(event.calendarId);
  const [startsAtDraft, setStartsAtDraft] = useState(() =>
    isoToDateTimeInput(event.startsAt, timeZone),
  );
  const [endsAtDraft, setEndsAtDraft] = useState(() =>
    isoToDateTimeInput(event.endsAt, timeZone),
  );
  const [notesDraft, setNotesDraft] = useState(event.notes ?? "");
  const [locationDraft, setLocationDraft] = useState(event.location ?? "");
  const [urlDraft, setUrlDraft] = useState(event.url ?? "");
  const [timeError, setTimeError] = useState<string | null>(null);

  const commitTime = () => {
    const startsAt = dateTimeInputToIso(startsAtDraft, timeZone);
    const endsAt = dateTimeInputToIso(endsAtDraft, timeZone);
    if (!startsAt || !endsAt) {
      setTimeError("Enter a valid start and end time.");
      return;
    }
    if (Date.parse(endsAt) <= Date.parse(startsAt)) {
      setTimeError("End time must be after start time.");
      return;
    }
    setTimeError(null);
    const patch: { startsAt?: string; endsAt?: string } = {};
    if (Date.parse(startsAt) !== Date.parse(event.startsAt)) {
      patch.startsAt = startsAt;
    }
    if (Date.parse(endsAt) !== Date.parse(event.endsAt)) {
      patch.endsAt = endsAt;
    }
    if (patch.startsAt || patch.endsAt) onUpdate(patch);
  };

  return (
    <WorkspaceInspector
      className="calendar-inspector"
      label="Workspace event"
      style={{ border: 0, borderRadius: 0, padding: "14px" }}
    >
      <WorkspaceInspectorHeader
        heading={event.title || "(Workspace event)"}
        kicker={calendar?.title ?? "Workspace"}
        actions={
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        }
      />
      <div className="workspace-inspector__body">
        <WorkspaceInspectorSection heading="Details">
          <p className="m-0 text-[12px] text-text-muted">
            {calendar?.title ?? "Workspace"} ·{" "}
            {formatDateTime(event.startsAt, timeZone)} –{" "}
            {formatDateTime(event.endsAt, timeZone)}
          </p>
          <WorkspaceSelectField
            label="Calendar"
            value={calendarIdDraft}
            onChange={(e) => {
              const next = e.currentTarget.value;
              setCalendarIdDraft(next);
              if (next !== event.calendarId) onUpdate({ calendarId: next });
            }}
          >
            {calendars.map((cal) => (
              <option key={cal.id} value={cal.id}>
                {cal.title}
              </option>
            ))}
          </WorkspaceSelectField>
          <WorkspaceTextField
            label="Title"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.currentTarget.value)}
            onBlur={() => {
              const next = titleDraft.trim();
              if (!next || next === event.title) return;
              onUpdate({ title: next });
            }}
          />
          <WorkspaceTextField
            label="Starts"
            type="datetime-local"
            value={startsAtDraft}
            onChange={(e) => setStartsAtDraft(e.currentTarget.value)}
            onBlur={commitTime}
          />
          <WorkspaceTextField
            label="Ends"
            type="datetime-local"
            value={endsAtDraft}
            onChange={(e) => setEndsAtDraft(e.currentTarget.value)}
            onBlur={commitTime}
          />
          {timeError ? (
            <p className="calendar-local-event__error">{timeError}</p>
          ) : null}
          <WorkspaceTextField
            label="Location"
            value={locationDraft}
            onChange={(e) => setLocationDraft(e.currentTarget.value)}
            onBlur={() => {
              const next = locationDraft.trim();
              if ((event.location ?? "") === next) return;
              onUpdate({ location: next === "" ? null : next });
            }}
          />
          <WorkspaceTextField
            label="URL"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.currentTarget.value)}
            onBlur={() => {
              const next = urlDraft.trim();
              if ((event.url ?? "") === next) return;
              onUpdate({ url: next === "" ? null : next });
            }}
          />
          <WorkspaceTextareaField
            label="Notes"
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.currentTarget.value)}
            onBlur={() => {
              if ((event.notes ?? "") === notesDraft) return;
              onUpdate({ notes: notesDraft === "" ? null : notesDraft });
            }}
          />
          <WorkspaceCheckboxField
            checked={event.isAllDay}
            onChange={(e) =>
              onUpdate({ isAllDay: e.currentTarget.checked })
            }
            hint="No specific time."
          >
            All-day event
          </WorkspaceCheckboxField>
        </WorkspaceInspectorSection>
        <WorkspaceInspectorSection heading="Manage">
          <p className="m-0 text-[12px] text-text-muted">
            Private to Workspace. Archive hides it; undo appears below.
          </p>
          <button
            type="button"
            className="btn"
            onClick={onArchive}
          >
            Archive event
          </button>
        </WorkspaceInspectorSection>
      </div>
    </WorkspaceInspector>
  );
}

function PermissionGate({
  onRequest,
  onSkip,
  error,
  requesting,
}: {
  onRequest: () => void;
  onSkip: () => void;
  error: string | null;
  requesting: boolean;
}) {
  return (
    <section
      className="surface-card"
      aria-busy={requesting}
      aria-labelledby="calendar-gate-title"
    >
      <header>
        <h1
          id="calendar-gate-title"
          className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]"
        >
          Connect your calendars
        </h1>
        <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">
          Use macOS calendars or stay local in Workspace.
        </p>
      </header>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="btn btn--primary"
          disabled={requesting}
          onClick={onRequest}
        >
          {requesting ? "Waiting for macOS..." : "Allow access"}
        </button>
        <button type="button" className="btn" onClick={onSkip}>
          Use Workspace only
        </button>
      </div>
      {error ? (
        <p className="mt-3 text-[12.5px] text-text-danger">{error}</p>
      ) : null}
    </section>
  );
}

function PermissionBlocked({
  status,
  onSkip,
}: {
  status: CalendarAuthorizationStatus;
  onSkip: () => void;
}) {
  const reason =
    status === "restricted"
      ? "Calendar access is restricted on this device."
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
        Enable access in System Settings, or continue with Workspace calendars.
      </p>
      <div className="mt-3 flex flex-row gap-2">
        {status === "denied" ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              void openMacosCalendarPrivacy();
            }}
          >
            Open System Settings
          </button>
        ) : null}
        <button
          type="button"
          className={status === "denied" ? "btn" : "btn btn--primary"}
          onClick={onSkip}
        >
          Use Workspace calendar instead
        </button>
      </div>
    </section>
  );
}
