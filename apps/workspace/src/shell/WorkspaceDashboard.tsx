import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  Command,
  History,
  Pin,
  Zap,
} from "lucide-react";

import { getDashboardActions } from "../modules/registry";
import {
  todosListWindow,
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
import { WorkspaceEmptyState } from "../ui/primitives";
import type { SidebarFavorite } from "./favorites";
import type { SidebarRecentItem } from "./recent";
import type { WorkspaceEvent } from "./workspaceEvents";
import "../styles/surfaces/workspace-dashboard.css";

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

function surfaceIcon(
  surfaces: readonly SurfaceDefinition[],
  surfaceId: string,
): ReactNode {
  return surfaces.find((surface) => surface.id === surfaceId)?.icon ?? null;
}

function DashboardIcon({
  children,
  fallback,
}: {
  children?: ReactNode;
  fallback: ReactNode;
}) {
  return (
    <span className="workspace-dashboard__icon" aria-hidden="true">
      {children ?? fallback}
    </span>
  );
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

function formatDashboardDate(date = new Date()): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    weekday: "long",
  }).format(date);
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
  const dashboardActions = getDashboardActions().filter((action) => {
    const surface = surfaces.find((entry) => entry.id === action.surfaceId);
    return surface && !surface.disabled;
  });
  const todayLabel = useMemo(() => formatDashboardDate(), []);
  const hasRail =
    dashboardActions.length > 0 ||
    recentItems.length > 0 ||
    favorites.length > 0 ||
    events.length > 0;

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
          <p className="workspace-dashboard__eyebrow">Workspace</p>
          <h1>Today</h1>
          <p>{todayLabel}</p>
        </div>
        <button
          type="button"
          className="workspace-dashboard__command"
          onClick={onOpenCommandPalette}
        >
          <Command
            absoluteStrokeWidth
            aria-hidden="true"
            focusable="false"
            size={14}
            strokeWidth={1.7}
          />
          <span>Command Menu</span>
        </button>
      </header>

      <div className="workspace-dashboard__layout" data-has-rail={hasRail}>
        <main className="workspace-dashboard__primary">
          <TodayUpcomingPanel
            onRecordRecent={onRecordRecent}
            onSelectNavItem={onSelectNavItem}
            onSelectSurface={onSelectSurface}
            surfaces={surfaces}
          />
        </main>

        {hasRail ? (
          <aside className="workspace-dashboard__rail" aria-label="Workspace summary">
            {dashboardActions.length ? (
              <section className="workspace-dashboard__panel workspace-dashboard__panel--actions">
                <div className="workspace-dashboard__panel-header">
                  <h2>Actions</h2>
                  <span>{dashboardActions.length}</span>
                </div>
                <div className="workspace-dashboard__action-grid">
                  {dashboardActions.map((action) => (
                    <button
                      type="button"
                      className="workspace-dashboard__action"
                      key={action.id}
                      onClick={() => openAction(action)}
                    >
                      <DashboardIcon
                        fallback={
                          <Zap
                            absoluteStrokeWidth
                            size={14}
                            strokeWidth={1.7}
                          />
                        }
                      >
                        {surfaceIcon(surfaces, action.surfaceId)}
                      </DashboardIcon>
                      <span>
                        <strong>{action.label}</strong>
                        <small>{surfaceTitle(surfaces, action.surfaceId)}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {recentItems.length ? (
              <section className="workspace-dashboard__panel">
                <div className="workspace-dashboard__panel-header">
                  <h2>Recent</h2>
                  <span>{recentItems.length}</span>
                </div>
                <ul className="workspace-dashboard__list" role="list">
                  {recentItems.slice(0, 5).map((item) => (
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
                        <DashboardIcon
                          fallback={
                            <History
                              absoluteStrokeWidth
                              size={14}
                              strokeWidth={1.7}
                            />
                          }
                        >
                          {surfaceIcon(surfaces, item.surfaceId)}
                        </DashboardIcon>
                        <span>
                          <strong>{item.label}</strong>
                          <small>{item.surfaceTitle}</small>
                        </span>
                        <time>{formatRelativeTime(item.visitedAt)}</time>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {favorites.length ? (
              <section className="workspace-dashboard__panel">
                <div className="workspace-dashboard__panel-header">
                  <h2>Pinned</h2>
                  <span>{favorites.length}</span>
                </div>
                <ul className="workspace-dashboard__list" role="list">
                  {favorites.slice(0, 4).map((item) => (
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
                        <DashboardIcon
                          fallback={
                            <Pin
                              absoluteStrokeWidth
                              size={14}
                              strokeWidth={1.7}
                            />
                          }
                        >
                          {surfaceIcon(surfaces, item.surfaceId)}
                        </DashboardIcon>
                        <span>
                          <strong>{item.label}</strong>
                          <small>{surfaceTitle(surfaces, item.surfaceId)}</small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {events.length ? (
              <section className="workspace-dashboard__panel workspace-dashboard__panel--activity">
                <div className="workspace-dashboard__panel-header">
                  <h2>Activity</h2>
                  <button
                    type="button"
                    className="workspace-dashboard__text-button"
                    onClick={onClearEvents}
                  >
                    Clear
                  </button>
                </div>
                <ul className="workspace-activity-list" role="list">
                  {events.slice(0, 5).map((event) => (
                    <li
                      className="workspace-activity-list__item"
                      data-tone={event.tone}
                      key={event.id}
                    >
                      <DashboardIcon
                        fallback={
                          <Activity
                            absoluteStrokeWidth
                            size={14}
                            strokeWidth={1.7}
                          />
                        }
                      />
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
              </section>
            ) : null}
          </aside>
        ) : null}
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
  timeLabel: string;
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
          next.todos = await todosListWindow({
            startsAt: start.getTime(),
            endsAt: end.getTime(),
          });
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
          next.error = appendDashboardError(next.error, calendarError);
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
  const nextItem = today[0] ?? upcoming[0] ?? null;
  const todayItems = nextItem?.id === today[0]?.id ? today.slice(1) : today;
  const upcomingItems =
    nextItem?.id === upcoming[0]?.id ? upcoming.slice(1) : upcoming;
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
        <h2>Today</h2>
        {today.length + upcoming.length > 0 ? (
          <span>{today.length + upcoming.length}</span>
        ) : null}
      </div>
      {state.loading ? (
        <WorkspaceEmptyState compact title="Loading" />
      ) : empty ? (
        <WorkspaceEmptyState compact title="Clear" />
      ) : (
        <>
          {nextItem ? (
            <button
              type="button"
              className="workspace-dashboard__next"
              data-tone={nextItem.tone}
              onClick={() => openItem(nextItem)}
            >
              <span className="workspace-dashboard__next-kicker">Next</span>
              <strong>{nextItem.title}</strong>
              <small>{nextItem.meta} / {nextItem.timeLabel}</small>
            </button>
          ) : null}
          <div className="workspace-dashboard__today-grid">
            <TimelineBucket
              items={todayItems}
              label={nextItem?.id === today[0]?.id ? "Later Today" : "Today"}
              onOpenItem={openItem}
            />
            <TimelineBucket
              items={upcomingItems}
              label="Upcoming"
              onOpenItem={openItem}
            />
          </div>
        </>
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
                <time>{item.timeLabel}</time>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <WorkspaceEmptyState compact title="Clear" />
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
      meta: "Calendar event",
      timestamp,
      timeLabel: event.isAllDay ? "All day" : formatTimelineTime(timestamp),
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
      timeLabel: formatTimelineTime(timestamp),
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

function appendDashboardError(
  current: string | null,
  next: string,
): string {
  if (!current) return next;
  if (current === next) return current;
  return `${current} / ${next}`;
}

function formatWorkspaceDataError(label: string, error: unknown): string {
  const message = String(error);
  if (
    message.includes("invoke") ||
    message.includes("__TAURI_INTERNALS__") ||
    message.includes("is not a function")
  ) {
    return "Desktop data unavailable in preview.";
  }
  return `${label} unavailable.`;
}
