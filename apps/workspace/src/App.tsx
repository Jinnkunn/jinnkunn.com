import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "./shell/ErrorBoundary";
import {
  addFavorite,
  favoritesContain,
  loadFavorites,
  persistFavorites,
  removeFavorite,
  type SidebarFavorite,
} from "./shell/favorites";
import {
  loadRecentItems,
  persistRecentItems,
  touchRecentItem,
  type SidebarRecentItem,
} from "./shell/recent";
import { Sidebar } from "./shell/Sidebar";
import { SurfaceNavProvider } from "./shell/surface-nav-context";
import { Titlebar } from "./shell/Titlebar";
import { WorkspaceCommandPalette } from "./shell/WorkspaceCommandPalette";
import { useWindowFocus } from "./shell/useWindowFocus";
import { SURFACES, findSurface } from "./surfaces/registry";
import type { SurfaceDefinition, SurfaceNavItem } from "./surfaces/types";
import { WorkspaceMain } from "./ui/primitives";

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

  // Dynamic child trees published by the active surface (e.g. site-admin
  // injecting the live posts/pages list under the Posts/Pages nav items).
  // Walked into the surface's static navGroups before passing them to the
  // Sidebar so the shell stays generic.
  const [navItemChildren, setNavItemChildrenMap] = useState<
    Record<string, readonly SurfaceNavItem[]>
  >({});

  const setNavItemChildren = useCallback(
    (itemId: string, children: readonly SurfaceNavItem[] | null) => {
      setNavItemChildrenMap((prev) => {
        if (!children || children.length === 0) {
          if (!(itemId in prev)) return prev;
          const next = { ...prev };
          delete next[itemId];
          return next;
        }
        return { ...prev, [itemId]: children };
      });
    },
    [],
  );

  // Active surface's drag-reparent handler. Sidebar's onMoveNavItem
  // routes here, which dispatches to whatever the surface registered
  // via the surface-nav context.
  const moveHandlerRef = useRef<
    ((fromId: string, toId: string) => void) | null
  >(null);
  const setMoveNavItemHandler = useCallback(
    (handler: ((fromId: string, toId: string) => void) | null) => {
      moveHandlerRef.current = handler;
    },
    [],
  );
  const handleMoveNavItem = useCallback(
    (_surfaceId: string, fromId: string, toId: string) => {
      moveHandlerRef.current?.(fromId, toId);
    },
    [],
  );

  const reorderHandlerRef = useRef<
    ((itemId: string, direction: "up" | "down") => void) | null
  >(null);
  const setReorderNavItemHandler = useCallback(
    (handler: ((itemId: string, direction: "up" | "down") => void) | null) => {
      reorderHandlerRef.current = handler;
    },
    [],
  );
  const handleReorderNavItem = useCallback(
    (_surfaceId: string, itemId: string, direction: "up" | "down") => {
      reorderHandlerRef.current?.(itemId, direction);
    },
    [],
  );

  // Same pattern for inline rename — Sidebar fires (surfaceId, itemId,
  // newSlug); App routes to the active surface's registered handler.
  const renameHandlerRef = useRef<
    ((itemId: string, newSlug: string) => void) | null
  >(null);
  const setRenameNavItemHandler = useCallback(
    (handler: ((itemId: string, newSlug: string) => void) | null) => {
      renameHandlerRef.current = handler;
    },
    [],
  );
  const handleRenameNavItem = useCallback(
    (_surfaceId: string, itemId: string, newSlug: string) => {
      renameHandlerRef.current?.(itemId, newSlug);
    },
    [],
  );

  // Live validator paired with the rename handler — Sidebar calls this
  // on every keystroke to render inline error text and gate Enter.
  const renameValidatorRef = useRef<
    ((itemId: string, newSlug: string) => string | null) | null
  >(null);
  const setRenameValidator = useCallback(
    (
      validator: ((itemId: string, newSlug: string) => string | null) | null,
    ) => {
      renameValidatorRef.current = validator;
    },
    [],
  );
  const validateRenameNavItem = useCallback(
    (_surfaceId: string, itemId: string, newSlug: string) => {
      return renameValidatorRef.current?.(itemId, newSlug) ?? null;
    },
    [],
  );

  const navContextValue = useMemo(
    () => ({
      activeNavItemId,
      setActiveNavItemId,
      setNavItemChildren,
      setMoveNavItemHandler,
      setReorderNavItemHandler,
      setRenameNavItemHandler,
      setRenameValidator,
    }),
    [
      activeNavItemId,
      setActiveNavItemId,
      setNavItemChildren,
      setMoveNavItemHandler,
      setReorderNavItemHandler,
      setRenameNavItemHandler,
      setRenameValidator,
    ],
  );

  const [favorites, setFavoritesState] = useState<SidebarFavorite[]>(() =>
    loadFavorites(),
  );
  const [recentItems, setRecentItems] = useState<SidebarRecentItem[]>(() =>
    loadRecentItems(),
  );
  const [workspacePaletteOpen, setWorkspacePaletteOpen] = useState(false);

  useEffect(() => {
    persistFavorites(favorites);
  }, [favorites]);

  useEffect(() => {
    persistRecentItems(recentItems);
  }, [recentItems]);

  const toggleFavorite = useCallback(
    (entry: SidebarFavorite) => {
      setFavoritesState((prev) =>
        favoritesContain(prev, entry.surfaceId, entry.itemId)
          ? removeFavorite(prev, entry.surfaceId, entry.itemId)
          : addFavorite(prev, entry),
      );
    },
    [],
  );

  const recordRecentItem = useCallback(
    (entry: Omit<SidebarRecentItem, "visitedAt">) => {
      setRecentItems((current) => touchRecentItem(current, entry));
    },
    [],
  );

  const isFavorite = useCallback(
    (surfaceId: string, itemId: string) =>
      favoritesContain(favorites, surfaceId, itemId),
    [favorites],
  );

  const derivedSurfaces = useMemo(() => {
    if (Object.keys(navItemChildren).length === 0) return SURFACES;
    return SURFACES.map((surface) => {
      if (!surface.navGroups?.length) return surface;
      const groups = surface.navGroups.map((group) => ({
        ...group,
        items: group.items.map((item) =>
          navItemChildren[item.id]
            ? { ...item, children: navItemChildren[item.id] }
            : item,
        ),
      }));
      return { ...surface, navGroups: groups };
    });
  }, [navItemChildren]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta || event.altKey) return;
      if (event.key.toLowerCase() !== "k") return;

      if (event.shiftKey || activeSurfaceId !== "site-admin") {
        event.preventDefault();
        setWorkspacePaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeSurfaceId]);

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
        favoriteCount={favorites.length}
        recentCount={recentItems.length}
      />
      <div className="app-body">
        <Sidebar
          surfaces={derivedSurfaces}
          activeSurfaceId={activeSurface.id}
          activeNavItemId={activeNavItemId}
          favorites={favorites}
          recentItems={recentItems}
          onSelectSurface={selectSurface}
          onSelectNavItem={selectNavItem}
          onToggleFavorite={toggleFavorite}
          onRecordRecent={recordRecentItem}
          isFavorite={isFavorite}
          onMoveNavItem={handleMoveNavItem}
          onReorderNavItem={handleReorderNavItem}
          onRenameNavItem={handleRenameNavItem}
          validateRenameNavItem={validateRenameNavItem}
        />
        <WorkspaceMain label={activeSurface.title}>
          <ErrorBoundary label={activeSurface.title} key={activeSurface.id}>
            <SurfaceNavProvider value={navContextValue}>
              <ActiveComponent />
            </SurfaceNavProvider>
          </ErrorBoundary>
        </WorkspaceMain>
      </div>
      <WorkspaceCommandPalette
        open={workspacePaletteOpen}
        onClose={() => setWorkspacePaletteOpen(false)}
        surfaces={derivedSurfaces}
        activeSurfaceId={activeSurface.id}
        activeNavItemId={activeNavItemId}
        favorites={favorites}
        recentItems={recentItems}
        onRecordRecent={recordRecentItem}
        onSelectSurface={selectSurface}
        onSelectNavItem={selectNavItem}
      />
    </div>
  );
}
