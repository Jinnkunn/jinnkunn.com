import { PanelLeftClose, PanelLeftOpen, Plus, X } from "lucide-react";
import type { SurfaceDefinition, SurfaceNavItem } from "../surfaces/types";
import { ThemeToggle } from "./ThemeToggle";
import { handleWindowDragMouseDown } from "./windowDrag";
import type { WorkspaceEvent, WorkspaceEventTone } from "./workspaceEvents";

interface TitlebarProps {
  activeSurface: SurfaceDefinition;
  activeNavItemId: string | null;
  surfaces: readonly SurfaceDefinition[];
  events: readonly WorkspaceEvent[];
  favoriteCount: number;
  recentCount: number;
  tabs: readonly WorkspaceTitlebarTab[];
  activeTabId: string;
  sidebarCollapsed: boolean;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onSelectTab: (id: string) => void;
  onToggleSidebar: () => void;
}

export interface WorkspaceTitlebarTab {
  id: string;
  navItemId: string | null;
  surfaceId: string;
}

function findNavLabel(
  items: readonly SurfaceNavItem[] | undefined,
  id: string | null,
): string | null {
  if (!items || !id) return null;
  for (const item of items) {
    if (item.id === id) return item.label;
    const child = findNavLabel(item.children, id);
    if (child) return child;
  }
  return null;
}

function statusTone(events: readonly WorkspaceEvent[]): WorkspaceEventTone {
  const latest = events[0]?.tone;
  return latest === "error" || latest === "warn" || latest === "success"
    ? latest
    : "info";
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function SidebarCollapseIcon({ collapsed }: { collapsed: boolean }) {
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <Icon
      absoluteStrokeWidth
      aria-hidden="true"
      size={15}
      strokeWidth={1.65}
    />
  );
}

function CloseIcon() {
  return (
    <X absoluteStrokeWidth aria-hidden="true" size={12} strokeWidth={1.8} />
  );
}

function PlusIcon() {
  return (
    <Plus
      absoluteStrokeWidth
      aria-hidden="true"
      size={14}
      strokeWidth={1.7}
    />
  );
}

/** Titlebar — thin strip pinned to the top of the window. It owns the
 * sidebar toggle, tab strip, status center, and draggable empty space.
 * Native macOS traffic lights are positioned into this lane by
 * `set_traffic_lights_inset` (see src-tauri/src/main.rs). */
export function Titlebar({
  activeSurface,
  activeNavItemId,
  surfaces,
  events,
  favoriteCount,
  recentCount,
  tabs,
  activeTabId,
  sidebarCollapsed,
  onCloseTab,
  onNewTab,
  onSelectTab,
  onToggleSidebar,
}: TitlebarProps) {
  const activeNavLabel = activeNavItemId
    ? activeSurface.navGroups
      ?.flatMap((group) => group.items)
      .reduce<string | null>(
        (found, item) => found ?? findNavLabel([item], activeNavItemId),
        null,
      )
    : null;

  const labelForTab = (tab: WorkspaceTitlebarTab): string => {
    const surface = surfaces.find((entry) => entry.id === tab.surfaceId);
    const navLabel = tab.navItemId
      ? surface?.navGroups
        ?.flatMap((group) => group.items)
        .reduce<string | null>(
          (found, item) => found ?? findNavLabel([item], tab.navItemId),
          null,
        )
      : null;
    return navLabel || surface?.title || "Workspace";
  };

  return (
    <header
      className="titlebar-shell"
      data-tauri-drag-region
      onMouseDown={handleWindowDragMouseDown}
    >
      <div className="titlebar-window-zone" data-window-drag-exclude>
        <button
          type="button"
          className="titlebar-sidebar-toggle"
          onClick={onToggleSidebar}
          aria-controls="workspace-sidebar-context-pane"
          aria-expanded={!sidebarCollapsed}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <SidebarCollapseIcon collapsed={sidebarCollapsed} />
        </button>
      </div>
      <nav
        className="titlebar-tabs"
        aria-label="Workspace tabs"
        data-window-drag-exclude
      >
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const label = labelForTab(tab);
          return (
            <div
              className="titlebar-tab"
              data-active={active ? "true" : undefined}
              key={tab.id}
            >
              <button
                type="button"
                className="titlebar-tab__select"
                onClick={() => onSelectTab(tab.id)}
                aria-current={active ? "page" : undefined}
                title={label}
              >
                <span className="titlebar-tab__label">{label}</span>
              </button>
              <button
                type="button"
                className="titlebar-tab__close"
                onClick={() => onCloseTab(tab.id)}
                disabled={tabs.length <= 1}
                aria-label={`Close ${label}`}
                title="Close tab"
              >
                <CloseIcon />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="titlebar-tab-add"
          onClick={onNewTab}
          aria-label="New tab"
          title="New tab"
        >
          <PlusIcon />
        </button>
      </nav>
      <div className="titlebar-drag-fill" data-tauri-drag-region>
        <span className="titlebar-current-location" aria-live="polite">
          {activeSurface.title}
          {activeNavLabel ? ` / ${activeNavLabel}` : ""}
        </span>
      </div>
      <details className="workspace-status-center">
        <summary
          className="workspace-status-center__trigger"
          title="Workspace status"
          aria-label="Workspace status"
        >
          <span
            className="workspace-status-center__dot"
            data-tone={statusTone(events)}
            aria-hidden="true"
          />
          <span>Workspace</span>
        </summary>
        <div className="workspace-status-center__popover">
          <div>
            <strong>{activeSurface.title}</strong>
            <span>{activeNavLabel ?? "Surface home"}</span>
          </div>
          <div>
            <strong>{recentCount}</strong>
            <span>Recent items</span>
          </div>
          <div>
            <strong>{favoriteCount}</strong>
            <span>Pinned shortcuts</span>
          </div>
          <section className="workspace-status-center__activity" aria-label="Recent activity">
            <p>Activity</p>
            {events.length ? (
              events.slice(0, 4).map((event) => (
                <article
                  className="workspace-status-center__event"
                  data-tone={event.tone}
                  key={event.id}
                >
                  <span aria-hidden="true" />
                  <strong>{event.title}</strong>
                  <time>{formatRelativeTime(event.createdAt)}</time>
                </article>
              ))
            ) : (
              <span>No activity yet</span>
            )}
          </section>
          <p>Press ⌘⇧K for the global command palette.</p>
        </div>
      </details>
      <ThemeToggle />
    </header>
  );
}
