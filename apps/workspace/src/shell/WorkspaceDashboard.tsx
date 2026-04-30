import { useEffect, useMemo, useState } from "react";

import { getDashboardActions } from "../modules/registry";
import {
  todosList,
  type TodoRow,
} from "../modules/todos/api";
import {
  todoTimelineKind,
  todoTimelineStart,
} from "../modules/todos/time";
import {
  calendarAuthorizationStatus,
  calendarFetchEvents,
} from "../surfaces/calendar/api";
import { addDays, startOfDay } from "../surfaces/calendar/dateRange";
import type {
  CalendarAuthorizationStatus,
  CalendarEvent,
} from "../surfaces/calendar/types";
import {
  TODOS_TODAY_NAV_ID,
  TODOS_UPCOMING_NAV_ID,
} from "../surfaces/todos/nav";
import type { DashboardActionContribution } from "../modules/types";
import type { SurfaceDefinition } from "../surfaces/types";
import type { SidebarFavorite } from "./favorites";
import type { SidebarRecentItem } from "./recent";
import type { WorkspaceEvent } from "./workspaceEvents";

interface WorkspaceDashboardProps {
  events: readonly WorkspaceEvent[];
  favorites: readonly SidebarFavorite[];
  onClearEvents: () => void;
  onOpenCommandPalette: () => void;
  onRecordRecent: (entry: Omit<SidebarRecentItem, "visitedAt">) => void;
  onSelectNavItem: (surfaceId: string, navItemId: string) => void;
  onSelectSurface: (id: string) => void;
  recentItems: readonly SidebarRecentItem[];
  surfaces: readonly SurfaceDefinition[];
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function surfaceTitle(
  surfaces: readonly SurfaceDefinition[],
  surfaceId: string,
  fallback = surfaceId,
): string {
  return surfaces.find((surface) => surface.id === surfaceId)?.title ?? fallback;
}

function isCalendarAuthorized(status: CalendarAuthorizationStatus): boolean {
  return status === "fullAccess" || status === "writeOnly";
}

function isSurfaceEnabled(
  surfaces: readonly SurfaceDefinition[],
  surfaceId: string,
): boolean {
  const surface = surfaces.find((entry) => entry.id === surfaceId);
  return Boolean(surface && !surface.disabled);
}

export function WorkspaceDashboard({
  events,
  favorites,
  onClearEvents,
  onOpenCommandPalette,
  onRecordRecent,
  onSelectNavItem,
  onSelectSurface,
  recentItems,
  surfaces,
}: WorkspaceDashboardProps) {
  const tools = surfaces.filter((surface) => surface.id !== "workspace");
  const dashboardActions = getDashboardActions().filter((action) => {
    const surface = surfaces.find((entry) => entry.id === action.surfaceId);
    return surface && !surface.disabled;
  });

  const openAction = (action: DashboardActionContribution) => {
    const target = surfaces.find((surface) => surface.id === action.surfaceId);
    if (!target || target.disabled) return;
    if (action.navItemId) {
      onRecordRecent({
        itemId: action.navItemId,
        label: action.label,
        surfaceId: action.surfaceId,
        surfaceTitle: target.title,
      });
      onSelectNavItem(action.surfaceId, action.navItemId);
      return;
    }
    onSelectSurface(action.surfaceId);
  };

  return (
    <section className="workspace-dashboard" aria-label="Workspace dashboard">
      <header className="workspace-dashboard__hero">
        <div>
          <p className="workspace-dashboard__eyebrow">Jinnkunn Workspace</p>
          <h1>Command center</h1>
          <p>{tools.length} tools / {recentItems.length} recent / {favorites.length} pinned</p>
        </div>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={onOpenCommandPalette}
        >
          Open Command Menu
        </button>
      </header>

      <div className="workspace-dashboard__grid">
        <section className="workspace-dashboard__panel workspace-dashboard__panel--wide">
          <div className="workspace-dashboard__panel-header">
            <h2>Launch</h2>
            <span>Staging-first workspace</span>
          </div>
          <div className="workspace-dashboard__action-grid">
            {dashboardActions.map((action) => (
              <button
                type="button"
                className="workspace-dashboard__action"
                key={action.id}
                onClick={() => openAction(action)}
              >
                <span>{action.label}</span>
                <small>{action.description}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="workspace-dashboard__panel">
          <div className="workspace-dashboard__panel-header">
            <h2>Tools</h2>
            <span>{tools.length}</span>
          </div>
          <div className="workspace-dashboard__tool-list">
            {tools.map((surface) => (
              <button
                type="button"
                className="workspace-dashboard__tool"
                key={surface.id}
                onClick={() => onSelectSurface(surface.id)}
                disabled={surface.disabled}
              >
                <span className="workspace-dashboard__tool-icon" aria-hidden="true">
                  {surface.icon}
                </span>
                <span>
                  <strong>{surface.title}</strong>
                  {surface.description ? <small>{surface.description}</small> : null}
                </span>
              </button>
            ))}
          </div>
        </section>

        <TodayUpcomingPanel
          onRecordRecent={onRecordRecent}
          onSelectNavItem={onSelectNavItem}
          onSelectSurface={onSelectSurface}
          surfaces={surfaces}
        />

        <section className="workspace-dashboard__panel">
          <div className="workspace-dashboard__panel-header">
            <h2>Recent</h2>
            <span>{recentItems.length}</span>
          </div>
          {recentItems.length ? (
            <ul className="workspace-dashboard__list" role="list">
              {recentItems.slice(0, 6).map((item) => (
                <li key={`${item.surfaceId}:${item.itemId}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onRecordRecent({
                        itemId: item.itemId,
                        label: item.label,
                        surfaceId: item.surfaceId,
                        surfaceTitle: item.surfaceTitle,
                      });
                      onSelectNavItem(item.surfaceId, item.itemId);
                    }}
                  >
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.surfaceTitle}</small>
                    </span>
                    <time>{formatRelativeTime(item.visitedAt)}</time>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="workspace-dashboard__empty">No recent items.</p>
          )}
        </section>

        <section className="workspace-dashboard__panel">
          <div className="workspace-dashboard__panel-header">
            <h2>Pinned</h2>
            <span>{favorites.length}</span>
          </div>
          {favorites.length ? (
            <ul className="workspace-dashboard__list" role="list">
              {favorites.slice(0, 6).map((item) => (
                <li key={`${item.surfaceId}:${item.itemId}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onRecordRecent({
                        itemId: item.itemId,
                        label: item.label,
                        surfaceId: item.surfaceId,
                        surfaceTitle: surfaceTitle(surfaces, item.surfaceId),
                      });
                      onSelectNavItem(item.surfaceId, item.itemId);
                    }}
                  >
                    <span>
                      <strong>{item.label}</strong>
                      <small>{surfaceTitle(surfaces, item.surfaceId)}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="workspace-dashboard__empty">No pinned shortcuts.</p>
          )}
        </section>

        <section className="workspace-dashboard__panel workspace-dashboard__panel--wide">
          <div className="workspace-dashboard__panel-header">
            <h2>Activity</h2>
            {events.length ? (
              <button
                type="button"
                className="workspace-dashboard__text-button"
                onClick={onClearEvents}
              >
                Clear
              </button>
            ) : (
              <span>0</span>
            )}
          </div>
          {events.length ? (
            <ul className="workspace-activity-list" role="list">
              {events.slice(0, 8).map((event) => (
                <li
                  className="workspace-activity-list__item"
                  data-tone={event.tone}
                  key={event.id}
                >
                  <span className="workspace-activity-list__dot" aria-hidden="true" />
                  <span className="workspace-activity-list__body">
                    <strong>{event.title}</strong>
                    {event.detail ? <small>{event.detail}</small> : null}
                  </span>
                  <span className="workspace-activity-list__meta">
                    {event.source} / {formatRelativeTime(event.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="workspace-dashboard__empty">No activity yet.</p>
          )}
        </section>
      </div>
    </section>
  );
}

interface TodayUpcomingItem {
  id: string;
  kind: "event" | "todo";
  title: string;
  meta: string;
  timestamp: number;
  tone: "event" | "scheduled" | "due";
}

interface TodayUpcomingState {
  auth: CalendarAuthorizationStatus | null;
  error: string | null;
  events: CalendarEvent[];
  loading: boolean;
  todos: TodoRow[];
}

function TodayUpcomingPanel({
  onRecordRecent,
  onSelectNavItem,
  onSelectSurface,
  surfaces,
}: {
  onRecordRecent: (entry: Omit<SidebarRecentItem, "visitedAt">) => void;
  onSelectNavItem: (surfaceId: string, navItemId: string) => void;
  onSelectSurface: (id: string) => void;
  surfaces: readonly SurfaceDefinition[];
}) {
  const calendarEnabled = isSurfaceEnabled(surfaces, "calendar");
  const todosEnabled = isSurfaceEnabled(surfaces, "todos");
  const [state, setState] = useState<TodayUpcomingState>({
    auth: null,
    error: null,
    events: [],
    loading: true,
    todos: [],
  });

  useEffect(() => {
    let cancelled = false;
    const start = startOfDay(new Date());
    const end = addDays(start, 8);
    async function load() {
      const next: TodayUpcomingState = {
        auth: null,
        error: null,
        events: [],
        loading: false,
        todos: [],
      };
      try {
        if (todosEnabled) {
          next.todos = await todosList();
        }
      } catch (error) {
        next.error = formatWorkspaceDataError("Todos", error);
      }
      if (calendarEnabled) {
        try {
          next.auth = await calendarAuthorizationStatus();
          if (isCalendarAuthorized(next.auth)) {
            next.events = await calendarFetchEvents({
              calendarIds: [],
              endsAt: end.toISOString(),
              startsAt: start.toISOString(),
            });
          }
        } catch (error) {
          const calendarError = formatWorkspaceDataError("Calendar", error);
          next.error = next.error
            ? `${next.error} / ${calendarError}`
            : calendarError;
        }
      }
      if (!cancelled) setState(next);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [calendarEnabled, todosEnabled]);

  const { today, upcoming } = useMemo(
    () => buildTodayUpcomingItems(state.events, state.todos),
    [state.events, state.todos],
  );
  const calendarUnavailable =
    calendarEnabled && state.auth !== null && !isCalendarAuthorized(state.auth);
  const empty = today.length === 0 && upcoming.length === 0;

  const openItem = (item: TodayUpcomingItem) => {
    if (item.kind === "event") {
      onSelectSurface("calendar");
      return;
    }
    const navItemId = navItemForDashboardTodo(item);
    onRecordRecent({
      itemId: navItemId,
      label: item.timestamp < addDays(startOfDay(new Date()), 1).getTime()
        ? "Today"
        : "Upcoming",
      surfaceId: "todos",
      surfaceTitle: "Todos",
    });
    onSelectNavItem("todos", navItemId);
  };

  return (
    <section className="workspace-dashboard__panel workspace-dashboard__panel--wide workspace-dashboard__panel--today">
      <div className="workspace-dashboard__panel-header">
        <h2>Today / Upcoming</h2>
        <span>{today.length + upcoming.length}</span>
      </div>
      {state.loading ? (
        <p className="workspace-dashboard__empty">Loading schedule.</p>
      ) : empty ? (
        <p className="workspace-dashboard__empty">Nothing scheduled.</p>
      ) : (
        <div className="workspace-dashboard__today-grid">
          <TimelineBucket
            items={today}
            label="Today"
            onOpenItem={openItem}
          />
          <TimelineBucket
            items={upcoming}
            label="Upcoming"
            onOpenItem={openItem}
          />
        </div>
      )}
      {calendarUnavailable || state.error ? (
        <p className="workspace-dashboard__today-note">
          {state.error ?? "Calendar access is not enabled."}
        </p>
      ) : null}
    </section>
  );
}

function TimelineBucket({
  items,
  label,
  onOpenItem,
}: {
  items: TodayUpcomingItem[];
  label: string;
  onOpenItem: (item: TodayUpcomingItem) => void;
}) {
  return (
    <section className="workspace-dashboard__today-bucket">
      <div className="workspace-dashboard__today-label">{label}</div>
      {items.length ? (
        <ul className="workspace-dashboard__today-list" role="list">
          {items.slice(0, 7).map((item) => (
            <li key={item.id}>
              <button
                type="button"
                data-tone={item.tone}
                onClick={() => onOpenItem(item)}
              >
                <span className="workspace-dashboard__today-dot" aria-hidden="true" />
                <span className="workspace-dashboard__today-body">
                  <strong>{item.title}</strong>
                  <small>{item.meta}</small>
                </span>
                <time>{formatTimelineTime(item.timestamp)}</time>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="workspace-dashboard__empty">Clear.</p>
      )}
    </section>
  );
}

function buildTodayUpcomingItems(
  events: readonly CalendarEvent[],
  todos: readonly TodoRow[],
): {
  today: TodayUpcomingItem[];
  upcoming: TodayUpcomingItem[];
} {
  const todayStart = startOfDay(new Date());
  const todayEnd = addDays(todayStart, 1);
  const windowEnd = addDays(todayStart, 8).getTime();
  const todayStartMs = todayStart.getTime();
  const todayEndMs = todayEnd.getTime();
  const items: TodayUpcomingItem[] = [];

  for (const event of events) {
    const timestamp = new Date(event.startsAt).getTime();
    if (!Number.isFinite(timestamp) || timestamp >= windowEnd) continue;
    items.push({
      id: `event:${event.eventIdentifier}:${event.startsAt}`,
      kind: "event",
      meta: event.isAllDay ? "All day event" : "Calendar event",
      timestamp,
      title: event.title || "(No title)",
      tone: "event",
    });
  }

  for (const todo of todos) {
    if (todo.archivedAt !== null || todo.completedAt !== null) continue;
    const timestamp = todoTimelineStart(todo);
    if (timestamp === null || timestamp >= windowEnd) continue;
    const kind = todoTimelineKind(todo);
    items.push({
      id: `todo:${todo.id}`,
      kind: "todo",
      meta: formatTodoTimelineMeta(todo, timestamp),
      timestamp,
      title: todo.title || "(Untitled)",
      tone: kind === "scheduled" ? "scheduled" : "due",
    });
  }

  items.sort((left, right) => left.timestamp - right.timestamp);
  return {
    today: items.filter((item) =>
      item.timestamp < todayEndMs || item.timestamp < todayStartMs,
    ),
    upcoming: items.filter((item) =>
      item.timestamp >= todayEndMs && item.timestamp < windowEnd,
    ),
  };
}

function formatTodoTimelineMeta(todo: TodoRow, timestamp: number): string {
  const kind = todoTimelineKind(todo) === "scheduled" ? "Scheduled" : "Due";
  const day = timestamp < startOfDay(new Date()).getTime()
    ? "overdue"
    : new Date(timestamp).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
  const estimate = todo.estimatedMinutes ? ` / ${todo.estimatedMinutes}m` : "";
  return `${kind} ${day}${estimate}`;
}

function formatTimelineTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function navItemForDashboardTodo(item: TodayUpcomingItem): string {
  const tomorrowStart = addDays(startOfDay(new Date()), 1).getTime();
  return item.timestamp < tomorrowStart
    ? TODOS_TODAY_NAV_ID
    : TODOS_UPCOMING_NAV_ID;
}

function formatWorkspaceDataError(label: string, error: unknown): string {
  const message = String(error);
  if (
    message.includes("invoke") ||
    message.includes("__TAURI_INTERNALS__") ||
    message.includes("is not a function")
  ) {
    return `${label} data is available in the desktop app.`;
  }
  return `${label} unavailable.`;
}
