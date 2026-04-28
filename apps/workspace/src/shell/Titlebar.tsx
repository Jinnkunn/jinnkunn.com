import type { SurfaceDefinition, SurfaceNavItem } from "../surfaces/types";
import { ThemeToggle } from "./ThemeToggle";
import { handleWindowDragMouseDown } from "./windowDrag";
import type { WorkspaceEvent, WorkspaceEventTone } from "./workspaceEvents";

interface TitlebarProps {
  activeSurface: SurfaceDefinition;
  activeNavItemId: string | null;
  events: readonly WorkspaceEvent[];
  favoriteCount: number;
  recentCount: number;
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

/** Titlebar — thin strip pinned to the top of the window. The leading pad
 * reserves the sidebar's footprint so the breadcrumb starts past the
 * card's right edge. Native macOS traffic lights are repositioned into
 * the sidebar header by `set_traffic_lights_inset` (see
 * src-tauri/src/main.rs), so nothing is rendered here for them. */
export function Titlebar({
  activeSurface,
  activeNavItemId,
  events,
  favoriteCount,
  recentCount,
}: TitlebarProps) {
  const activeNavLabel = activeNavItemId
    ? activeSurface.navGroups
      ?.flatMap((group) => group.items)
      .reduce<string | null>(
        (found, item) => found ?? findNavLabel([item], activeNavItemId),
        null,
      )
    : null;

  return (
    <header
      className="titlebar-shell"
      data-tauri-drag-region
      onMouseDown={handleWindowDragMouseDown}
    >
      <div className="titlebar-leading-pad" aria-hidden="true" />
      <div
        className="min-w-0 flex-1 flex items-center gap-2 text-[12.5px] text-text-secondary whitespace-nowrap overflow-hidden"
        data-tauri-drag-region
      >
        <span className="font-semibold text-text-primary">Jinnkunn Workspace</span>
        <span className="opacity-45" aria-hidden="true">›</span>
        <span
          className="text-text-primary font-medium truncate"
          aria-live="polite"
        >
          {activeSurface.title}
        </span>
        {activeNavLabel && (
          <>
            <span className="opacity-45" aria-hidden="true">›</span>
            <span
              className="text-text-primary font-medium truncate"
              aria-live="polite"
            >
              {activeNavLabel}
            </span>
          </>
        )}
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
