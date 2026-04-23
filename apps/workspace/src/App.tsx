import { useMemo, useState } from "react";
import { Sidebar } from "./shell/Sidebar";
import { Titlebar } from "./shell/Titlebar";
import { useWindowFocus } from "./shell/useWindowFocus";
import { SURFACES, findSurface } from "./surfaces/registry";

const DEFAULT_SURFACE_ID = "site-admin";
const ACTIVE_SURFACE_STORAGE_KEY = "workspace.activeSurfaceId.v1";

/** App shell — the surface-agnostic chrome. Mounts Titlebar + Sidebar +
 * the currently-active surface. Adding a new tool is purely a registry
 * change; nothing in this file needs to change.
 *
 * Persists the active surface across restarts so reopening the app lands
 * on whatever the user was last looking at. */
export function App() {
  useWindowFocus();

  const [activeSurfaceId, setActiveSurfaceId] = useState<string>(() => {
    const stored = localStorage.getItem(ACTIVE_SURFACE_STORAGE_KEY);
    if (stored && findSurface(stored) && !findSurface(stored)?.disabled) {
      return stored;
    }
    return DEFAULT_SURFACE_ID;
  });

  const activeSurface = useMemo(
    () => findSurface(activeSurfaceId) ?? findSurface(DEFAULT_SURFACE_ID) ?? SURFACES[0],
    [activeSurfaceId],
  );

  const handleSelect = (id: string) => {
    const target = findSurface(id);
    if (!target || target.disabled) return;
    setActiveSurfaceId(id);
    localStorage.setItem(ACTIVE_SURFACE_STORAGE_KEY, id);
  };

  if (!activeSurface) {
    // SURFACES is statically non-empty (site-admin is always registered),
    // so this is mostly a type-narrowing guard. Falling through with a
    // neutral empty shell keeps React from throwing during dev-time
    // registry edits.
    return <div className="app-shell" />;
  }

  const ActiveComponent = activeSurface.Component;

  return (
    <div className="app-shell">
      <Titlebar activeSurface={activeSurface} />
      <div className="app-body">
        <Sidebar
          surfaces={SURFACES}
          activeSurfaceId={activeSurface.id}
          onSelect={handleSelect}
        />
        <main
          className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden px-6 pt-5 pb-8 flex flex-col gap-4"
          aria-labelledby="surface-label"
        >
          <ActiveComponent />
        </main>
      </div>
    </div>
  );
}
