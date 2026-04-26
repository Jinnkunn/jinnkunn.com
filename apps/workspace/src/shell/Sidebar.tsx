import { useCallback, useEffect, useState } from "react";

import type {
  SurfaceDefinition,
  SurfaceNavGroup,
  SurfaceNavItem,
} from "../surfaces/types";

interface SidebarProps {
  surfaces: readonly SurfaceDefinition[];
  activeSurfaceId: string;
  activeNavItemId: string | null;
  onSelectSurface: (id: string) => void;
  onSelectNavItem: (surfaceId: string, navItemId: string) => void;
}

const GROUP_COLLAPSE_STORAGE_KEY = "workspace.sidebar.groups.v1";
const SURFACE_TREE_COLLAPSE_STORAGE_KEY = "workspace.sidebar.surfaceTrees.v1";
const ITEM_TREE_COLLAPSE_STORAGE_KEY = "workspace.sidebar.itemTrees.v1";

type CollapseMap = Record<string, boolean>;

function loadCollapseMap(storageKey: string): CollapseMap {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: CollapseMap = {};
    for (const key of Object.keys(parsed)) {
      if (typeof parsed[key] === "boolean") out[key] = parsed[key] as boolean;
    }
    return out;
  } catch {
    return {};
  }
}

function persistCollapseMap(storageKey: string, state: CollapseMap): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // ignore quota / private-mode errors; state stays in-memory
  }
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transition: "transform 140ms ease",
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
      }}
      aria-hidden="true"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

/** Sidebar — floating rounded card containing the nav list. Ported from
 * personal-os `.sidebar-surface`.
 *
 * Surfaces with `navGroups` render a nested tree beneath them when
 * active: each group is a collapsible section whose leaves switch the
 * surface's internal view (posts/pages/routes/…). Collapsed state is
 * persisted per-group across restarts.
 *
 * Flat surfaces (no navGroups) render as a single row, identical to
 * the pre-nesting behaviour. */
// Walks a SurfaceNavItem tree and returns true if any descendant matches
// the active nav id. Used to keep ancestor trees forced-open so the
// active row is always visible after a collapse.
function itemContainsActive(
  item: SurfaceNavItem,
  activeNavItemId: string | null,
): boolean {
  if (!activeNavItemId) return false;
  if (item.id === activeNavItemId) return true;
  return Boolean(
    item.children?.some((child) => itemContainsActive(child, activeNavItemId)),
  );
}

interface RenderNavItemArgs {
  activeNavItemId: string | null;
  depth: number;
  item: SurfaceNavItem;
  itemTreeCollapsed: CollapseMap;
  onSelectNavItem: (surfaceId: string, navItemId: string) => void;
  surfaceId: string;
  toggleItemTree: (key: string) => void;
  itemKey: (surfaceId: string, itemId: string) => string;
}

// Recursive renderer for one nav row + its descendants. Indent doubles
// per depth via the `--depth` CSS variable; the parent row stays clickable
// and the chevron is a separate hit target. Children that include the
// active id are force-opened so the user can always see what's selected.
function renderNavItem({
  activeNavItemId,
  depth,
  item,
  itemTreeCollapsed,
  onSelectNavItem,
  surfaceId,
  toggleItemTree,
  itemKey,
}: RenderNavItemArgs) {
  const selected = activeNavItemId === item.id;
  const hasChildren = Boolean(item.children?.length);
  const containsActive = hasChildren
    ? Boolean(
        item.children?.some((child) =>
          itemContainsActive(child, activeNavItemId),
        ),
      )
    : false;
  const treeKey = itemKey(surfaceId, item.id);
  const treeOpen = hasChildren
    ? containsActive || !itemTreeCollapsed[treeKey]
    : false;
  const treeId = `sidebar-item-tree-${surfaceId}-${item.id.replace(/[^a-z0-9-]/gi, "_")}`;
  return (
    <li key={item.id}>
      <div
        className="sidebar-tree__item-row"
        style={{ ["--sidebar-depth" as string]: depth }}
      >
        <button
          type="button"
          className="sidebar-nav-item sidebar-tree__item"
          onClick={() => onSelectNavItem(surfaceId, item.id)}
          aria-current={selected ? "page" : undefined}
        >
          {item.icon && (
            <span className="sidebar-nav-item-icon">{item.icon}</span>
          )}
          <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
            {item.label}
          </span>
          {item.badge !== undefined && item.badge !== null && (
            <span className="sidebar-tree__badge">{item.badge}</span>
          )}
        </button>
        {hasChildren && (
          <button
            type="button"
            className="sidebar-tree__item-disclosure"
            onClick={() => toggleItemTree(treeKey)}
            aria-expanded={treeOpen}
            aria-controls={treeId}
            aria-label={treeOpen ? `Collapse ${item.label}` : `Expand ${item.label}`}
            title={treeOpen ? "Collapse" : "Expand"}
          >
            <ChevronIcon open={treeOpen} />
          </button>
        )}
      </div>
      {hasChildren && treeOpen && (
        <ul
          id={treeId}
          className="sidebar-tree__items sidebar-tree__items--nested"
          role="list"
        >
          {item.children!.map((child) =>
            renderNavItem({
              activeNavItemId,
              depth: depth + 1,
              item: child,
              itemTreeCollapsed,
              onSelectNavItem,
              surfaceId,
              toggleItemTree,
              itemKey,
            }),
          )}
        </ul>
      )}
    </li>
  );
}

export function Sidebar({
  surfaces,
  activeSurfaceId,
  activeNavItemId,
  onSelectSurface,
  onSelectNavItem,
}: SidebarProps) {
  const [groupCollapsed, setGroupCollapsed] = useState<CollapseMap>(() =>
    loadCollapseMap(GROUP_COLLAPSE_STORAGE_KEY),
  );
  const [surfaceTreeCollapsed, setSurfaceTreeCollapsed] = useState<CollapseMap>(
    () => loadCollapseMap(SURFACE_TREE_COLLAPSE_STORAGE_KEY),
  );
  const [itemTreeCollapsed, setItemTreeCollapsed] = useState<CollapseMap>(() =>
    loadCollapseMap(ITEM_TREE_COLLAPSE_STORAGE_KEY),
  );

  useEffect(() => {
    persistCollapseMap(GROUP_COLLAPSE_STORAGE_KEY, groupCollapsed);
  }, [groupCollapsed]);

  useEffect(() => {
    persistCollapseMap(SURFACE_TREE_COLLAPSE_STORAGE_KEY, surfaceTreeCollapsed);
  }, [surfaceTreeCollapsed]);

  useEffect(() => {
    persistCollapseMap(ITEM_TREE_COLLAPSE_STORAGE_KEY, itemTreeCollapsed);
  }, [itemTreeCollapsed]);

  const toggleGroup = useCallback((key: string) => {
    setGroupCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const toggleSurfaceTree = useCallback((surfaceId: string) => {
    setSurfaceTreeCollapsed((prev) => ({
      ...prev,
      [surfaceId]: !prev[surfaceId],
    }));
  }, []);

  const toggleItemTree = useCallback((key: string) => {
    setItemTreeCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const groupKey = (surfaceId: string, groupId: string) =>
    `${surfaceId}:${groupId}`;
  const itemKey = (surfaceId: string, itemId: string) =>
    `${surfaceId}:::${itemId}`;

  const isGroupOpen = (
    surfaceId: string,
    group: SurfaceNavGroup,
    activeForSurface: boolean,
  ): boolean => {
    // If the active nav item lives in this group, force open — prevents
    // the caret from landing on an invisible row after a collapse.
    if (
      activeForSurface &&
      activeNavItemId !== null &&
      group.items.some((item) => item.id === activeNavItemId)
    ) {
      return true;
    }
    return !groupCollapsed[groupKey(surfaceId, group.id)];
  };

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
          <nav className="flex flex-col gap-0.5" aria-label="Surfaces">
            {surfaces.map((surface) => {
              const active = surface.id === activeSurfaceId;
              const hasTree = Boolean(surface.navGroups?.length);
              const treeOpen =
                active && hasTree && !surfaceTreeCollapsed[surface.id];
              const treeId = `sidebar-surface-tree-${surface.id}`;
              return (
                <div key={surface.id} className="sidebar-surface-row">
                  <div className="sidebar-surface-row__header">
                    <button
                      type="button"
                      aria-current={active ? "page" : undefined}
                      className="sidebar-nav-item sidebar-surface-row__select"
                      onClick={() => onSelectSurface(surface.id)}
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
                    {active && hasTree && (
                      <button
                        type="button"
                        className="sidebar-surface-row__disclosure"
                        onClick={() => toggleSurfaceTree(surface.id)}
                        aria-expanded={treeOpen}
                        aria-controls={treeId}
                        aria-label={
                          treeOpen
                            ? `Collapse ${surface.title}`
                            : `Expand ${surface.title}`
                        }
                        title={treeOpen ? "Collapse" : "Expand"}
                      >
                        <ChevronIcon open={treeOpen} />
                      </button>
                    )}
                  </div>
                  {treeOpen && (
                    <div
                      id={treeId}
                      className="sidebar-tree"
                      role="list"
                    >
                      {surface.navGroups!.map((group) => {
                        const open = isGroupOpen(surface.id, group, active);
                        return (
                          <div key={group.id} className="sidebar-tree__group">
                            <button
                              type="button"
                              className="sidebar-tree__group-header"
                              onClick={() =>
                                toggleGroup(groupKey(surface.id, group.id))
                              }
                              aria-expanded={open}
                              aria-controls={`sidebar-group-${surface.id}-${group.id}`}
                            >
                              <ChevronIcon open={open} />
                              <span>{group.label}</span>
                            </button>
                            {open && (
                              <ul
                                id={`sidebar-group-${surface.id}-${group.id}`}
                                className="sidebar-tree__items"
                                role="list"
                              >
                                {group.items.map((item) =>
                                  renderNavItem({
                                    activeNavItemId,
                                    depth: 0,
                                    item,
                                    itemTreeCollapsed,
                                    onSelectNavItem,
                                    surfaceId: surface.id,
                                    toggleItemTree,
                                    itemKey,
                                  }),
                                )}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>
      </div>
      <footer className="sidebar-footer px-3.5 py-3 border-t border-border-subtle bg-bg-sidebar">
        <p className="m-0 text-[12px] font-semibold text-text-primary">Jinnkunn Workspace</p>
        <p className="m-0 mt-0.5 text-[11px] text-text-muted">
          Personal desktop
        </p>
      </footer>
    </aside>
  );
}
