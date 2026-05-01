import { useMemo, useState } from "react";
import { ChevronRight, MoreHorizontal, Plus, Trash2 } from "lucide-react";

import {
  LOCAL_CALENDAR_SOURCE_ID,
  isLocalCalendarId,
} from "../../modules/calendar/localCalendarApi";
import { WorkspaceSidebarRow } from "../../ui/primitives";
import type { Calendar, CalendarSource } from "./types";

const SOURCE_ORDER_STORAGE_KEY = "workspace.calendar.sourceOrder.v1";
const SOURCE_COLLAPSED_STORAGE_KEY = "workspace.calendar.sourceCollapsed.v1";

type CollapseMap = Record<string, boolean>;

function loadStringList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function saveStringList(key: string, value: readonly string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures; in-memory order still works for the session.
  }
}

function loadCollapseMap(key: string): CollapseMap {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: CollapseMap = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === "boolean") out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function saveCollapseMap(key: string, value: CollapseMap) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures; in-memory collapse state still works.
  }
}

function orderSources(
  sources: readonly CalendarSource[],
  sourceOrder: readonly string[],
): CalendarSource[] {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const ordered: CalendarSource[] = [];
  const seen = new Set<string>();
  for (const id of sourceOrder) {
    const source = byId.get(id);
    if (!source || seen.has(id)) continue;
    ordered.push(source);
    seen.add(id);
  }
  for (const source of sources) {
    if (seen.has(source.id)) continue;
    ordered.push(source);
  }
  return ordered;
}

/** Workspace context pane showing every account header (EKSource) with
 * its calendars, mirroring the macOS Calendar sidebar grouping. The
 * checkbox state is owned by `CalendarSurface` so all views (Day,
 * Week, Month, Agenda) share a single filter. */
export function SourceSidebar({
  sources,
  calendarsBySource,
  visible,
  message,
  onToggleVisible,
  onCreateLocalCalendar,
  onRenameLocalCalendar,
  onRecolorLocalCalendar,
  onArchiveLocalCalendar,
}: {
  sources: CalendarSource[];
  calendarsBySource: Map<string, Calendar[]>;
  visible: Set<string>;
  /** Optional inline status / error from the parent (e.g. "failed to
   * archive workspace calendar"). Surfaces just below the section
   * header so the user sees feedback even without the inspector. */
  message?: string | null;
  onToggleVisible: (id: string) => void;
  /** Spawn a new local-first calendar under the synthetic Workspace
   * source. The parent owns the actual create call (so optimistic
   * state stays single-sourced); we just trigger it. */
  onCreateLocalCalendar?: () => void | Promise<void>;
  /** Rename a local calendar in place. EventKit calendars can't be
   * renamed from this surface — the row just won't expose the affordance. */
  onRenameLocalCalendar?: (id: string, title: string) => void;
  onRecolorLocalCalendar?: (id: string, colorHex: string) => void;
  onArchiveLocalCalendar?: (id: string) => void;
}) {
  const [sourceOrder, setSourceOrder] = useState<string[]>(() =>
    loadStringList(SOURCE_ORDER_STORAGE_KEY),
  );
  const [sourceCollapsed, setSourceCollapsed] = useState<CollapseMap>(() =>
    loadCollapseMap(SOURCE_COLLAPSED_STORAGE_KEY),
  );
  const [draggingSourceId, setDraggingSourceId] = useState<string | null>(null);
  const [dragOverSource, setDragOverSource] = useState<{
    edge: "before" | "after";
    id: string;
  } | null>(null);
  const orderedSources = useMemo(
    () => orderSources(sources, sourceOrder),
    [sourceOrder, sources],
  );
  const visibleSourceGroups = useMemo(
    () =>
      orderedSources.filter(
        (source) =>
          // Always keep the synthetic Workspace source, even when it
          // has no calendars yet — that's where the "+ New" affordance
          // lives, and hiding it would mean the user has no entry
          // point to create their first local calendar.
          source.id === LOCAL_CALENDAR_SOURCE_ID ||
          (calendarsBySource.get(source.id) ?? []).length > 0,
      ),
    [calendarsBySource, orderedSources],
  );
  const [visibleCalendarCount, calendarCount] = useMemo(
    () => {
      let loaded = 0;
      let selected = 0;
      for (const source of visibleSourceGroups) {
        const calendars = calendarsBySource.get(source.id) ?? [];
        loaded += calendars.length;
        selected += calendars.filter((calendar) => visible.has(calendar.id)).length;
      }
      return [selected, loaded] as const;
    },
    [calendarsBySource, visible, visibleSourceGroups],
  );

  function toggleSourceCollapsed(sourceId: string) {
    setSourceCollapsed((prev) => {
      const next = { ...prev, [sourceId]: !prev[sourceId] };
      saveCollapseMap(SOURCE_COLLAPSED_STORAGE_KEY, next);
      return next;
    });
  }

  function moveSourceTo(
    sourceId: string,
    targetSourceId: string,
    edge: "before" | "after",
  ) {
    if (sourceId === targetSourceId) return;
    const ids = visibleSourceGroups
      .map((source) => source.id)
      .filter((id) => id !== sourceId);
    const targetIndex = ids.indexOf(targetSourceId);
    if (targetIndex < 0) return;
    const insertIndex = edge === "after" ? targetIndex + 1 : targetIndex;
    ids.splice(insertIndex, 0, sourceId);
    setSourceOrder(ids);
    saveStringList(SOURCE_ORDER_STORAGE_KEY, ids);
  }

  return (
    <section
      className="calendar-source-sidebar sidebar-context-section"
      aria-label="Calendar sources"
    >
      <div className="calendar-source-sidebar__header">
        <p className="sidebar-context-section__label">Calendars</p>
        {calendarCount > 0 ? (
          <span className="sidebar-context-section__count">
            {visibleCalendarCount}/{calendarCount}
          </span>
        ) : null}
      </div>
      {sources.length === 0 ? (
        <p className="calendar-source-sidebar__empty">
          No accounts found. Add one in System Settings - Internet Accounts.
        </p>
      ) : null}
      {message ? (
        <p
          className="calendar-source-sidebar__empty"
          role="status"
          style={{ color: "var(--color-text-danger, #b00020)" }}
        >
          {message}
        </p>
      ) : null}
      {visibleSourceGroups.map((src) => {
        const cals = calendarsBySource.get(src.id) ?? [];
        const isLocalSource = src.id === LOCAL_CALENDAR_SOURCE_ID;
        // Hide non-local sources with no calendars; the synthetic
        // Workspace source stays visible because that's where the
        // "+ New" affordance lives.
        if (cals.length === 0 && !isLocalSource) return null;
        const collapsed = Boolean(sourceCollapsed[src.id]);
        const listId = `calendar-source-list-${src.id.replace(/[^a-z0-9_-]/gi, "_")}`;
        return (
          <section
            key={src.id}
            className="calendar-source-group"
            data-collapsed={collapsed ? "true" : undefined}
          >
            <WorkspaceSidebarRow
              className="calendar-source-group__header"
              depth={0}
              dragging={draggingSourceId === src.id}
              data-drop-edge={
                dragOverSource?.id === src.id ? dragOverSource.edge : undefined
              }
              onDragOver={(event) => {
                if (
                  !Array.from(event.dataTransfer.types).includes(
                    "application/x-calendar-source",
                  )
                ) {
                  return;
                }
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const rect = event.currentTarget.getBoundingClientRect();
                const edge =
                  event.clientY < rect.top + rect.height / 2 ? "before" : "after";
                setDragOverSource({ id: src.id, edge });
              }}
              onDragLeave={() => {
                if (dragOverSource?.id === src.id) setDragOverSource(null);
              }}
              onDrop={(event) => {
                const sourceId = event.dataTransfer.getData(
                  "application/x-calendar-source",
                );
                event.preventDefault();
                event.stopPropagation();
                const edge = dragOverSource?.id === src.id
                  ? dragOverSource.edge
                  : "after";
                setDragOverSource(null);
                setDraggingSourceId(null);
                if (sourceId) moveSourceTo(sourceId, src.id, edge);
              }}
            >
              <button
                type="button"
                className="calendar-source-group__toggle"
                draggable
                aria-controls={listId}
                aria-expanded={!collapsed}
                onClick={() => toggleSourceCollapsed(src.id)}
                onDragStart={(event) => {
                  event.dataTransfer.setData("application/x-calendar-source", src.id);
                  event.dataTransfer.effectAllowed = "move";
                  setDraggingSourceId(src.id);
                }}
                onDragEnd={() => {
                  setDraggingSourceId(null);
                  setDragOverSource(null);
                }}
              >
                <span className="calendar-source-group__chevron" aria-hidden="true">
                  <ChevronRight absoluteStrokeWidth size={10} strokeWidth={2} />
                </span>
                <span className="calendar-source-group__title">{src.title}</span>
                {cals.length > 0 ? (
                  <span className="calendar-source-group__count">{cals.length}</span>
                ) : null}
                <span className="calendar-source-group__drag" aria-hidden="true" />
              </button>
              {isLocalSource && onCreateLocalCalendar ? (
                <button
                  type="button"
                  className="calendar-source-group__add"
                  aria-label="Add a workspace calendar"
                  title="Add a workspace calendar"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCreateLocalCalendar();
                  }}
                >
                  <Plus absoluteStrokeWidth size={12} strokeWidth={1.6} />
                </button>
              ) : null}
            </WorkspaceSidebarRow>
            {!collapsed ? (
              <ul id={listId} className="calendar-source-group__list">
                {cals.length === 0 && isLocalSource ? (
                  <li className="calendar-source-row__empty">
                    {onCreateLocalCalendar ? (
                      <button
                        type="button"
                        className="calendar-source-row__empty-action"
                        onClick={() => {
                          void onCreateLocalCalendar();
                        }}
                      >
                        Create workspace calendar
                      </button>
                    ) : null}
                  </li>
                ) : null}
                {cals.map((cal) => {
                  const isLocal = isLocalCalendarId(cal.id);
                  return (
                    <li key={cal.id}>
                      <WorkspaceSidebarRow className="calendar-source-row" depth={1}>
                        <label className="calendar-source-row__main">
                          <input
                            type="checkbox"
                            style={{ accentColor: cal.colorHex }}
                            checked={visible.has(cal.id)}
                            onChange={() => onToggleVisible(cal.id)}
                            title="Show in Workspace"
                          />
                          <span
                            className="calendar-source-row__swatch"
                            style={{ background: cal.colorHex }}
                            aria-hidden="true"
                          />
                          <span className="calendar-source-row__title">
                            {cal.title}
                          </span>
                        </label>
                        {isLocal ? (
                          <details className="calendar-source-row__menu">
                            <summary
                              className="calendar-source-row__menu-button"
                              aria-label={`Manage ${cal.title}`}
                            >
                              <MoreHorizontal
                                absoluteStrokeWidth
                                size={13}
                                strokeWidth={1.8}
                              />
                            </summary>
                            <div className="calendar-source-row__menu-popover">
                              {onRenameLocalCalendar ? (
                                <label className="calendar-source-row__menu-field">
                                  <span>Name</span>
                                  <input
                                    type="text"
                                    defaultValue={cal.title}
                                    onBlur={(event) => {
                                      const next = event.currentTarget.value.trim();
                                      if (next && next !== cal.title) {
                                        onRenameLocalCalendar(cal.id, next);
                                      }
                                      if (!next) {
                                        event.currentTarget.value = cal.title;
                                      }
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        event.currentTarget.blur();
                                      }
                                      if (event.key === "Escape") {
                                        event.currentTarget.value = cal.title;
                                        event.currentTarget.blur();
                                      }
                                    }}
                                  />
                                </label>
                              ) : null}
                              {onRecolorLocalCalendar ? (
                                <label className="calendar-source-row__menu-field calendar-source-row__menu-field--inline">
                                  <span>Color</span>
                                  <input
                                    type="color"
                                    value={cal.colorHex}
                                    onChange={(event) =>
                                      onRecolorLocalCalendar(
                                        cal.id,
                                        event.currentTarget.value,
                                      )
                                    }
                                    aria-label={`Color for ${cal.title}`}
                                  />
                                </label>
                              ) : null}
                              {onArchiveLocalCalendar ? (
                                <button
                                  type="button"
                                  className="calendar-source-row__menu-action"
                                  onClick={() => onArchiveLocalCalendar(cal.id)}
                                >
                                  <Trash2
                                    absoluteStrokeWidth
                                    size={13}
                                    strokeWidth={1.7}
                                  />
                                  Archive calendar
                                </button>
                              ) : null}
                            </div>
                          </details>
                        ) : null}
                      </WorkspaceSidebarRow>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        );
      })}
    </section>
  );
}
