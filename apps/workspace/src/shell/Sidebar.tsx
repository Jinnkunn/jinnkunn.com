import type { SurfaceDefinition } from "../surfaces/types";

interface SidebarProps {
  surfaces: readonly SurfaceDefinition[];
  activeSurfaceId: string;
  onSelect: (id: string) => void;
}

/** Sidebar — floating rounded card containing the nav list. Ported from
 * personal-os `.sidebar-surface`.
 *
 * Thin on purpose: the shell only knows about "surfaces" (feature
 * modules). Anything tool-specific (API base URL, auth tokens, config
 * forms) lives inside the surface's own component so surfaces can't leak
 * into the shell. */
export function Sidebar({ surfaces, activeSurfaceId, onSelect }: SidebarProps) {
  return (
    <aside className="sidebar-surface" aria-label="Primary navigation">
      {/* 52px drag strip. The native macOS traffic lights are positioned
          inside this by `set_traffic_lights_inset` in src-tauri/main.rs. */}
      <div
        className="sidebar-header-strip"
        data-tauri-drag-region
        aria-hidden="true"
      />
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 pt-2 pb-3 flex flex-col gap-4">
        <div>
          <p className="m-0 mb-1.5 px-1.5 text-[11px] font-semibold tracking-[0.06em] uppercase text-text-muted">
            Workspace
          </p>
          <nav className="flex flex-col gap-0.5" role="tablist" aria-label="Surfaces">
            {surfaces.map((surface) => {
              const active = surface.id === activeSurfaceId;
              return (
                <button
                  key={surface.id}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  aria-current={active ? "page" : undefined}
                  className="sidebar-nav-item"
                  onClick={() => onSelect(surface.id)}
                  disabled={surface.disabled}
                  title={surface.description}
                >
                  <span className="sidebar-nav-item-icon">{surface.icon}</span>
                  <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    {surface.title}
                  </span>
                  {surface.disabled && (
                    <span className="text-[10px] uppercase tracking-wider text-text-muted">
                      soon
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>
      <footer className="px-3.5 py-3 border-t border-border-subtle bg-bg-sidebar">
        <p className="m-0 text-[12px] font-semibold text-text-primary">Jinnkunn Workspace</p>
        <p className="m-0 mt-0.5 text-[11px] text-text-muted">
          Personal desktop · Tauri v2
        </p>
      </footer>
    </aside>
  );
}
