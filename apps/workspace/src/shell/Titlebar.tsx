import type { SurfaceDefinition, SurfaceNavItem } from "../surfaces/types";
import { ThemeToggle } from "./ThemeToggle";
import { handleWindowDragMouseDown } from "./windowDrag";

interface TitlebarProps {
  activeSurface: SurfaceDefinition;
  activeNavItemId: string | null;
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

/** Titlebar — thin strip pinned to the top of the window. The leading pad
 * reserves the sidebar's footprint so the breadcrumb starts past the
 * card's right edge. Native macOS traffic lights are repositioned into
 * the sidebar header by `set_traffic_lights_inset` (see
 * src-tauri/src/main.rs), so nothing is rendered here for them. */
export function Titlebar({
  activeSurface,
  activeNavItemId,
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
          <span className="workspace-status-center__dot" aria-hidden="true" />
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
          <p>Press ⌘⇧K for the global command palette.</p>
        </div>
      </details>
      <ThemeToggle />
    </header>
  );
}
