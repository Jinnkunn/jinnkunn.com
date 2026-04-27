import { useCallback, useEffect, useState } from "react";

import type {
  SurfaceDefinition,
  SurfaceNavGroup,
  SurfaceNavItem,
} from "../surfaces/types";
import type { SidebarFavorite } from "./favorites";
import { handleWindowDragMouseDown } from "./windowDrag";

interface SidebarProps {
  surfaces: readonly SurfaceDefinition[];
  activeSurfaceId: string;
  activeNavItemId: string | null;
  favorites: readonly SidebarFavorite[];
  onSelectSurface: (id: string) => void;
  onSelectNavItem: (surfaceId: string, navItemId: string) => void;
  onToggleFavorite: (entry: SidebarFavorite) => void;
  isFavorite: (surfaceId: string, itemId: string) => boolean;
  /** Drop handler for drag-reparent. Sidebar fires this when a row
   * marked draggable lands on a row marked droppable in the same
   * surface. The surface is responsible for the actual move (e.g.
   * site-admin posts to /api/site-admin/pages/move and refreshes). */
  onMoveNavItem?: (surfaceId: string, fromId: string, toId: string) => void;
  /** Explicit sibling reorder handler for rows marked `orderable`.
   * Unlike drag/drop, this never reparents; it only moves within the
   * current sibling group. */
  onReorderNavItem?: (
    surfaceId: string,
    itemId: string,
    direction: "up" | "down",
  ) => void;
  /** Inline-rename handler. Sidebar fires it when the user submits the
   * rename input on a draggable row; surface decides which API to call
   * based on the id prefix. */
  onRenameNavItem?: (
    surfaceId: string,
    itemId: string,
    newSlug: string,
  ) => void;
  /** Optional live validator. Sidebar invokes it on every keystroke
   * inside the rename input; non-null return is shown as inline error
   * text and disables Enter submit. Falsy return means valid. */
  validateRenameNavItem?: (
    surfaceId: string,
    itemId: string,
    newSlug: string,
  ) => string | null;
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
  dragOverItemId: string | null;
  draggingItemId: string | null;
  isFavorite: (surfaceId: string, itemId: string) => boolean;
  item: SurfaceNavItem;
  itemTreeCollapsed: CollapseMap;
  onDragEnd: () => void;
  onDragOver: (itemId: string | null) => void;
  onDragStart: (itemId: string) => void;
  onDrop: (targetItemId: string) => void;
  onReorderNavItem?: (surfaceId: string, itemId: string, direction: "up" | "down") => void;
  onSelectNavItem: (surfaceId: string, navItemId: string) => void;
  onToggleFavorite: (entry: SidebarFavorite) => void;
  onStartRename: (itemId: string) => void;
  onCancelRename: () => void;
  onSubmitRename: (newSlug: string) => void;
  renameValidate?: (value: string) => string | null;
  renamingItemId: string | null;
  siblingCount: number;
  siblingIndex: number;
  surfaceId: string;
  toggleItemTree: (key: string) => void;
  itemKey: (surfaceId: string, itemId: string) => string;
}

function RenameInput({
  initial,
  onCancel,
  onSubmit,
  validate,
}: {
  initial: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
  validate?: (value: string) => string | null;
}) {
  const [value, setValue] = useState(initial);
  // Skip validation when the value is still the original — no point
  // showing an error before the user has typed anything.
  const error = value === initial || !validate ? null : validate(value);
  const canSubmit = value.trim().length > 0 && value !== initial && !error;
  return (
    <span className="sidebar-tree__rename-shell">
      <input
        autoFocus
        type="text"
        className="sidebar-tree__item sidebar-tree__rename-input"
        data-invalid={error ? "true" : undefined}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (canSubmit) onSubmit(value);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => {
          // Cancel when blank or invalid; auto-commit when typed and valid.
          // Enter runs synchronously before blur so a successful submit
          // isn't preempted.
          if (value === initial || !canSubmit) onCancel();
          else onSubmit(value);
        }}
        aria-label="New slug"
        aria-invalid={error ? "true" : undefined}
      />
      {error ? (
        <span className="sidebar-tree__rename-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="11"
      height="11"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 2l1.85 3.75 4.15.6-3 2.93.7 4.13L8 11.5l-3.7 1.91.7-4.13-3-2.93 4.15-.6L8 2z" />
    </svg>
  );
}

function ReorderIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {direction === "up" ? <path d="M4 10l4-4 4 4" /> : <path d="M4 6l4 4 4-4" />}
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 8h.01M8 8h.01M12 8h.01" />
    </svg>
  );
}

function closeActionMenu(start: HTMLElement | null) {
  start?.closest("details")?.removeAttribute("open");
}

// Recursive renderer for one nav row + its descendants. The row gets a
// depth variable for compact tree indentation; the parent row stays
// clickable and the chevron is a separate hit target. Children that
// include the active id are force-opened so the user can always see
// what's selected.
function renderNavItem({
  activeNavItemId,
  depth,
  dragOverItemId,
  draggingItemId,
  isFavorite,
  item,
  itemTreeCollapsed,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onReorderNavItem,
  onSelectNavItem,
  onToggleFavorite,
  onStartRename,
  onCancelRename,
  onSubmitRename,
  renameValidate,
  renamingItemId,
  siblingCount,
  siblingIndex,
  surfaceId,
  toggleItemTree,
  itemKey,
}: RenderNavItemArgs) {
  const isRenaming = renamingItemId === item.id;
  const selectable = item.selectable !== false;
  const selected = selectable && activeNavItemId === item.id;
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
  const isDragging = draggingItemId === item.id;
  const isDragOver = dragOverItemId === item.id && draggingItemId !== item.id;
  const hasFavoriteAction = selectable;
  const hasMenu =
    item.canAddChild ||
    item.draggable ||
    Boolean(item.orderable && onReorderNavItem) ||
    hasFavoriteAction;
  return (
    <li key={item.id}>
      <div
        className="sidebar-tree__item-row"
        data-dragging={isDragging ? "true" : undefined}
        data-drag-over={isDragOver ? "true" : undefined}
        data-selected={selected ? "true" : undefined}
        style={{ ["--sidebar-depth" as string]: depth }}
        onDragOver={
          item.droppable
            ? (event) => {
                if (
                  !Array.from(event.dataTransfer.types).includes(
                    "application/x-sidebar-nav-item",
                  )
                ) {
                  return;
                }
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (dragOverItemId !== item.id) onDragOver(item.id);
              }
            : undefined
        }
        onDragLeave={
          item.droppable
            ? () => {
                if (dragOverItemId === item.id) onDragOver(null);
              }
            : undefined
        }
        onDrop={
          item.droppable
            ? (event) => {
                const sourceId = event.dataTransfer.getData(
                  "application/x-sidebar-nav-item",
                );
                event.preventDefault();
                event.stopPropagation();
                onDragOver(null);
                if (sourceId && sourceId !== item.id) onDrop(item.id);
              }
            : undefined
        }
      >
        {hasChildren ? (
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
        ) : (
          // Reserve the chevron column even on leaf rows so labels stay
          // vertically aligned with rows that do have children.
          <span className="sidebar-tree__item-disclosure-placeholder" aria-hidden="true" />
        )}
        {isRenaming ? (
          <RenameInput
            initial={(() => {
              // Strip the surface-specific prefix so the user only edits
              // the slug part (e.g. "docs/intro", not "pages:docs/intro").
              // Falls back to the raw id when no colon is present.
              const idx = item.id.indexOf(":");
              return idx >= 0 ? item.id.slice(idx + 1) : item.id;
            })()}
            onCancel={onCancelRename}
            onSubmit={onSubmitRename}
            validate={renameValidate}
          />
        ) : (
          <button
            type="button"
            className="sidebar-nav-item sidebar-tree__item"
            draggable={item.draggable ? true : undefined}
            onDragStart={
              item.draggable
                ? (event) => {
                    event.dataTransfer.setData(
                      "application/x-sidebar-nav-item",
                      item.id,
                    );
                    event.dataTransfer.effectAllowed = "move";
                    onDragStart(item.id);
                  }
                : undefined
            }
            onDragEnd={item.draggable ? () => onDragEnd() : undefined}
            onClick={() => {
              if (selectable) {
                onSelectNavItem(surfaceId, item.id);
                return;
              }
              if (hasChildren) toggleItemTree(treeKey);
            }}
            aria-current={selected ? "page" : undefined}
            data-selectable={selectable ? undefined : "false"}
            title={selectable ? item.label : `${item.label} folder`}
          >
            {item.icon && (
              <span className="sidebar-nav-item-icon">{item.icon}</span>
            )}
            <span className="sidebar-tree__item-label">
              {item.label}
            </span>
            {item.badge !== undefined && item.badge !== null && (
              <span className="sidebar-tree__badge">{item.badge}</span>
            )}
          </button>
        )}
        {!isRenaming && hasMenu ? (
          <details className="sidebar-tree__item-menu">
            <summary
              className="sidebar-tree__item-more"
              aria-label={`Actions for ${item.label}`}
              title="Actions"
            >
              <MoreIcon />
            </summary>
            <div className="sidebar-tree__item-menu-popover" role="menu">
              {item.canAddChild ? (
                <button
                  type="button"
                  className="sidebar-tree__item-menu-action"
                  onClick={(event) => {
                    closeActionMenu(event.currentTarget);
                    onSelectNavItem(surfaceId, `add:${item.id}`);
                  }}
                  aria-label={`Add under ${item.label}`}
                  role="menuitem"
                >
                  <span className="sidebar-tree__item-menu-icon" aria-hidden="true">
                    +
                  </span>
                  <span>Add sub-page</span>
                </button>
              ) : null}
              {item.draggable ? (
                <button
                  type="button"
                  className="sidebar-tree__item-menu-action"
                  onClick={(event) => {
                    closeActionMenu(event.currentTarget);
                    onStartRename(item.id);
                  }}
                  aria-label={`Rename ${item.label}`}
                  role="menuitem"
                >
                  <span className="sidebar-tree__item-menu-icon" aria-hidden="true">
                    ✎
                  </span>
                  <span>Rename</span>
                </button>
              ) : null}
              {item.orderable && onReorderNavItem ? (
                <>
                  <button
                    type="button"
                    className="sidebar-tree__item-menu-action"
                    disabled={siblingIndex <= 0}
                    onClick={(event) => {
                      closeActionMenu(event.currentTarget);
                      onReorderNavItem(surfaceId, item.id, "up");
                    }}
                    aria-label={`Move ${item.label} up`}
                    role="menuitem"
                  >
                    <span className="sidebar-tree__item-menu-icon" aria-hidden="true">
                      <ReorderIcon direction="up" />
                    </span>
                    <span>Move up</span>
                  </button>
                  <button
                    type="button"
                    className="sidebar-tree__item-menu-action"
                    disabled={siblingIndex >= siblingCount - 1}
                    onClick={(event) => {
                      closeActionMenu(event.currentTarget);
                      onReorderNavItem(surfaceId, item.id, "down");
                    }}
                    aria-label={`Move ${item.label} down`}
                    role="menuitem"
                  >
                    <span className="sidebar-tree__item-menu-icon" aria-hidden="true">
                      <ReorderIcon direction="down" />
                    </span>
                    <span>Move down</span>
                  </button>
                </>
              ) : null}
              {hasFavoriteAction ? (
                <button
                  type="button"
                  className="sidebar-tree__item-menu-action"
                  data-active={isFavorite(surfaceId, item.id) ? "true" : undefined}
                  onClick={(event) => {
                    closeActionMenu(event.currentTarget);
                    onToggleFavorite({
                      surfaceId,
                      itemId: item.id,
                      label: item.label,
                    });
                  }}
                  aria-label={
                    isFavorite(surfaceId, item.id)
                      ? `Unpin ${item.label} from favorites`
                      : `Pin ${item.label} to favorites`
                  }
                  role="menuitem"
                >
                  <span className="sidebar-tree__item-menu-icon" aria-hidden="true">
                    <StarIcon filled={isFavorite(surfaceId, item.id)} />
                  </span>
                  <span>
                    {isFavorite(surfaceId, item.id) ? "Unpin" : "Pin"}
                  </span>
                </button>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
      {hasChildren && treeOpen && (
        <ul
          id={treeId}
          className="sidebar-tree__items sidebar-tree__items--nested"
          role="list"
        >
          {item.children!.map((child, childIndex) => {
            const reorderSiblings = item.children!.filter((entry) => entry.id.startsWith("pages:"));
            const reorderIndex = reorderSiblings.findIndex((entry) => entry.id === child.id);
            return renderNavItem({
              activeNavItemId,
              depth: depth + 1,
              dragOverItemId,
              draggingItemId,
              isFavorite,
              item: child,
              itemTreeCollapsed,
              onDragEnd,
              onDragOver,
              onDragStart,
              onDrop,
              onReorderNavItem,
              onSelectNavItem,
              onToggleFavorite,
              onStartRename,
              onCancelRename,
              onSubmitRename,
              renameValidate,
              renamingItemId,
              siblingCount: child.orderable ? reorderSiblings.length : item.children!.length,
              siblingIndex: child.orderable ? reorderIndex : childIndex,
              surfaceId,
              toggleItemTree,
              itemKey,
            });
          })}
        </ul>
      )}
    </li>
  );
}

export function Sidebar({
  surfaces,
  activeSurfaceId,
  activeNavItemId,
  favorites,
  onSelectSurface,
  onSelectNavItem,
  onToggleFavorite,
  isFavorite,
  onMoveNavItem,
  onReorderNavItem,
  onRenameNavItem,
  validateRenameNavItem,
}: SidebarProps) {
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);
  const [dragSurfaceId, setDragSurfaceId] = useState<string | null>(null);
  const [renamingItemId, setRenamingItemId] = useState<string | null>(null);
  const [renameSurfaceId, setRenameSurfaceId] = useState<string | null>(null);
  const startRename = useCallback((surfaceId: string, itemId: string) => {
    setRenameSurfaceId(surfaceId);
    setRenamingItemId(itemId);
  }, []);
  const cancelRename = useCallback(() => {
    setRenameSurfaceId(null);
    setRenamingItemId(null);
  }, []);
  const submitRename = useCallback(
    (newSlug: string) => {
      if (
        renamingItemId &&
        renameSurfaceId &&
        onRenameNavItem &&
        newSlug.trim()
      ) {
        onRenameNavItem(renameSurfaceId, renamingItemId, newSlug.trim());
      }
      cancelRename();
    },
    [cancelRename, onRenameNavItem, renameSurfaceId, renamingItemId],
  );
  const startDrag = useCallback((surfaceId: string, itemId: string) => {
    setDragSurfaceId(surfaceId);
    setDraggingItemId(itemId);
  }, []);
  const endDrag = useCallback(() => {
    setDragSurfaceId(null);
    setDraggingItemId(null);
    setDragOverItemId(null);
  }, []);
  const dropOnto = useCallback(
    (surfaceId: string, targetItemId: string) => {
      if (
        onMoveNavItem &&
        draggingItemId &&
        dragSurfaceId === surfaceId &&
        draggingItemId !== targetItemId
      ) {
        onMoveNavItem(surfaceId, draggingItemId, targetItemId);
      }
      endDrag();
    },
    [draggingItemId, dragSurfaceId, endDrag, onMoveNavItem],
  );
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
        onMouseDown={handleWindowDragMouseDown}
        aria-hidden="true"
      />
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 pt-2 pb-3 flex flex-col gap-4">
        {favorites.length > 0 && (
          <div>
            <p className="m-0 mb-1.5 px-1.5 text-[11px] font-semibold tracking-[0.06em] uppercase text-text-muted">
              Favorites
            </p>
            <ul className="sidebar-favorites" role="list">
              {favorites.map((fav) => {
                const selected =
                  activeSurfaceId === fav.surfaceId &&
                  activeNavItemId === fav.itemId;
                return (
                  <li key={`${fav.surfaceId}:${fav.itemId}`}>
                    <div className="sidebar-tree__item-row">
                      <button
                        type="button"
                        className="sidebar-nav-item sidebar-tree__item"
                        onClick={() =>
                          onSelectNavItem(fav.surfaceId, fav.itemId)
                        }
                        aria-current={selected ? "page" : undefined}
                      >
                        <span className="sidebar-favorites__star" aria-hidden="true">
                          <StarIcon filled />
                        </span>
                        <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                          {fav.label}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="sidebar-tree__item-star"
                        data-active="true"
                        onClick={() => onToggleFavorite(fav)}
                        aria-label={`Unpin ${fav.label} from favorites`}
                        title="Unpin from favorites"
                      >
                        <StarIcon filled />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
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
                                {group.items.map((item, itemIndex) => {
                                  const reorderSiblings = group.items.filter((entry) =>
                                    entry.id.startsWith("pages:"),
                                  );
                                  const reorderIndex = reorderSiblings.findIndex(
                                    (entry) => entry.id === item.id,
                                  );
                                  return renderNavItem({
                                    activeNavItemId,
                                    depth: 0,
                                    dragOverItemId,
                                    draggingItemId,
                                    isFavorite,
                                    item,
                                    itemTreeCollapsed,
                                    onDragEnd: endDrag,
                                    onDragOver: setDragOverItemId,
                                    onDragStart: (id) => startDrag(surface.id, id),
                                    onDrop: (targetId) => dropOnto(surface.id, targetId),
                                    onReorderNavItem,
                                    onSelectNavItem,
                                    onToggleFavorite,
                                    onStartRename: (id) => startRename(surface.id, id),
                                    onCancelRename: cancelRename,
                                    onSubmitRename: submitRename,
                                    renameValidate: renamingItemId
                                      ? (value) =>
                                          validateRenameNavItem
                                            ? validateRenameNavItem(
                                                surface.id,
                                                renamingItemId,
                                                value,
                                              )
                                            : null
                                      : undefined,
                                    renamingItemId,
                                    siblingCount: item.orderable
                                      ? reorderSiblings.length
                                      : group.items.length,
                                    siblingIndex: item.orderable ? reorderIndex : itemIndex,
                                    surfaceId: surface.id,
                                    toggleItemTree,
                                    itemKey,
                                  });
                                })}
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
