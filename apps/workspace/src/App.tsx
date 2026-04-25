import { useCallback, useMemo, useState } from "react";
import { ErrorBoundary } from "./shell/ErrorBoundary";
import { Sidebar } from "./shell/Sidebar";
import { SurfaceNavProvider } from "./shell/surface-nav-context";
import { Titlebar } from "./shell/Titlebar";
import { useWindowFocus } from "./shell/useWindowFocus";
import { SURFACES, findSurface } from "./surfaces/registry";
import type { SurfaceDefinition } from "./surfaces/types";

const DEFAULT_SURFACE_ID = "site-admin";
const ACTIVE_SURFACE_STORAGE_KEY = "workspace.activeSurfaceId.v1";

function navItemStorageKey(surfaceId: string): string {
  return `workspace.nav.${surfaceId}.v1`;
}

/** Pick the starting nav item for a surface: the persisted value (when
 * it still maps to a valid leaf), else the surface's declared default.
 * Returns `null` for flat surfaces. */
function resolveInitialNavItemId(surface: SurfaceDefinition): string | null {
  if (!surface.navGroups?.length) return null;
  const validIds = new Set<string>();
  for (const group of surface.navGroups) {
    for (const item of group.items) validIds.add(item.id);
  }
  try {
    const stored = localStorage.getItem(navItemStorageKey(surface.id));
    if (stored && validIds.has(stored)) return stored;
  } catch {
    // ignore
  }
  if (surface.defaultNavItemId && validIds.has(surface.defaultNavItemId)) {
    return surface.defaultNavItemId;
  }
  // Fall back to the first item so the surface never mounts with a
  // null leaf when a tree exists.
  return surface.navGroups[0]?.items[0]?.id ?? null;
}

/** App shell — the surface-agnostic chrome. Mounts Titlebar + Sidebar +
 * the currently-active surface. Adding a new tool is purely a registry
 * change; nothing in this file needs to change.
 *
 * Persists the active surface across restarts so reopening the app lands
 * on whatever the user was last looking at. Also persists the active
 * nav item per-surface so "Posts" stays "Posts" after a restart. */
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

  // Nav state is keyed on the active surface. Initialize lazily so we
  // only touch localStorage once per mount.
  const [activeNavItemId, setActiveNavItemIdState] = useState<string | null>(
    () => (activeSurface ? resolveInitialNavItemId(activeSurface) : null),
  );

  const selectSurface = useCallback(
    (id: string) => {
      const target = findSurface(id);
      if (!target || target.disabled) return;
      if (id !== activeSurfaceId) {
        setActiveSurfaceId(id);
        localStorage.setItem(ACTIVE_SURFACE_STORAGE_KEY, id);
        setActiveNavItemIdState(resolveInitialNavItemId(target));
      }
    },
    [activeSurfaceId],
  );

  const selectNavItem = useCallback(
    (surfaceId: string, navItemId: string) => {
      const target = findSurface(surfaceId);
      if (!target || target.disabled) return;
      if (surfaceId !== activeSurfaceId) {
        setActiveSurfaceId(surfaceId);
        localStorage.setItem(ACTIVE_SURFACE_STORAGE_KEY, surfaceId);
      }
      setActiveNavItemIdState(navItemId);
      try {
        localStorage.setItem(navItemStorageKey(surfaceId), navItemId);
      } catch {
        // ignore
      }
    },
    [activeSurfaceId],
  );

  const setActiveNavItemId = useCallback(
    (id: string) => {
      if (!activeSurface) return;
      setActiveNavItemIdState(id);
      try {
        localStorage.setItem(navItemStorageKey(activeSurface.id), id);
      } catch {
        // ignore
      }
    },
    [activeSurface],
  );

  const navContextValue = useMemo(
    () => ({ activeNavItemId, setActiveNavItemId }),
    [activeNavItemId, setActiveNavItemId],
  );

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
      <Titlebar
        activeSurface={activeSurface}
        activeNavItemId={activeNavItemId}
      />
      <div className="app-body">
        <Sidebar
          surfaces={SURFACES}
          activeSurfaceId={activeSurface.id}
          activeNavItemId={activeNavItemId}
          onSelectSurface={selectSurface}
          onSelectNavItem={selectNavItem}
        />
        <main
          className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden px-6 pt-5 pb-8 flex flex-col gap-4"
          aria-label={activeSurface.title}
        >
          <ErrorBoundary label={activeSurface.title} key={activeSurface.id}>
            <SurfaceNavProvider value={navContextValue}>
              <ActiveComponent />
            </SurfaceNavProvider>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
