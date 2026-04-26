import type { SurfaceDefinition } from "../surfaces/types";
import { ThemeToggle } from "./ThemeToggle";

interface TitlebarProps {
  activeSurface: SurfaceDefinition;
  activeNavItemId: string | null;
}

/** Titlebar — thin strip pinned to the top of the window. The leading pad
 * reserves the sidebar's footprint so the breadcrumb starts past the
 * card's right edge. Native macOS traffic lights are repositioned into
 * the sidebar header by `set_traffic_lights_inset` (see
 * src-tauri/src/main.rs), so nothing is rendered here for them. */
export function Titlebar({ activeSurface, activeNavItemId }: TitlebarProps) {
  const activeNavLabel = activeNavItemId
    ? activeSurface.navGroups
      ?.flatMap((group) => group.items)
      .find((item) => item.id === activeNavItemId)?.label
    : null;

  return (
    <header className="titlebar-shell" data-tauri-drag-region>
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
      <ThemeToggle />
    </header>
  );
}
