import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Settings2 } from "lucide-react";

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
import type { CalendarTimeSlotSelection } from "./TimeGrid";
import {
  todosList,
  todosUpdate,
  type TodoRow,
  type TodosUpdateParams,
} from "../../modules/todos/api";
import {
  TODO_SCHEDULE_PRESETS,
  clearTodoPlanningUpdateParams,
  dateAndTimeInputToTimestamp,
  dateInputToTimestamp,
  dateInputValue,
  dateTimeInputToTimestamp,
  dateTimeInputValue,
  estimateInputToMinutes,
  timeInputValue,
  todoPresetUpdateParams,
  todoScheduleAtUpdateParams,
  todoSchedulePresetLabel,
  type TodoSchedulePreset,
} from "../../modules/todos/planning";
import { todoTimelineStart } from "../../modules/todos/time";
import {
  LOCAL_CALENDAR_SOURCE,
  LOCAL_CALENDAR_SOURCE_ID,
  isLocalCalendarId,
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
  calendarTimeZoneLabel,
  formatInTimeZone,
  fromZonedDateTimeInputValue,
  normalizeCalendarTimeZone,
  toZonedDateTimeInputValue,
} from "../../../../../lib/shared/calendar-timezone.ts";

/** localStorage key for the "skip EventKit gate" preference. Stored as
 * the string `"true"` when set; absent otherwise. Kept here so the
 * useState initializer has a single source of truth. */
const LOCAL_ONLY_STORAGE_KEY = "workspace.calendar.localOnly.v1";
const TIME_ZONE_STORAGE_KEY = "workspace.calendar.timeZone.v1";
const DEFAULT_WORKSPACE_CALENDAR_TITLE = "Personal";
const DEFAULT_WORKSPACE_CALENDAR_COLOR = "#0a84ff";

const DEFAULT_VISIBILITY_LABELS: Array<{
  value: CalendarPublicVisibility;
  label: string;
  hint: string;
}> = [
  {
    value: "hidden",
    label: "Hidden",
    hint: "Skip every event in this calendar from /calendar",
  },
  {
    value: "busy",
    label: "Busy",
    hint: "Show as anonymous busy block on /calendar",
  },
  {
    value: "titleOnly",
    label: "Title",
    hint: "Show title + time, hide notes/location",
  },
  {
    value: "full",
    label: "Full",
    hint: "Show title, time, notes, location, URL",
  },
];

type LoadState = "idle" | "loading" | "ready" | "error";
type PublishState = "idle" | "publishing" | "success" | "error";
type PublishSummary = Record<CalendarPublicVisibility, number>;
type CalendarSyncReason = "auto" | "manual";
type TodoUpdatePatch = Omit<TodosUpdateParams, "id">;
type EventComposerDraft = {
  anchor: Date;
  endsAt?: Date;
  point: { x: number; y: number } | null;
};
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

function loadCalendarTimeZone(): string {
  try {
    return normalizeCalendarTimeZone(
      localStorage.getItem(TIME_ZONE_STORAGE_KEY) ?? DEFAULT_CALENDAR_TIME_ZONE,
    );
  } catch {
    return DEFAULT_CALENDAR_TIME_ZONE;
  }
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
  const [view, setView] = useState<ViewKind>("week");
  const [anchor, setAnchor] = useState<Date>(() =>
    startOfDay(new Date(), loadCalendarTimeZone()),
  );

  const [auth, setAuth] = useState<CalendarAuthorizationStatus>("notDetermined");
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
  // Todos overlaid on the timeline (Day / Week views) and folded into
  // the Agenda list. Loaded once at mount + after every toggle so the
  // overlay stays in sync without subscribing to a Tauri event we
  // haven't built yet.
  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
  const [composerDraft, setComposerDraft] = useState<EventComposerDraft | null>(
    null,
  );
  const [publishPanelOpen, setPublishPanelOpen] = useState(false);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [rulesEditorOpen, setRulesEditorOpen] = useState(false);
  const [todoTrayExpanded, setTodoTrayExpanded] = useState(false);
  const [todoMessage, setTodoMessage] = useState<string | null>(null);
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

  const openEventComposer = useCallback(
    (
      nextAnchor: Date = anchor,
      point: EventComposerDraft["point"] = null,
      endsAt?: Date,
    ) => {
      setSelectedEvent(null);
      setSelectedTodoId(null);
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

  // Refetch whenever the user pages forward/back or switches view —
  // each combination implies a different EventKit query window.
  const range = useMemo(
    () => rangeForView(view, anchor, timeZone),
    [view, anchor, timeZone],
  );

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
        if (!cancelled) setTodos(sortCalendarTodos(next));
      })
      .catch(() => {
        // Quiet failure — todos are an overlay, not core to the calendar
        // surface. The Todos surface itself surfaces real errors.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Local calendars also live in workspace.db — completely independent
  // of EventKit. Load once on mount; CRUD callbacks below keep state
  // in sync after the initial fetch.
  useEffect(() => {
    let cancelled = false;
    localCalendarListCalendars()
      .then((rows) => {
        if (!cancelled) {
          setLocalCalendars(rows);
          setLocalCalendarsLoaded(true);
        }
      })
      .catch(() => {
        // Quiet — local calendar is optional. Errors will resurface
        // the next time the user attempts a CRUD action via setMessage.
        if (!cancelled) setLocalCalendarsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Local events refetch whenever the visible range changes, mirroring
  // the EventKit fetch but driven from workspace.db. Independent of
  // auth — runs even when calendar permission is denied.
  useEffect(() => {
    let cancelled = false;
    localCalendarFetchEvents({
      startsAt: range.startsAt,
      endsAt: range.endsAt,
      calendarIds: [],
    })
      .then((rows) => {
        if (!cancelled) setLocalEvents(rows);
      })
      .catch(() => {
        // Quiet — same rationale as the calendar list above.
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

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
      setSelectedTodoId(null);
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
      setSelectedTodoId(null);
      setSelectedEvent(row);
      setLocalEventUndo(null);
    } catch (error) {
      setLocalCalendarMessage(`Failed to restore event: ${String(error)}`);
    }
  }, [localEventUndo, upsertLocalEvent]);

  const upsertTodo = useCallback((row: TodoRow) => {
    setTodos((prev) =>
      sortCalendarTodos([
        ...prev.filter((todo) => todo.id !== row.id),
        row,
      ]),
    );
  }, []);

  const selectedTodo = useMemo(
    () => todos.find((todo) => todo.id === selectedTodoId) ?? null,
    [selectedTodoId, todos],
  );

  const handleTodoSelect = useCallback((todo: TodoRow) => {
    setComposerDraft(null);
    setSelectedEvent(null);
    setSelectedTodoId(todo.id);
  }, []);

  const handleEventSelect = useCallback((event: CalendarEvent) => {
    setComposerDraft(null);
    setSelectedTodoId(null);
    setSelectedEvent(event);
  }, []);

  const updateTodo = useCallback(
    async (
      todo: TodoRow,
      patch: TodoUpdatePatch,
      failureLabel = "update todo",
    ) => {
      setTodoMessage(null);
      try {
        const updated = await todosUpdate({ id: todo.id, ...patch });
        upsertTodo(updated);
      } catch (error) {
        setTodoMessage(`Failed to ${failureLabel}: ${formatTodoOverlayError(error)}`);
      }
    },
    [upsertTodo],
  );

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
          upsertTodo(updated);
        })
        .catch((error) => {
          setTodoMessage(`Failed to update todo: ${formatTodoOverlayError(error)}`);
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
    [upsertTodo],
  );

  const applyTodoPreset = useCallback(
    (todo: TodoRow, preset: TodoSchedulePreset) =>
      updateTodo(todo, todoPresetUpdateParams(preset), "schedule todo"),
    [updateTodo],
  );

  const clearTodoPlanning = useCallback(
    (todo: TodoRow) =>
      updateTodo(todo, clearTodoPlanningUpdateParams(), "clear todo schedule"),
    [updateTodo],
  );

  const scheduleTodoAt = useCallback(
    (
      todo: TodoRow,
      scheduledStartAt: number,
      estimatedMinutes: number | null,
    ) =>
      updateTodo(
        todo,
        todoScheduleAtUpdateParams(scheduledStartAt, estimatedMinutes),
        "schedule todo",
      ),
    [updateTodo],
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

  const sourceSidebar = useMemo(
    () => (
      <SourceSidebar
        sources={mergedSources}
        calendarsBySource={calendarsBySource}
        visible={selectedCalendarIds}
        message={localCalendarMessage}
        onToggleVisible={toggleCalendar}
        onCreateLocalCalendar={() => void createLocalCalendar()}
        onRenameLocalCalendar={(id, title) =>
          void updateLocalCalendar(id, { title })
        }
        onRecolorLocalCalendar={(id, colorHex) =>
          void updateLocalCalendar(id, { colorHex })
        }
        onArchiveLocalCalendar={(id) => void archiveLocalCalendar(id)}
      />
    ),
    [
      archiveLocalCalendar,
      calendarsBySource,
      createLocalCalendar,
      localCalendarMessage,
      mergedSources,
      selectedCalendarIds,
      toggleCalendar,
      updateLocalCalendar,
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
        `${reason === "auto" ? "Auto-synced" : "Synced"} ${payload.events.length} events. SHA ${result.fileSha.slice(0, 8) || "updated"}.`,
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

  const enableLocalOnlyMode = useCallback(() => {
    try {
      localStorage.setItem(LOCAL_ONLY_STORAGE_KEY, "true");
    } catch {
      // Storage may be disabled in some sandboxes — proceed in
      // memory-only mode; the user just has to re-skip on next launch.
    }
    setLocalOnlyMode(true);
  }, []);

  if (auth === "notDetermined" && !localOnlyMode) {
    return (
      <PermissionGate
        onRequest={requestAccess}
        onSkip={enableLocalOnlyMode}
        error={errorMessage}
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
            <WorkspaceCommandButton
              tone="ghost"
              onClick={() => setSettingsPanelOpen((open) => !open)}
              aria-pressed={settingsPanelOpen}
              title="Calendar settings"
            >
              <Settings2
                absoluteStrokeWidth
                aria-hidden="true"
                size={14}
                strokeWidth={1.7}
              />
              Settings
            </WorkspaceCommandButton>
            <WorkspaceCommandButton
              tone="ghost"
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
            <WorkspaceCommandButton
              className="calendar-commandbar__publish-button"
              tone={hasPendingSyncChanges ? "accent" : "ghost"}
              onClick={() => setPublishPanelOpen((open) => !open)}
              aria-pressed={publishPanelOpen}
              title={
                lastSyncSnapshot
                  ? `Publish panel: +${syncPreviewDiff.added.length} · ~${syncPreviewDiff.visibilityChanged.length} · -${syncPreviewDiff.removed.length}`
                  : "Open website calendar publish panel"
              }
            >
              Publish
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
              placeholder="Search events…"
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
                …
              </span>
            ) : null}
          </div>
          <label className="calendar-time-zone-select">
            <span>Time zone</span>
            <select
              value={timeZone}
              onChange={(event) => handleTimeZoneChange(event.currentTarget.value)}
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
        {settingsPanelOpen ? (
          <CalendarSettingsPanel
            calendarsBySource={calendarsBySource}
            sources={mergedSources}
            timeZone={timeZone}
            visible={selectedCalendarIds}
            onClose={() => setSettingsPanelOpen(false)}
            onCreateLocalCalendar={() => void createLocalCalendar()}
            onSetCalendarVisible={setCalendarVisible}
            onSetSourceVisible={setSourceVisible}
            onTimeZoneChange={handleTimeZoneChange}
          />
        ) : null}
        {publishPanelOpen ? (
          <CalendarPublishPanel
            calendarDefaults={calendarDefaults}
            calendars={mergedCalendars}
            diff={syncPreviewDiff}
            hasBaseline={lastSyncSnapshot !== null}
            health={syncHealth}
            publishMessage={publishMessage}
            publishState={publishState}
            rulesEditorOpen={rulesEditorOpen}
            rulesLoaded={rulesLoaded}
            summary={publishSummary}
            onClose={() => setPublishPanelOpen(false)}
            onRulesSaved={() => setSmartRulesRevision((rev) => rev + 1)}
            onSetCalendarDefault={setCalendarDefault}
            onSync={() => void syncCalendarProjection("manual")}
            onToggleRulesEditor={() => setRulesEditorOpen((open) => !open)}
          />
        ) : null}
      </div>
      <div
        className="panel-shell__body calendar-surface-body"
      >
        <CalendarTodoTray
          anchor={anchor}
          expanded={todoTrayExpanded}
          todos={todos}
          message={todoMessage}
          onClear={clearTodoPlanning}
          onPreset={applyTodoPreset}
          onScheduleAt={scheduleTodoAt}
          onToggleExpanded={() => setTodoTrayExpanded((expanded) => !expanded)}
          onTodoSelect={handleTodoSelect}
          onTodoToggle={handleTodoToggle}
        />
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
            selectedEvent && isLocalEventId(selectedEvent.eventIdentifier) ? (
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
            ) : selectedTodo ? (
              <CalendarTodoInspector
                key={selectedTodo.id}
                todo={selectedTodo}
                onClear={() => void clearTodoPlanning(selectedTodo)}
                onClose={() => setSelectedTodoId(null)}
                onPreset={(preset) => void applyTodoPreset(selectedTodo, preset)}
                onToggle={(completed) =>
                  handleTodoToggle(selectedTodo.id, completed)
                }
                onUpdate={(patch, failureLabel) =>
                  void updateTodo(selectedTodo, patch, failureLabel)
                }
                onScheduleAt={(scheduledStartAt, estimatedMinutes) =>
                  void scheduleTodoAt(
                    selectedTodo,
                    scheduledStartAt,
                    estimatedMinutes,
                  )
                }
              />
            ) : null}
        >
          <ViewPane
            view={view}
            anchor={anchor}
            events={visibleEvents}
            calendarsById={calendarsById}
            todos={todos}
            loadState={localOnlyMode ? "ready" : loadState}
            errorMessage={localOnlyMode ? null : errorMessage}
            getDisclosure={getDisclosure}
            timeZone={timeZone}
            onEventSelect={handleEventSelect}
            onSlotCreate={({ startsAt, endsAt, point }) =>
              openEventComposer(startsAt, point, endsAt)
            }
            onTodoSelect={handleTodoSelect}
            onTodoToggle={handleTodoToggle}
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

function sortCalendarTodos(rows: readonly TodoRow[]): TodoRow[] {
  return [...rows].sort((a, b) => {
    const aDone = a.completedAt ? 1 : 0;
    const bDone = b.completedAt ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    const aTime = todoTimelineStart(a) ?? Number.MAX_SAFE_INTEGER;
    const bTime = todoTimelineStart(b) ?? Number.MAX_SAFE_INTEGER;
    if (aTime !== bTime) return aTime - bTime;
    return a.sortOrder - b.sortOrder;
  });
}

function formatTodoOverlayError(error: unknown): string {
  const message = String(error);
  if (
    message.includes("invoke") ||
    message.includes("__TAURI_INTERNALS__") ||
    message.includes("is not a function")
  ) {
    return "Todo data is available in the desktop app.";
  }
  return message;
}

function formatTodoPlanningMeta(todo: TodoRow): string {
  const start = todoTimelineStart(todo);
  const parts: string[] = [];
  if (todo.scheduledStartAt !== null && start !== null) {
    parts.push(`Scheduled ${formatShortDate(start)} ${formatClockTime(start)}`);
  } else if (todo.dueAt !== null) {
    parts.push(`Due ${formatShortDate(todo.dueAt)}`);
  } else {
    parts.push("No date");
  }
  if (todo.estimatedMinutes !== null) {
    parts.push(`${todo.estimatedMinutes}m`);
  }
  return parts.join(" / ");
}

function formatShortDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function formatClockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
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

function CalendarTodoTray({
  anchor,
  expanded,
  todos,
  message,
  onClear,
  onPreset,
  onScheduleAt,
  onToggleExpanded,
  onTodoSelect,
  onTodoToggle,
}: {
  anchor: Date;
  expanded: boolean;
  todos: TodoRow[];
  message: string | null;
  onClear: (todo: TodoRow) => void;
  onPreset: (todo: TodoRow, preset: TodoSchedulePreset) => void;
  onScheduleAt: (
    todo: TodoRow,
    scheduledStartAt: number,
    estimatedMinutes: number | null,
  ) => void;
  onToggleExpanded: () => void;
  onTodoSelect: (todo: TodoRow) => void;
  onTodoToggle: (id: string, completed: boolean) => void;
}) {
  const unscheduled = useMemo(
    () =>
      sortCalendarTodos(
        todos.filter(
          (todo) =>
            todo.archivedAt === null &&
            todo.completedAt === null &&
            todo.scheduledStartAt === null,
        ),
      ),
    [todos],
  );
  const visible = unscheduled.slice(0, 6);
  return (
    <section
      className="calendar-todo-tray"
      aria-label="Unscheduled todos"
      data-empty={unscheduled.length === 0 ? "true" : undefined}
      data-expanded={expanded ? "true" : undefined}
    >
      <div className="calendar-todo-tray__header">
        <div>
          <strong>Unscheduled Todos</strong>
          <span>{unscheduled.length} unscheduled</span>
        </div>
        <div className="calendar-todo-tray__header-actions">
          {unscheduled.length > visible.length ? (
            <span className="calendar-todo-tray__overflow">
              +{unscheduled.length - visible.length} more in Todos
            </span>
          ) : null}
          <button
            type="button"
            className="calendar-todo-tray__toggle"
            aria-expanded={expanded}
            onClick={onToggleExpanded}
          >
            {expanded ? "Hide" : "Plan"}
          </button>
        </div>
      </div>
      {message ? (
        <p className="calendar-todo-tray__message" role="status">
          {message}
        </p>
      ) : null}
      {!expanded ? null : visible.length === 0 ? (
        <p className="calendar-todo-tray__empty">
          Nothing to schedule.
        </p>
      ) : (
        <ul className="calendar-todo-tray__list" role="list">
          {visible.map((todo) => (
            <CalendarTodoTrayItem
              anchor={anchor}
              key={todo.id}
              todo={todo}
              onClear={onClear}
              onPreset={onPreset}
              onScheduleAt={onScheduleAt}
              onTodoSelect={onTodoSelect}
              onTodoToggle={onTodoToggle}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function CalendarTodoTrayItem({
  anchor,
  todo,
  onClear,
  onPreset,
  onScheduleAt,
  onTodoSelect,
  onTodoToggle,
}: {
  anchor: Date;
  todo: TodoRow;
  onClear: (todo: TodoRow) => void;
  onPreset: (todo: TodoRow, preset: TodoSchedulePreset) => void;
  onScheduleAt: (
    todo: TodoRow,
    scheduledStartAt: number,
    estimatedMinutes: number | null,
  ) => void;
  onTodoSelect: (todo: TodoRow) => void;
  onTodoToggle: (id: string, completed: boolean) => void;
}) {
  const [dateValue, setDateValue] = useState(() =>
    dateInputValue(todo.dueAt ?? anchor.getTime()),
  );
  const [timeValue, setTimeValue] = useState(() =>
    timeInputValue(todo.scheduledStartAt) || "09:00",
  );
  const [durationValue, setDurationValue] = useState(() =>
    String(todo.estimatedMinutes ?? 30),
  );

  const scheduleExact = () => {
    const scheduledStartAt = dateAndTimeInputToTimestamp(dateValue, timeValue);
    if (scheduledStartAt === null) return;
    onScheduleAt(
      todo,
      scheduledStartAt,
      estimateInputToMinutes(durationValue) ?? 30,
    );
  };

  return (
    <li className="calendar-todo-tray__item">
      <button
        type="button"
        className="calendar-todo-tray__check"
        aria-label="Mark done"
        onClick={() => onTodoToggle(todo.id, true)}
      >
        <span aria-hidden="true" />
      </button>
      <button
        type="button"
        className="calendar-todo-tray__body"
        onClick={() => onTodoSelect(todo)}
      >
        <strong>{todo.title || "(Untitled)"}</strong>
        <span>{formatTodoPlanningMeta(todo)}</span>
      </button>
      <div className="calendar-todo-tray__quick" aria-label="Quick schedule">
        {TODO_SCHEDULE_PRESETS.map((preset) => (
          <button
            type="button"
            key={preset}
            onClick={() => onPreset(todo, preset)}
          >
            {todoSchedulePresetLabel(preset)}
          </button>
        ))}
        <button
          type="button"
          disabled={todo.dueAt === null}
          onClick={() => onClear(todo)}
        >
          Clear
        </button>
      </div>
      <form
        className="calendar-todo-tray__schedule"
        onSubmit={(event) => {
          event.preventDefault();
          scheduleExact();
        }}
      >
        <input
          aria-label="Schedule date"
          type="date"
          value={dateValue}
          onChange={(event) => setDateValue(event.currentTarget.value)}
        />
        <input
          aria-label="Schedule time"
          type="time"
          value={timeValue}
          onChange={(event) => setTimeValue(event.currentTarget.value)}
        />
        <input
          aria-label="Duration minutes"
          min="1"
          max="1440"
          type="number"
          value={durationValue}
          onChange={(event) => setDurationValue(event.currentTarget.value)}
        />
        <button type="submit">Block</button>
      </form>
    </li>
  );
}

function CalendarTodoInspector({
  todo,
  onClear,
  onClose,
  onPreset,
  onScheduleAt,
  onToggle,
  onUpdate,
}: {
  todo: TodoRow;
  onClear: () => void;
  onClose: () => void;
  onPreset: (preset: TodoSchedulePreset) => void;
  onScheduleAt: (scheduledStartAt: number, estimatedMinutes: number | null) => void;
  onToggle: (completed: boolean) => void;
  onUpdate: (patch: TodoUpdatePatch, failureLabel?: string) => void;
}) {
  const [titleDraft, setTitleDraft] = useState(todo.title);
  const [notesDraft, setNotesDraft] = useState(todo.notes);

  const commitTitle = () => {
    const next = titleDraft.trim();
    if (!next || next === todo.title) {
      setTitleDraft(todo.title);
      return;
    }
    onUpdate({ title: next }, "rename todo");
  };

  const commitNotes = () => {
    if (notesDraft === todo.notes) return;
    onUpdate({ notes: notesDraft }, "update todo notes");
  };

  const updateScheduledTime = (value: string) => {
    const scheduledStartAt = dateTimeInputToTimestamp(value);
    if (scheduledStartAt === null) {
      onUpdate(
        {
          scheduledEndAt: null,
          scheduledStartAt: null,
        },
        "update todo schedule",
      );
      return;
    }
    onScheduleAt(scheduledStartAt, todo.estimatedMinutes);
  };

  const updateEstimate = (value: string) => {
    const estimatedMinutes = estimateInputToMinutes(value);
    onUpdate(
      {
        estimatedMinutes,
        scheduledEndAt:
          todo.scheduledStartAt === null || estimatedMinutes === null
            ? null
            : todo.scheduledStartAt + estimatedMinutes * 60_000,
      },
      "update todo estimate",
    );
  };

  return (
    <WorkspaceInspector
      className="calendar-inspector calendar-todo-inspector"
      label="Todo"
      style={{
        border: 0,
        borderRadius: 0,
        padding: "14px",
      }}
    >
      <WorkspaceInspectorHeader
        heading={todo.title || "(Untitled)"}
        kicker="Todo"
        actions={
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        }
      />
      <div className="workspace-inspector__body">
        <WorkspaceInspectorSection heading="Task">
          <WorkspaceTextField
            label="Title"
            value={titleDraft}
            onBlur={commitTitle}
            onChange={(event) => setTitleDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setTitleDraft(todo.title);
                event.currentTarget.blur();
              }
            }}
          />
          <WorkspaceTextareaField
            label="Notes"
            rows={4}
            value={notesDraft}
            onBlur={commitNotes}
            onChange={(event) => setNotesDraft(event.currentTarget.value)}
          />
          <WorkspaceCheckboxField
            checked={todo.completedAt !== null}
            onChange={(event) => onToggle(event.currentTarget.checked)}
          >
            Completed
          </WorkspaceCheckboxField>
        </WorkspaceInspectorSection>
        <WorkspaceInspectorSection heading="Planning">
          <div className="calendar-todo-inspector__quick">
            {TODO_SCHEDULE_PRESETS.map((preset) => (
              <button
                type="button"
                className="btn btn--ghost"
                key={preset}
                onClick={() => onPreset(preset)}
              >
                {todoSchedulePresetLabel(preset)}
              </button>
            ))}
            <button type="button" className="btn btn--ghost" onClick={onClear}>
              Clear
            </button>
          </div>
          <WorkspaceTextField
            label="Due date"
            type="date"
            value={dateInputValue(todo.dueAt)}
            onChange={(event) =>
              onUpdate(
                { dueAt: dateInputToTimestamp(event.currentTarget.value) },
                "update todo due date",
              )
            }
          />
          <WorkspaceTextField
            label="Scheduled time"
            type="datetime-local"
            value={dateTimeInputValue(todo.scheduledStartAt)}
            onChange={(event) => updateScheduledTime(event.currentTarget.value)}
          />
          <WorkspaceTextField
            label="Estimate minutes"
            min="1"
            max="1440"
            type="number"
            value={todo.estimatedMinutes ?? ""}
            onChange={(event) => updateEstimate(event.currentTarget.value)}
          />
        </WorkspaceInspectorSection>
        <WorkspaceInspectorSection heading="Status">
          <dl className="workspace-inspector__meta">
            <div>
              <dt>Planning</dt>
              <dd>{formatTodoPlanningMeta(todo)}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatDateTime(new Date(todo.updatedAt).toISOString())}</dd>
            </div>
          </dl>
        </WorkspaceInspectorSection>
      </div>
    </WorkspaceInspector>
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
  timeZone,
  onEventSelect,
  onSlotCreate,
  onTodoSelect,
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
  timeZone: string;
  onEventSelect: (event: CalendarEvent) => void;
  onSlotCreate: (selection: CalendarTimeSlotSelection) => void;
  onTodoSelect: (todo: TodoRow) => void;
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
          timeZone={timeZone}
          onEventSelect={onEventSelect}
          onSlotCreate={onSlotCreate}
          onTodoSelect={onTodoSelect}
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
          timeZone={timeZone}
          onEventSelect={onEventSelect}
          onSlotCreate={onSlotCreate}
          onTodoSelect={onTodoSelect}
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
          timeZone={timeZone}
          onDayCreate={onSlotCreate}
          onEventSelect={onEventSelect}
        />
      );
    case "agenda":
      return (
        <AgendaView
          events={events}
          calendarsById={calendarsById}
          todos={todos}
          rangeLabel={formatViewTitle("agenda", anchor, timeZone)}
          getDisclosure={getDisclosure}
          timeZone={timeZone}
          onEventSelect={onEventSelect}
          onTodoSelect={onTodoSelect}
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

function CalendarSettingsPanel({
  calendarsBySource,
  sources,
  timeZone,
  visible,
  onClose,
  onCreateLocalCalendar,
  onSetCalendarVisible,
  onSetSourceVisible,
  onTimeZoneChange,
}: {
  calendarsBySource: ReadonlyMap<string, Calendar[]>;
  sources: readonly CalendarSource[];
  timeZone: string;
  visible: ReadonlySet<string>;
  onClose: () => void;
  onCreateLocalCalendar: () => void;
  onSetCalendarVisible: (calendarId: string, visible: boolean) => void;
  onSetSourceVisible: (sourceId: string, visible: boolean) => void;
  onTimeZoneChange: (timeZone: string) => void;
}) {
  const totalCalendars = sources.reduce(
    (count, source) => count + (calendarsBySource.get(source.id)?.length ?? 0),
    0,
  );
  const visibleCalendars = sources.reduce(
    (count, source) =>
      count +
      (calendarsBySource.get(source.id)?.filter((calendar) =>
        visible.has(calendar.id),
      ).length ?? 0),
    0,
  );
  return (
    <section className="calendar-settings-panel" aria-label="Calendar settings">
      <header className="calendar-settings-panel__header">
        <div>
          <strong>Calendar Settings</strong>
          <span>
            {visibleCalendars}/{totalCalendars} visible ·{" "}
            {calendarTimeZoneLabel(timeZone)}
          </span>
        </div>
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="calendar-settings-panel__summary">
        <label className="calendar-settings-panel__timezone">
          <span>Display time zone</span>
          <select
            value={timeZone}
            onChange={(event) => onTimeZoneChange(event.currentTarget.value)}
          >
            {CALENDAR_TIME_ZONE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn"
          onClick={onCreateLocalCalendar}
        >
          New Workspace calendar
        </button>
      </div>
      <div className="calendar-settings-panel__accounts">
        {sources.map((source) => {
          const sourceCalendars = calendarsBySource.get(source.id) ?? [];
          const sourceVisibleCount = sourceCalendars.filter((calendar) =>
            visible.has(calendar.id),
          ).length;
          const allVisible =
            sourceCalendars.length > 0 &&
            sourceVisibleCount === sourceCalendars.length;
          return (
            <article className="calendar-settings-account" key={source.id}>
              <header className="calendar-settings-account__header">
                <div>
                  <strong>{source.title}</strong>
                  <span>
                    {source.sourceType} · {sourceVisibleCount}/
                    {sourceCalendars.length || 0}
                  </span>
                </div>
                {sourceCalendars.length > 0 ? (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => onSetSourceVisible(source.id, !allVisible)}
                  >
                    {allVisible ? "Hide all" : "Show all"}
                  </button>
                ) : null}
              </header>
              {sourceCalendars.length === 0 ? (
                <p className="calendar-settings-account__empty">
                  No calendars in this account.
                </p>
              ) : (
                <div className="calendar-settings-account__list">
                  {sourceCalendars.map((calendar) => (
                    <label
                      className="calendar-settings-calendar"
                      key={calendar.id}
                    >
                      <input
                        type="checkbox"
                        checked={visible.has(calendar.id)}
                        onChange={(event) =>
                          onSetCalendarVisible(
                            calendar.id,
                            event.currentTarget.checked,
                          )
                        }
                      />
                      <span
                        className="calendar-settings-calendar__swatch"
                        style={{ background: calendar.colorHex }}
                        aria-hidden="true"
                      />
                      <span className="calendar-settings-calendar__title">
                        {calendar.title}
                      </span>
                      <span className="calendar-settings-calendar__meta">
                        {calendar.allowsModifications
                          ? isLocalCalendarId(calendar.id)
                            ? "Workspace"
                            : "Writable"
                          : "Read only"}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CalendarPublishPanel({
  calendarDefaults,
  calendars,
  diff,
  hasBaseline,
  health,
  publishMessage,
  publishState,
  rulesEditorOpen,
  rulesLoaded,
  summary,
  onClose,
  onRulesSaved,
  onSetCalendarDefault,
  onSync,
  onToggleRulesEditor,
}: {
  calendarDefaults: ReadonlyMap<string, CalendarPublicVisibility>;
  calendars: readonly Calendar[];
  diff: ReturnType<typeof diffSnapshots>;
  hasBaseline: boolean;
  health: CalendarSyncHealth;
  publishMessage: string;
  publishState: PublishState;
  rulesEditorOpen: boolean;
  rulesLoaded: boolean;
  summary: PublishSummary;
  onClose: () => void;
  onRulesSaved: () => void;
  onSetCalendarDefault: (
    calendarId: string,
    visibility: CalendarPublicVisibility,
  ) => void;
  onSync: () => void;
  onToggleRulesEditor: () => void;
}) {
  const publishCalendars = calendars.filter(
    (calendar) => !isLocalCalendarId(calendar.id),
  );

  return (
    <section className="calendar-publish-panel" aria-label="Website calendar publish">
      <header className="calendar-publish-panel__header">
        <div>
          <strong>Website Publish</strong>
          <span>Public calendar settings.</span>
        </div>
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="calendar-publish-panel__status">
        <CalendarPublishSummary summary={summary} />
        <CalendarSyncHealthPill health={health} state={publishState} />
        <SyncPreviewChip diff={diff} hasBaseline={hasBaseline} />
      </div>
      <div className="calendar-publish-panel__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={publishState === "publishing" || !rulesLoaded}
          onClick={onSync}
        >
          {publishState === "publishing" ? "Syncing..." : "Sync now"}
        </button>
        <button type="button" className="btn" onClick={onToggleRulesEditor}>
          {rulesEditorOpen ? "Hide rules" : "Edit rules"}
        </button>
      </div>
      {publishMessage ? (
        <p
          className={
            publishState === "error"
              ? "calendar-sync-error"
              : "calendar-publish-panel__message"
          }
        >
          {publishMessage}
        </p>
      ) : null}
      <CalendarSyncHealthPanel health={health} state={publishState} />
      <section className="calendar-publish-defaults">
        <header>
          <h3>Calendar defaults</h3>
          <p>Used when no event rule applies.</p>
        </header>
        {publishCalendars.length === 0 ? (
          <p className="calendar-publish-defaults__empty">
            No platform calendars loaded.
          </p>
        ) : (
          <div className="calendar-publish-defaults__list">
            {publishCalendars.map((calendar) => {
              const currentDefault = calendarDefaults.get(calendar.id) ?? "busy";
              return (
                <label key={calendar.id} className="calendar-publish-defaults__row">
                  <span
                    className="calendar-publish-defaults__swatch"
                    style={{ background: calendar.colorHex }}
                    aria-hidden="true"
                  />
                  <span className="calendar-publish-defaults__title">
                    {calendar.title}
                  </span>
                  <select
                    value={currentDefault}
                    onChange={(event) =>
                      onSetCalendarDefault(
                        calendar.id,
                        event.currentTarget.value as CalendarPublicVisibility,
                      )
                    }
                  >
                    {DEFAULT_VISIBILITY_LABELS.map((option) => (
                      <option
                        key={option.value}
                        value={option.value}
                        title={option.hint}
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        )}
      </section>
      {rulesEditorOpen ? (
        <SmartRulesEditor
          onClose={onToggleRulesEditor}
          onRulesSaved={onRulesSaved}
        />
      ) : null}
    </section>
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
              Loading rules...
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
}: {
  onRequest: () => void;
  onSkip: () => void;
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
          Use macOS calendars or stay local in Workspace.
        </p>
      </header>
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn btn--primary" onClick={onRequest}>
          Allow access
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
      <div className="mt-3">
        <button type="button" className="btn btn--primary" onClick={onSkip}>
          Use Workspace calendar instead
        </button>
      </div>
    </section>
  );
}
