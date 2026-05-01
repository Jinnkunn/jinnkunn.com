import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

import { WorkspaceSidebarRow } from "../../ui/primitives";
import type { CalendarPublicVisibility } from "./publicProjection";
import type { Calendar, CalendarSource } from "./types";

const DEFAULT_VISIBILITY_LABELS: Array<{
  value: CalendarPublicVisibility;
  label: string;
  hint: string;
}> = [
  { value: "hidden", label: "Hidden", hint: "Skip every event in this calendar from /calendar" },
  { value: "busy", label: "Busy", hint: "Show as anonymous busy block on /calendar" },
  { value: "titleOnly", label: "Title", hint: "Show title + time, hide notes/location" },
  { value: "full", label: "Full", hint: "Show title, time, notes, location, URL" },
];

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
  calendarDefaults,
  onToggleVisible,
  onSetCalendarDefault,
}: {
  sources: CalendarSource[];
  calendarsBySource: Map<string, Calendar[]>;
  visible: Set<string>;
  /** Per-calendar default publish visibility. Calendars without an
   * entry fall back to the global "busy" default at projection time. */
  calendarDefaults: ReadonlyMap<string, CalendarPublicVisibility>;
  onToggleVisible: (id: string) => void;
  /** Update the default visibility for `calendarId`. Per-event
   * overrides still beat this — see `metadataForEvent` resolution
   * order in publicProjection.ts. */
  onSetCalendarDefault: (calendarId: string, visibility: CalendarPublicVisibility) => void;
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
        (source) => (calendarsBySource.get(source.id) ?? []).length > 0,
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
        <span className="sidebar-context-section__count">
          {visibleCalendarCount}/{calendarCount}
        </span>
      </div>
      {sources.length === 0 ? (
        <p className="calendar-source-sidebar__empty">
          No accounts found. Add one in System Settings - Internet Accounts.
        </p>
      ) : null}
      {visibleSourceGroups.map((src) => {
        const cals = calendarsBySource.get(src.id) ?? [];
        if (cals.length === 0) return null;
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
                <span className="calendar-source-group__count">{cals.length}</span>
                <span className="calendar-source-group__drag" aria-hidden="true" />
              </button>
            </WorkspaceSidebarRow>
            {!collapsed ? (
              <ul id={listId} className="calendar-source-group__list">
                {cals.map((cal) => {
                  const currentDefault =
                    calendarDefaults.get(cal.id) ?? "busy";
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
                          <span className="calendar-source-row__title">{cal.title}</span>
                        </label>
                        <select
                          // Default visibility for events in this
                          // calendar that don't have a per-event
                          // override. Saves the operator from
                          // classifying every recurring class meeting
                          // by hand. "Hidden" is the public-site off
                          // switch; all other values include the
                          // calendar on /calendar. Per-event overrides
                          // still win at resolution time.
                          className="calendar-source-row__default"
                          value={currentDefault}
                          onChange={(event) =>
                            onSetCalendarDefault(
                              cal.id,
                              event.target.value as CalendarPublicVisibility,
                            )
                          }
                          title="Default visibility for events in this calendar (per-event overrides win)"
                          aria-label={`Default visibility for ${cal.title}`}
                        >
                          {DEFAULT_VISIBILITY_LABELS.map((opt) => (
                            <option key={opt.value} value={opt.value} title={opt.hint}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
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
