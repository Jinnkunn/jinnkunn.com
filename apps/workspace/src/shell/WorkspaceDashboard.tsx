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
  calendarAuthorizationStatus,
  calendarFetchEvents,
} from "../surfaces/calendar/api";
import { addDays, startOfDay } from "../surfaces/calendar/dateRange";
import type {
  CalendarAuthorizationStatus,
  CalendarEvent,
} from "../surfaces/calendar/types";
import type { DashboardActionContribution } from "../modules/types";
import type { SurfaceDefinition } from "../surfaces/types";
import { WorkspaceEmptyState } from "../ui/primitives";
import {
  CONTEXT_MENU_SEPARATOR,
  copyTextToClipboard,
  showContextMenuWithActions,
} from "./contextMenu";
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
  onRemoveRecent: (entry: SidebarRecentItem) => void;
  onSelectNavItem: (surfaceId: string, navItemId: string) => void;
  onSelectSurface: (id: string) => void;
  onToggleFavorite: (entry: SidebarFavorite) => void;
  isFavorite: (surfaceId: string, itemId: string) => boolean;
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
  onRemoveRecent,
  onSelectNavItem,
  onSelectSurface,
  onToggleFavorite,
  isFavorite,
  recentItems,
  surfaces,
}: WorkspaceDashboardProps) {
  const dashboardActions = getDashboardActions().filter((action) => {
    const surface = surfaces.find((entry) => entry.id === action.surfaceId);
    return surface && !surface.disabled;
  });
  const todayLabel = useMemo(() => formatDashboardDate(), []);
  const hasRail =
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
    <section className="workspace-dashboard" aria-label="Site console">
      <header className="workspace-dashboard__hero">
        <div>
          <p className="workspace-dashboard__eyebrow">Jinnkunn</p>
          <h1>Site Console</h1>
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
          <span>Search</span>
        </button>
      </header>

      <div className="workspace-dashboard__layout" data-has-rail={hasRail}>
        <main className="workspace-dashboard__primary">
          <ToolLauncherPanel
            actions={dashboardActions}
            onOpenAction={openAction}
            onSelectSurface={onSelectSurface}
            surfaces={surfaces}
          />
          <TodayUpcomingPanel
            onSelectSurface={onSelectSurface}
            surfaces={surfaces}
          />
        </main>

        {hasRail ? (
          <aside className="workspace-dashboard__rail" aria-label="Workspace summary">
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
                        onContextMenu={(event) => {
                          event.preventDefault();
                          const favoriteEntry = {
                            itemId: item.itemId,
                            label: item.label,
                            surfaceId: item.surfaceId,
                          };
                          const pinned = isFavorite(item.surfaceId, item.itemId);
                          showContextMenuWithActions([
                            {
                              label: "Open",
                              run: () => {
                                onRecordRecent({
                                  itemId: item.itemId,
                                  label: item.label,
                                  surfaceId: item.surfaceId,
                                  surfaceTitle: item.surfaceTitle,
                                });
                                onSelectNavItem(item.surfaceId, item.itemId);
                              },
                            },
                            {
                              label: pinned
                                ? "Unpin from favorites"
                                : "Pin to favorites",
                              run: () => onToggleFavorite(favoriteEntry),
                            },
                            CONTEXT_MENU_SEPARATOR,
                            {
                              label: "Remove from Recent",
                              run: () => onRemoveRecent(item),
                            },
                          ]);
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
                        onContextMenu={(event) => {
                          event.preventDefault();
                          showContextMenuWithActions([
                            {
                              label: "Open",
                              run: () => {
                                onRecordRecent({
                                  itemId: item.itemId,
                                  label: item.label,
                                  surfaceId: item.surfaceId,
                                  surfaceTitle: surfaceTitle(
                                    surfaces,
                                    item.surfaceId,
                                  ),
                                });
                                onSelectNavItem(item.surfaceId, item.itemId);
                              },
                            },
                            CONTEXT_MENU_SEPARATOR,
                            {
                              label: "Unpin from favorites",
                              run: () => onToggleFavorite(item),
                            },
                          ]);
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
                      onContextMenu={(menuEvent) => {
                        menuEvent.preventDefault();
                        showContextMenuWithActions([
                          {
                            label: "Copy activity",
                            run: () =>
                              copyTextToClipboard(
                                [event.title, event.detail]
                                  .filter(Boolean)
                                  .join("\n"),
                              ),
                          },
                          {
                            label: "Clear all activity",
                            run: onClearEvents,
                          },
                        ]);
                      }}
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

function ToolLauncherPanel({
  actions,
  onOpenAction,
  onSelectSurface,
  surfaces,
}: {
  actions: readonly DashboardActionContribution[];
  onOpenAction: (action: DashboardActionContribution) => void;
  onSelectSurface: (id: string) => void;
  surfaces: readonly SurfaceDefinition[];
}) {
  const toolSurfaces = surfaces.filter(
    (surface) => surface.id !== "workspace" && !surface.disabled,
  );
  if (!toolSurfaces.length) return null;

  return (
    <section className="workspace-dashboard__panel workspace-dashboard__panel--tools">
      <div className="workspace-dashboard__panel-header">
        <h2>Tools</h2>
        <span>{toolSurfaces.length}</span>
      </div>
      <div className="workspace-dashboard__tool-grid">
        {toolSurfaces.map((surface) => {
          const surfaceActions = actions.filter(
            (action) => action.surfaceId === surface.id,
          );
          return (
            <section className="workspace-dashboard__tool-card" key={surface.id}>
              <button
                type="button"
                className="workspace-dashboard__tool-main"
                onClick={() => onSelectSurface(surface.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  showContextMenuWithActions([
                    {
                      label: "Open",
                      run: () => onSelectSurface(surface.id),
                    },
                    {
                      label: "Copy name",
                      run: () => copyTextToClipboard(surface.title),
                    },
                  ]);
                }}
              >
                <DashboardIcon
                  fallback={
                    <Zap absoluteStrokeWidth size={14} strokeWidth={1.7} />
                  }
                >
                  {surface.icon}
                </DashboardIcon>
                <span>
                  <strong>{surface.title}</strong>
                  {surface.description ? <small>{surface.description}</small> : null}
                </span>
              </button>
              {surfaceActions.length ? (
                <div className="workspace-dashboard__tool-actions">
                  {surfaceActions.map((action) => (
                    <button
                      type="button"
                      key={action.id}
                      onClick={() => onOpenAction(action)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        showContextMenuWithActions([
                          {
                            label: "Open",
                            run: () => onOpenAction(action),
                          },
                          {
                            label: "Copy label",
                            run: () => copyTextToClipboard(action.label),
                          },
                        ]);
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </section>
  );
}

interface TodayUpcomingItem {
  endsAt?: number;
  id: string;
  title: string;
  meta: string;
  timestamp: number;
  timeLabel: string;
  tone: "event";
}

interface TodayUpcomingState {
  auth: CalendarAuthorizationStatus | null;
  error: string | null;
  events: CalendarEvent[];
  loading: boolean;
}

function TodayUpcomingPanel({
  onSelectSurface,
  surfaces,
}: {
  onSelectSurface: (id: string) => void;
  surfaces: readonly SurfaceDefinition[];
}) {
  const calendarEnabled = isSurfaceEnabled(surfaces, "calendar");
  const [state, setState] = useState<TodayUpcomingState>({
    auth: null,
    error: null,
    events: [],
    loading: true,
  });
  const [renderNowMs] = useState(() => Date.now());

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
      };
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
  }, [calendarEnabled]);

  const { later, next, now } = useMemo(
    () => buildTodayWorkbenchItems(state.events),
    [state.events],
  );
  const featuredItem = now[0] ?? next[0] ?? later[0] ?? null;
  const nowItems = featuredItem?.id === now[0]?.id ? now.slice(1) : now;
  const nextItems = featuredItem?.id === next[0]?.id ? next.slice(1) : next;
  const laterItems = featuredItem?.id === later[0]?.id ? later.slice(1) : later;
  const calendarUnavailable =
    calendarEnabled && state.auth !== null && !isCalendarAuthorized(state.auth);
  const totalCount = now.length + next.length + later.length;
  const empty = totalCount === 0;

  const openItem = (item: TodayUpcomingItem) => {
    void item;
    onSelectSurface("calendar");
  };

  const showItemContextMenu = (item: TodayUpcomingItem) => {
    showContextMenuWithActions([
      {
        label: "Open in Calendar",
        run: () => openItem(item),
      },
      {
        label: "Copy title",
        run: () => copyTextToClipboard(item.title),
      },
      {
        label: "Copy time",
        run: () => copyTextToClipboard(item.timeLabel),
      },
    ]);
  };

  return (
    <section className="workspace-dashboard__panel workspace-dashboard__panel--wide workspace-dashboard__panel--today">
      <div className="workspace-dashboard__panel-header">
        <h2>Calendar Today</h2>
        {totalCount > 0 ? <span>{totalCount}</span> : null}
      </div>
      {state.loading ? (
        <WorkspaceEmptyState compact title="Loading calendar" />
      ) : empty ? (
        <WorkspaceEmptyState compact title="No events" />
      ) : (
        <>
          {featuredItem ? (
            <button
              type="button"
              className="workspace-dashboard__next"
              data-tone={featuredItem.tone}
              onClick={() => openItem(featuredItem)}
              onContextMenu={(event) => {
                event.preventDefault();
                showItemContextMenu(featuredItem);
              }}
            >
              <span className="workspace-dashboard__next-kicker">
                {featuredItem.timestamp <= renderNowMs + 2 * 60 * 60_000
                  ? "Now"
                  : "Next"}
              </span>
              <strong>{featuredItem.title}</strong>
              <small>{featuredItem.meta} / {featuredItem.timeLabel}</small>
            </button>
          ) : null}
          <div className="workspace-dashboard__today-grid">
            <TimelineBucket
              items={nowItems}
              label="Now"
              onOpenItem={openItem}
              onContextMenu={showItemContextMenu}
            />
            <TimelineBucket
              items={nextItems}
              label="Next"
              onOpenItem={openItem}
              onContextMenu={showItemContextMenu}
            />
            <TimelineBucket
              items={laterItems}
              label="Later"
              onOpenItem={openItem}
              onContextMenu={showItemContextMenu}
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
  onContextMenu,
}: {
  items: TodayUpcomingItem[];
  label: string;
  onOpenItem: (item: TodayUpcomingItem) => void;
  onContextMenu: (item: TodayUpcomingItem) => void;
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
                onContextMenu={(event) => {
                  event.preventDefault();
                  onContextMenu(item);
                }}
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

function buildTodayWorkbenchItems(
  events: readonly CalendarEvent[],
): {
  later: TodayUpcomingItem[];
  next: TodayUpcomingItem[];
  now: TodayUpcomingItem[];
} {
  const todayStart = startOfDay(new Date());
  const todayEnd = addDays(todayStart, 1);
  const windowEnd = addDays(todayStart, 8).getTime();
  const nowMs = Date.now();
  const focusEndMs = nowMs + 2 * 60 * 60_000;
  const todayStartMs = todayStart.getTime();
  const todayEndMs = todayEnd.getTime();
  const items: TodayUpcomingItem[] = [];

  for (const event of events) {
    const timestamp = new Date(event.startsAt).getTime();
    const endsAt = new Date(event.endsAt).getTime();
    if (!Number.isFinite(timestamp) || timestamp >= windowEnd) continue;
    if (
      !event.isAllDay &&
      Number.isFinite(endsAt) &&
      endsAt < nowMs - 5 * 60_000
    ) {
      continue;
    }
    items.push({
      endsAt: Number.isFinite(endsAt) ? endsAt : undefined,
      id: `event:${event.eventIdentifier}:${event.startsAt}`,
      meta: "Calendar event",
      timestamp,
      timeLabel: event.isAllDay ? "All day" : formatTimelineTime(timestamp),
      title: event.title || "(No title)",
      tone: "event",
    });
  }

  items.sort((left, right) => left.timestamp - right.timestamp);
  return {
    now: items.filter((item) =>
      item.timestamp < todayStartMs ||
      item.timestamp <= focusEndMs ||
      (item.endsAt !== undefined &&
        item.timestamp <= nowMs &&
        item.endsAt >= nowMs),
    ),
    next: items.filter((item) =>
      item.timestamp >= focusEndMs && item.timestamp < todayEndMs,
    ),
    later: items.filter((item) =>
      item.timestamp >= todayEndMs && item.timestamp < windowEnd,
    ),
  };
}

function formatTimelineTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
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
