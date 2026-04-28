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

interface DashboardAction {
  description: string;
  label: string;
  navItemId?: string;
  surfaceId?: string;
}

const DASHBOARD_ACTIONS: readonly DashboardAction[] = [
  {
    description: "Deploy health",
    label: "Site status",
    navItemId: "status",
    surfaceId: "site-admin",
  },
  {
    description: "Landing page",
    label: "Home editor",
    navItemId: "home",
    surfaceId: "site-admin",
  },
  {
    description: "Reusable blocks",
    label: "Shared content",
    navItemId: "components",
    surfaceId: "site-admin",
  },
  {
    description: "Daily schedule",
    label: "Calendar",
    surfaceId: "calendar",
  },
];

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

  const openAction = (action: DashboardAction) => {
    if (!action.surfaceId) return;
    if (action.navItemId) {
      onRecordRecent({
        itemId: action.navItemId,
        label: action.label,
        surfaceId: action.surfaceId,
        surfaceTitle: surfaceTitle(surfaces, action.surfaceId),
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
            {DASHBOARD_ACTIONS.map((action) => (
              <button
                type="button"
                className="workspace-dashboard__action"
                key={`${action.surfaceId}:${action.navItemId ?? "home"}`}
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
