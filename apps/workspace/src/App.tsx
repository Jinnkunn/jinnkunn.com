import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
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
import { Titlebar, type WorkspaceTitlebarTab } from "./shell/Titlebar";
import { SettingsWindow } from "./shell/SettingsWindow";
import { WorkspaceCommandPalette } from "./shell/WorkspaceCommandPalette";
import { WorkspaceDashboard } from "./shell/WorkspaceDashboard";
import {
  appendWorkspaceEvent,
  loadWorkspaceEvents,
  persistWorkspaceEvents,
  WORKSPACE_EVENT_NAME,
  type WorkspaceEventInput,
} from "./shell/workspaceEvents";
import { useNativeMenu } from "./shell/useNativeMenu";
import { useWindowFocus } from "./shell/useWindowFocus";
import { runUpdateCheckSafely } from "./lib/updater";
import {
  ALL_WORKSPACE_SURFACES,
  getDefaultEnabledModuleIds,
  getEnabledModuleSurfaces,
  normalizeEnabledModuleIds,
  WORKSPACE_MODULES,
} from "./modules/registry";
import type { SurfaceDefinition, SurfaceNavItem } from "./surfaces/types";
import { WorkspaceMain } from "./ui/primitives";

const DEFAULT_SURFACE_ID = "workspace";
const ACTIVE_SURFACE_STORAGE_KEY = "workspace.activeSurfaceId.v1";
const SURFACE_ORDER_STORAGE_KEY = "workspace.surfaceOrder.v1";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "workspace.sidebar.collapsed.v1";
const ENABLED_MODULES_STORAGE_KEY = "workspace.enabledModules.v1";

function createWorkspaceTab(
  surfaceId: string,
  navItemId: string | null,
): WorkspaceTitlebarTab {
  return {
    id: `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    navItemId,
    surfaceId,
  };
}

function loadBoolean(storageKey: string, fallback = false): boolean {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return fallback;
  } catch {
    return fallback;
  }
}

function persistBoolean(storageKey: string, value: boolean): void {
  try {
    localStorage.setItem(storageKey, value ? "true" : "false");
  } catch {
    // ignore quota / private-mode errors; state stays in-memory
  }
}

function loadEnabledModuleIds(): string[] {
  try {
    const raw = localStorage.getItem(ENABLED_MODULES_STORAGE_KEY);
    if (!raw) return [...getDefaultEnabledModuleIds()];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...getDefaultEnabledModuleIds()];
    return [...normalizeEnabledModuleIds(parsed.filter((id): id is string => typeof id === "string"))];
  } catch {
    return [...getDefaultEnabledModuleIds()];
  }
}

function persistEnabledModuleIds(ids: readonly string[]): void {
  try {
    localStorage.setItem(
      ENABLED_MODULES_STORAGE_KEY,
      JSON.stringify(normalizeEnabledModuleIds(ids)),
    );
  } catch {
    // ignore quota / private-mode errors; state stays in-memory
  }
}

function navItemStorageKey(surfaceId: string): string {
  return `workspace.nav.${surfaceId}.v1`;
}

function loadSurfaceOrder(): string[] {
  try {
    const raw = localStorage.getItem(SURFACE_ORDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const validIds = new Set(ALL_WORKSPACE_SURFACES.map((surface) => surface.id));
    return parsed.filter(
      (id): id is string =>
        typeof id === "string" &&
        id !== DEFAULT_SURFACE_ID &&
        validIds.has(id),
    );
  } catch {
    return [];
  }
}

function persistSurfaceOrder(ids: readonly string[]): void {
  try {
    localStorage.setItem(SURFACE_ORDER_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore quota / private-mode errors; state stays in-memory
  }
}

function orderWorkspaceSurfaces(
  surfaces: readonly SurfaceDefinition[],
  orderedIds: readonly string[],
): readonly SurfaceDefinition[] {
  const fixed = surfaces.find((surface) => surface.id === DEFAULT_SURFACE_ID);
  const reorderable = surfaces.filter((surface) => surface.id !== DEFAULT_SURFACE_ID);
  const byId = new Map(reorderable.map((surface) => [surface.id, surface]));
  const ordered = orderedIds
    .map((id) => byId.get(id))
    .filter((surface): surface is SurfaceDefinition => Boolean(surface));
  const seen = new Set(ordered.map((surface) => surface.id));
  const trailing = reorderable.filter((surface) => !seen.has(surface.id));
  return fixed ? [fixed, ...ordered, ...trailing] : [...ordered, ...trailing];
}

function moveSurfaceInOrder({
  currentOrder,
  edge,
  surfaces,
  sourceId,
  targetId,
}: {
  currentOrder: readonly string[];
  edge: "before" | "after";
  surfaces: readonly SurfaceDefinition[];
  sourceId: string;
  targetId: string;
}): string[] {
  if (
    sourceId === DEFAULT_SURFACE_ID ||
    targetId === DEFAULT_SURFACE_ID ||
    sourceId === targetId
  ) {
    return [...currentOrder];
  }
  const ids = orderWorkspaceSurfaces(surfaces, currentOrder)
    .filter((surface) => surface.id !== DEFAULT_SURFACE_ID)
    .map((surface) => surface.id);
  const withoutSource = ids.filter((id) => id !== sourceId);
  const targetIndex = withoutSource.indexOf(targetId);
  if (targetIndex < 0) return ids;
  withoutSource.splice(edge === "after" ? targetIndex + 1 : targetIndex, 0, sourceId);
  return withoutSource;
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

  const [enabledModuleIds, setEnabledModuleIds] = useState<string[]>(() =>
    loadEnabledModuleIds(),
  );
  const enabledSurfaces = useMemo(
    () => getEnabledModuleSurfaces(enabledModuleIds),
    [enabledModuleIds],
  );
  const enabledSurfaceIds = useMemo(
    () => new Set(enabledSurfaces.map((surface) => surface.id)),
    [enabledSurfaces],
  );

  const [activeSurfaceId, setActiveSurfaceId] = useState<string>(() => {
    const enabled = loadEnabledModuleIds();
    const stored = localStorage.getItem(ACTIVE_SURFACE_STORAGE_KEY);
    if (
      stored &&
      (stored === DEFAULT_SURFACE_ID || enabled.includes(stored)) &&
      ALL_WORKSPACE_SURFACES.some(
        (surface) => surface.id === stored && !surface.disabled,
      )
    ) {
      return stored;
    }
    return DEFAULT_SURFACE_ID;
  });

  const activeSurface = useMemo(
    () =>
      enabledSurfaces.find((surface) => surface.id === activeSurfaceId) ??
      enabledSurfaces.find((surface) => surface.id === DEFAULT_SURFACE_ID) ??
      enabledSurfaces[0],
    [activeSurfaceId, enabledSurfaces],
  );

  // Nav state is keyed on the active surface. Initialize lazily so we
  // only touch localStorage once per mount.
  const [activeNavItemId, setActiveNavItemIdState] = useState<string | null>(
    () => (activeSurface ? resolveInitialNavItemId(activeSurface) : null),
  );
  const [tabs, setTabs] = useState<WorkspaceTitlebarTab[]>(() => [
    createWorkspaceTab(
      activeSurfaceId,
      activeSurface ? resolveInitialNavItemId(activeSurface) : null,
    ),
  ]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? "tab_initial");
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    loadBoolean(SIDEBAR_COLLAPSED_STORAGE_KEY),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

  const updateActiveTab = useCallback(
    (patch: Partial<Omit<WorkspaceTitlebarTab, "id">>) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === activeTabId ? { ...tab, ...patch } : tab,
        ),
      );
    },
    [activeTabId],
  );

  const selectSurface = useCallback(
    (id: string) => {
      const target = enabledSurfaces.find((surface) => surface.id === id);
      if (!target || target.disabled) return;
      const nextNavItemId = resolveInitialNavItemId(target);
      if (id !== activeSurfaceId) {
        setActiveSurfaceId(id);
        localStorage.setItem(ACTIVE_SURFACE_STORAGE_KEY, id);
      }
      setActiveNavItemIdState(nextNavItemId);
      updateActiveTab({ navItemId: nextNavItemId, surfaceId: id });
    },
    [activeSurfaceId, enabledSurfaces, updateActiveTab],
  );

  const selectNavItem = useCallback(
    (surfaceId: string, navItemId: string) => {
      const target = enabledSurfaces.find((surface) => surface.id === surfaceId);
      if (!target || target.disabled) return;
      if (surfaceId !== activeSurfaceId) {
        setActiveSurfaceId(surfaceId);
        localStorage.setItem(ACTIVE_SURFACE_STORAGE_KEY, surfaceId);
      }
      setActiveNavItemIdState(navItemId);
      updateActiveTab({ navItemId, surfaceId });
      try {
        localStorage.setItem(navItemStorageKey(surfaceId), navItemId);
      } catch {
        // ignore
      }
    },
    [activeSurfaceId, enabledSurfaces, updateActiveTab],
  );

  const setActiveNavItemId = useCallback(
    (id: string) => {
      if (!activeSurface) return;
      setActiveNavItemIdState(id);
      updateActiveTab({ navItemId: id, surfaceId: activeSurface.id });
      try {
        localStorage.setItem(navItemStorageKey(activeSurface.id), id);
      } catch {
        // ignore
      }
    },
    [activeSurface, updateActiveTab],
  );

  // Dynamic child trees published by the active surface (e.g. site-admin
  // injecting the live posts/pages list under the Posts/Pages nav items).
  // Walked into the surface's static navGroups before passing them to the
  // Sidebar so the shell stays generic.
  const [navItemChildren, setNavItemChildrenMap] = useState<
    Record<string, readonly SurfaceNavItem[]>
  >({});
  const [navGroupItems, setNavGroupItemsMap] = useState<
    Record<string, readonly SurfaceNavItem[]>
  >({});
  const [surfaceContextAccessory, setSurfaceContextAccessory] =
    useState<ReactNode | null>(null);

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
  const setNavGroupItems = useCallback(
    (groupId: string, items: readonly SurfaceNavItem[] | null) => {
      setNavGroupItemsMap((prev) => {
        if (!items || items.length === 0) {
          if (!(groupId in prev)) return prev;
          const next = { ...prev };
          delete next[groupId];
          return next;
        }
        return { ...prev, [groupId]: items };
      });
    },
    [],
  );
  const setContextAccessory = useCallback((node: ReactNode | null) => {
    setSurfaceContextAccessory(node);
  }, []);

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
      selectWorkspaceNavItem: selectNavItem,
      setActiveNavItemId,
      setNavItemChildren,
      setNavGroupItems,
      setContextAccessory,
      setMoveNavItemHandler,
      setReorderNavItemHandler,
      setRenameNavItemHandler,
      setRenameValidator,
    }),
    [
      activeNavItemId,
      selectNavItem,
      setActiveNavItemId,
      setNavItemChildren,
      setNavGroupItems,
      setContextAccessory,
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
  const [workspaceEvents, setWorkspaceEvents] = useState(() =>
    loadWorkspaceEvents(),
  );
  const [workspacePaletteOpen, setWorkspacePaletteOpen] = useState(false);
  const [surfaceOrder, setSurfaceOrder] = useState<string[]>(() =>
    loadSurfaceOrder(),
  );

  useNativeMenu({
    onOpenPalette: () => setWorkspacePaletteOpen(true),
    onCheckUpdates: () => {
      void runUpdateCheckSafely({
        promptBeforeDownload: false,
        notifyOnUpToDate: true,
      });
    },
  });

  const recordWorkspaceEvent = useCallback((input: WorkspaceEventInput) => {
    setWorkspaceEvents((current) => appendWorkspaceEvent(current, input));
  }, []);

  const clearWorkspaceEvents = useCallback(() => {
    setWorkspaceEvents([]);
  }, []);

  useEffect(() => {
    persistFavorites(favorites);
  }, [favorites]);

  useEffect(() => {
    persistRecentItems(recentItems);
  }, [recentItems]);

  useEffect(() => {
    persistWorkspaceEvents(workspaceEvents);
  }, [workspaceEvents]);

  useEffect(() => {
    persistSurfaceOrder(surfaceOrder);
  }, [surfaceOrder]);

  useEffect(() => {
    persistEnabledModuleIds(enabledModuleIds);
  }, [enabledModuleIds]);

  useEffect(() => {
    persistBoolean(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed);
  }, [sidebarCollapsed]);

  const activateTab = useCallback((tabId: string) => {
    const tab = tabs.find((entry) => entry.id === tabId);
    if (!tab) return;
    const surface = enabledSurfaces.find((entry) => entry.id === tab.surfaceId);
    if (!surface || surface.disabled) return;
    const nextNavItemId = tab.navItemId ?? resolveInitialNavItemId(surface);
    setActiveTabId(tab.id);
    setActiveSurfaceId(surface.id);
    setActiveNavItemIdState(nextNavItemId);
    localStorage.setItem(ACTIVE_SURFACE_STORAGE_KEY, surface.id);
    if (nextNavItemId) {
      try {
        localStorage.setItem(navItemStorageKey(surface.id), nextNavItemId);
      } catch {
        // ignore
      }
    }
  }, [enabledSurfaces, tabs]);

  const setModuleEnabled = useCallback((moduleId: string, enabled: boolean) => {
    setEnabledModuleIds((current) => {
      const next = new Set(current);
      if (enabled) next.add(moduleId);
      else next.delete(moduleId);
      return [...normalizeEnabledModuleIds([...next])];
    });
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setTabs((current) => {
        let changed = false;
        const next = current.map((tab) => {
          if (enabledSurfaceIds.has(tab.surfaceId)) return tab;
          changed = true;
          return {
            ...tab,
            navItemId: null,
            surfaceId: DEFAULT_SURFACE_ID,
          };
        });
        return changed ? next : current;
      });

      if (enabledSurfaceIds.has(activeSurfaceId)) return;
      setActiveSurfaceId(DEFAULT_SURFACE_ID);
      setActiveNavItemIdState(null);
      localStorage.setItem(ACTIVE_SURFACE_STORAGE_KEY, DEFAULT_SURFACE_ID);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [activeSurfaceId, enabledSurfaceIds]);

  const addTab = useCallback(() => {
    const next = createWorkspaceTab(activeSurfaceId, activeNavItemId);
    setTabs((current) => [...current, next]);
    setActiveTabId(next.id);
  }, [activeNavItemId, activeSurfaceId]);

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((current) => {
        if (current.length <= 1) return current;
        const index = current.findIndex((tab) => tab.id === tabId);
        if (index < 0) return current;
        const next = current.filter((tab) => tab.id !== tabId);
        if (tabId === activeTabId) {
          const replacement = next[Math.max(0, index - 1)] ?? next[0];
          if (replacement) {
            window.setTimeout(() => activateTab(replacement.id), 0);
          }
        }
        return next;
      });
    },
    [activateTab, activeTabId],
  );

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((current) => !current);
  }, []);

  useEffect(() => {
    const onWorkspaceEvent = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceEventInput>).detail;
      if (!detail?.title) return;
      recordWorkspaceEvent(detail);
    };
    window.addEventListener(WORKSPACE_EVENT_NAME, onWorkspaceEvent);
    return () =>
      window.removeEventListener(WORKSPACE_EVENT_NAME, onWorkspaceEvent);
  }, [recordWorkspaceEvent]);

  // Auto-check for updates ~10 s after first paint. Delaying it past
  // mount means the operator's first interactions feel snappy (the
  // updater plugin shells out + makes a network round-trip), and the
  // 10 s grace is short enough that "I just opened the app" still
  // counts as a check-in. `runUpdateCheckSafely` no-ops in non-Tauri
  // preview builds, so this is safe to mount globally.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      void runUpdateCheckSafely({
        promptBeforeDownload: true,
        notifyOnUpToDate: false,
      });
    }, 10_000);
    return () => window.clearTimeout(handle);
  }, []);

  const toggleFavorite = useCallback(
    (entry: SidebarFavorite) => {
      const pinned = !favoritesContain(favorites, entry.surfaceId, entry.itemId);
      setFavoritesState((prev) =>
        favoritesContain(prev, entry.surfaceId, entry.itemId)
          ? removeFavorite(prev, entry.surfaceId, entry.itemId)
          : addFavorite(prev, entry),
      );
      recordWorkspaceEvent({
        source: "Workspace",
        title: pinned ? `Pinned ${entry.label}` : `Unpinned ${entry.label}`,
        tone: "info",
      });
    },
    [favorites, recordWorkspaceEvent],
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

  const visibleFavorites = useMemo(
    () => favorites.filter((favorite) => enabledSurfaceIds.has(favorite.surfaceId)),
    [enabledSurfaceIds, favorites],
  );
  const visibleRecentItems = useMemo(
    () => recentItems.filter((recent) => enabledSurfaceIds.has(recent.surfaceId)),
    [enabledSurfaceIds, recentItems],
  );

  const derivedSurfaces = useMemo(() => {
    const orderedSurfaces = orderWorkspaceSurfaces(enabledSurfaces, surfaceOrder);
    if (
      Object.keys(navItemChildren).length === 0 &&
      Object.keys(navGroupItems).length === 0
    ) {
      return orderedSurfaces;
    }
    return orderedSurfaces.map((surface) => {
      if (!surface.navGroups?.length) return surface;
      const groups = surface.navGroups.map((group) => ({
        ...group,
        items: (navGroupItems[group.id] ?? group.items).map((item) =>
          navItemChildren[item.id]
            ? { ...item, children: navItemChildren[item.id] }
            : item,
        ),
      }));
      return { ...surface, navGroups: groups };
    });
  }, [enabledSurfaces, navGroupItems, navItemChildren, surfaceOrder]);

  const handleReorderSurface = useCallback(
    (sourceId: string, targetId: string, edge: "before" | "after") => {
      setSurfaceOrder((currentOrder) =>
        moveSurfaceInOrder({
          currentOrder,
          edge,
          surfaces: enabledSurfaces,
          sourceId,
          targetId,
        }),
      );
    },
    [enabledSurfaces],
  );

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
    // The module registry always contributes the core workspace surface.
    // This guard keeps React from throwing during dev-time registry edits.
    return <div className="app-shell" />;
  }

  const ActiveComponent = activeSurface.Component;
  const isWorkspaceDashboard = activeSurface.id === "workspace";
  const renderedActiveSurface =
    derivedSurfaces.find((surface) => surface.id === activeSurface.id) ?? activeSurface;

  return (
    <div className="app-shell">
      <Titlebar
        activeSurface={renderedActiveSurface}
        activeNavItemId={activeNavItemId}
        surfaces={derivedSurfaces}
        events={workspaceEvents}
        favoriteCount={visibleFavorites.length}
        recentCount={visibleRecentItems.length}
        tabs={tabs}
        activeTabId={activeTabId}
        sidebarCollapsed={sidebarCollapsed}
        onCloseTab={closeTab}
        onNewTab={addTab}
        onSelectTab={activateTab}
        onToggleSidebar={toggleSidebarCollapsed}
      />
      <div className="app-body">
        <Sidebar
          surfaces={derivedSurfaces}
          activeSurfaceId={activeSurface.id}
          activeNavItemId={activeNavItemId}
          favorites={visibleFavorites}
          recentItems={visibleRecentItems}
          sidebarCollapsed={sidebarCollapsed}
          onSelectSurface={selectSurface}
          onSelectNavItem={selectNavItem}
          onOpenSettings={() => setSettingsOpen(true)}
          onToggleFavorite={toggleFavorite}
          onRecordRecent={recordRecentItem}
          isFavorite={isFavorite}
          onMoveNavItem={handleMoveNavItem}
          onReorderNavItem={handleReorderNavItem}
          onReorderSurface={handleReorderSurface}
          onRenameNavItem={handleRenameNavItem}
          validateRenameNavItem={validateRenameNavItem}
          contextAccessory={surfaceContextAccessory}
        />
        <WorkspaceMain label={activeSurface.title}>
          <ErrorBoundary label={activeSurface.title} key={activeSurface.id}>
            <SurfaceNavProvider value={navContextValue}>
              {isWorkspaceDashboard ? (
                <WorkspaceDashboard
                  events={workspaceEvents}
                  favorites={visibleFavorites}
                  onClearEvents={clearWorkspaceEvents}
                  onOpenCommandPalette={() => setWorkspacePaletteOpen(true)}
                  onRecordRecent={recordRecentItem}
                  onSelectNavItem={selectNavItem}
                  onSelectSurface={selectSurface}
                  recentItems={visibleRecentItems}
                  surfaces={derivedSurfaces}
                />
              ) : (
                <ActiveComponent />
              )}
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
        eventCount={workspaceEvents.length}
        favorites={visibleFavorites}
        recentItems={visibleRecentItems}
        onClearWorkspaceEvents={clearWorkspaceEvents}
        onOpenWorkspaceDashboard={() => selectSurface("workspace")}
        onRecordRecent={recordRecentItem}
        onSelectSurface={selectSurface}
        onSelectNavItem={selectNavItem}
      />
      <SettingsWindow
        enabledModuleIds={enabledModuleIds}
        modules={WORKSPACE_MODULES}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSetModuleEnabled={setModuleEnabled}
      />
    </div>
  );
}
