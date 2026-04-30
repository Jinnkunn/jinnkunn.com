import { useCallback, useEffect, useState } from "react";

import type {
  SurfaceDefinition,
  SurfaceNavGroup,
  SurfaceNavItem,
} from "../surfaces/types";
import {
  CONTEXT_MENU_SEPARATOR,
  showContextMenuWithActions,
} from "./contextMenu";
import type { SidebarFavorite } from "./favorites";
import type { SidebarRecentItem } from "./recent";
import { WorkspaceIconButton, WorkspaceSidebarRow } from "../ui/primitives";

interface SidebarProps {
  surfaces: readonly SurfaceDefinition[];
  activeSurfaceId: string;
  activeNavItemId: string | null;
  favorites: readonly SidebarFavorite[];
  recentItems: readonly SidebarRecentItem[];
  sidebarCollapsed: boolean;
  onSelectSurface: (id: string) => void;
  onSelectNavItem: (surfaceId: string, navItemId: string) => void;
  onOpenSettings: () => void;
  onRecordRecent: (entry: Omit<SidebarRecentItem, "visitedAt">) => void;
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
  /** Reorders app-rail surfaces. The Command Center / workspace surface
   * stays fixed in the first slot; Sidebar only fires this for the
   * remaining app buttons. */
  onReorderSurface?: (
    surfaceId: string,
    targetSurfaceId: string,
    edge: "before" | "after",
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
const ITEM_TREE_COLLAPSE_STORAGE_KEY = "workspace.sidebar.itemTrees.v1";
const APP_RAIL_SURFACE_DRAG_TYPE = "application/x-workspace-surface";
const FIXED_APP_RAIL_SURFACE_ID = "workspace";
// Per-context-section collapse state. Currently keyed for "recent" and
// "favorites"; the surface tree under "Navigation" is intentionally not
// collapsible at the section level — that's the primary nav and hiding
// it would leave the sidebar useless. Per-group collapse inside the
// nav tree continues to use GROUP_COLLAPSE_STORAGE_KEY above.
const CONTEXT_SECTION_COLLAPSE_STORAGE_KEY =
  "workspace.sidebar.contextSections.v1";

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

function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 18 18"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.55"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="2.35" />
      <path d="M9 2.5v1.65M9 13.85v1.65M3.35 3.35l1.15 1.15M13.5 13.5l1.15 1.15M2.5 9h1.65M13.85 9h1.65M3.35 14.65l1.15-1.15M13.5 4.5l1.15-1.15" />
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
  onRecordRecent: (entry: Omit<SidebarRecentItem, "visitedAt">) => void;
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
  surfaceTitle: string;
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
  onRecordRecent,
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
  surfaceTitle,
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
      <WorkspaceSidebarRow
        className="sidebar-tree__item-row"
        depth={depth}
        dragging={isDragging}
        dragOver={isDragOver}
        selected={selected}
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
              if (item.renameValue !== undefined) return item.renameValue;
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
                onRecordRecent({
                  itemId: item.id,
                  label: item.label,
                  surfaceId,
                  surfaceTitle,
                });
                onSelectNavItem(surfaceId, item.id);
                return;
              }
              if (hasChildren) toggleItemTree(treeKey);
            }}
            onContextMenu={(event) => {
              // Native AppKit popup. The webview's default context menu
              // (Inspect Element, Reload) is suppressed in favor of our
              // own action list — same actions the inline ⋯ menu offers,
              // but reachable with a single right-click instead of a
              // hover-then-click.
              event.preventDefault();
              const pinned = isFavorite(surfaceId, item.id);
              const entries = [
                selectable && {
                  label: "Open",
                  run: () => {
                    onRecordRecent({
                      itemId: item.id,
                      label: item.label,
                      surfaceId,
                      surfaceTitle,
                    });
                    onSelectNavItem(surfaceId, item.id);
                  },
                },
                hasChildren && {
                  label: treeOpen ? "Collapse" : "Expand",
                  run: () => toggleItemTree(treeKey),
                },
                hasFavoriteAction && CONTEXT_MENU_SEPARATOR,
                hasFavoriteAction && {
                  label: pinned ? "Unpin from favorites" : "Pin to favorites",
                  run: () => {
                    onToggleFavorite({
                      surfaceId,
                      itemId: item.id,
                      label: item.label,
                    });
                  },
                },
                item.canAddChild && CONTEXT_MENU_SEPARATOR,
                item.canAddChild && {
                  label: "Add sub-page",
                  run: () => onSelectNavItem(surfaceId, `add:${item.id}`),
                },
                item.draggable && {
                  label: "Rename…",
                  run: () => onStartRename(item.id),
                },
              ].filter(Boolean) as Parameters<
                typeof showContextMenuWithActions
              >[0];
              showContextMenuWithActions(entries);
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
      </WorkspaceSidebarRow>
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
              onRecordRecent,
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
              surfaceTitle,
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
  recentItems,
  sidebarCollapsed,
  onSelectSurface,
  onSelectNavItem,
  onOpenSettings,
  onRecordRecent,
  onToggleFavorite,
  isFavorite,
  onMoveNavItem,
  onReorderNavItem,
  onReorderSurface,
  onRenameNavItem,
  validateRenameNavItem,
}: SidebarProps) {
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);
  const [dragSurfaceId, setDragSurfaceId] = useState<string | null>(null);
  const [draggingAppSurfaceId, setDraggingAppSurfaceId] = useState<string | null>(null);
  const [surfaceDropTarget, setSurfaceDropTarget] = useState<{
    edge: "before" | "after";
    surfaceId: string;
  } | null>(null);
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
  const endAppSurfaceDrag = useCallback(() => {
    setDraggingAppSurfaceId(null);
    setSurfaceDropTarget(null);
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
  const [itemTreeCollapsed, setItemTreeCollapsed] = useState<CollapseMap>(() =>
    loadCollapseMap(ITEM_TREE_COLLAPSE_STORAGE_KEY),
  );
  // Recent + Favorites can be collapsed individually so a daily reorder
  // of the surface tree doesn't have to step around stale recents the
  // operator already knows about. State is keyed by section id ("recent"
  // / "favorites") so adding a future section is a one-line change.
  const [contextSectionCollapsed, setContextSectionCollapsed] = useState<CollapseMap>(
    () => loadCollapseMap(CONTEXT_SECTION_COLLAPSE_STORAGE_KEY),
  );

  useEffect(() => {
    persistCollapseMap(GROUP_COLLAPSE_STORAGE_KEY, groupCollapsed);
  }, [groupCollapsed]);

  useEffect(() => {
    persistCollapseMap(ITEM_TREE_COLLAPSE_STORAGE_KEY, itemTreeCollapsed);
  }, [itemTreeCollapsed]);

  useEffect(() => {
    persistCollapseMap(
      CONTEXT_SECTION_COLLAPSE_STORAGE_KEY,
      contextSectionCollapsed,
    );
  }, [contextSectionCollapsed]);

  const toggleGroup = useCallback((key: string) => {
    setGroupCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const toggleItemTree = useCallback((key: string) => {
    setItemTreeCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const toggleContextSection = useCallback((key: string) => {
    setContextSectionCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const isContextSectionOpen = useCallback(
    (key: string) => !contextSectionCollapsed[key],
    [contextSectionCollapsed],
  );

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
      group.items.some((item) => itemContainsActive(item, activeNavItemId))
    ) {
      return true;
    }
    return !groupCollapsed[groupKey(surfaceId, group.id)];
  };

  const activeSurface =
    surfaces.find((surface) => surface.id === activeSurfaceId) ?? surfaces[0];

  if (!activeSurface) {
    return null;
  }

  return (
    <aside
      className="sidebar-surface"
      data-collapsed={sidebarCollapsed ? "true" : undefined}
      aria-label="Primary navigation"
    >
      <div className="sidebar-app-rail" aria-label="Workspace apps">
        <nav className="sidebar-app-rail__nav" aria-label="Workspace apps">
          {surfaces.map((surface) => {
            const active = surface.id === activeSurfaceId;
            const reorderable =
              Boolean(onReorderSurface) &&
              !surface.disabled &&
              surface.id !== FIXED_APP_RAIL_SURFACE_ID;
            const dropEdge =
              surfaceDropTarget?.surfaceId === surface.id
                ? surfaceDropTarget.edge
                : undefined;
            return (
              <button
                key={surface.id}
                type="button"
                aria-current={active ? "page" : undefined}
                className="sidebar-app-rail__button"
                draggable={reorderable ? true : undefined}
                onDragStart={
                  reorderable
                    ? (event) => {
                        event.dataTransfer.setData(
                          APP_RAIL_SURFACE_DRAG_TYPE,
                          surface.id,
                        );
                        event.dataTransfer.effectAllowed = "move";
                        setDraggingAppSurfaceId(surface.id);
                      }
                    : undefined
                }
                onDragOver={
                  reorderable
                    ? (event) => {
                        if (
                          !Array.from(event.dataTransfer.types).includes(
                            APP_RAIL_SURFACE_DRAG_TYPE,
                          )
                        ) {
                          return;
                        }
                        const sourceId =
                          draggingAppSurfaceId ||
                          event.dataTransfer.getData(APP_RAIL_SURFACE_DRAG_TYPE);
                        if (
                          !sourceId ||
                          sourceId === surface.id ||
                          sourceId === FIXED_APP_RAIL_SURFACE_ID
                        ) {
                          return;
                        }
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        const rect = event.currentTarget.getBoundingClientRect();
                        const edge =
                          event.clientY > rect.top + rect.height / 2
                            ? "after"
                            : "before";
                        setSurfaceDropTarget({ edge, surfaceId: surface.id });
                      }
                    : undefined
                }
                onDragLeave={
                  reorderable
                    ? () => {
                        if (surfaceDropTarget?.surfaceId === surface.id) {
                          setSurfaceDropTarget(null);
                        }
                      }
                    : undefined
                }
                onDrop={
                  reorderable
                    ? (event) => {
                        const sourceId = event.dataTransfer.getData(
                          APP_RAIL_SURFACE_DRAG_TYPE,
                        );
                        const edge = dropEdge ?? "before";
                        event.preventDefault();
                        event.stopPropagation();
                        if (
                          onReorderSurface &&
                          sourceId &&
                          sourceId !== surface.id &&
                          sourceId !== FIXED_APP_RAIL_SURFACE_ID
                        ) {
                          onReorderSurface(sourceId, surface.id, edge);
                        }
                        endAppSurfaceDrag();
                      }
                    : undefined
                }
                onDragEnd={reorderable ? endAppSurfaceDrag : undefined}
                onClick={() => onSelectSurface(surface.id)}
                disabled={surface.disabled}
                title={surface.description ?? surface.title}
                aria-label={surface.title}
                data-drop-edge={dropEdge}
                data-surface-dragging={
                  draggingAppSurfaceId === surface.id ? "true" : undefined
                }
                data-surface-reorderable={reorderable ? "true" : undefined}
              >
                <span className="sidebar-app-rail__icon" aria-hidden="true">
                  {surface.icon}
                </span>
                {surface.disabled ? (
                  <span className="sidebar-app-rail__soon" aria-hidden="true">
                    soon
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-app-rail__footer">
          <button
            type="button"
            className="sidebar-settings-button"
            onClick={onOpenSettings}
            aria-label="Open settings"
            title="Settings"
          >
            <SettingsIcon />
          </button>
        </div>
      </div>
      <div
        id="workspace-sidebar-context-pane"
        className="sidebar-context-pane"
        aria-hidden={sidebarCollapsed ? "true" : undefined}
      >
        <header
          className="sidebar-context-header"
        >
          <p className="sidebar-context-header__eyebrow">Workspace</p>
          <h2 className="sidebar-context-header__title">{activeSurface.title}</h2>
          {activeSurface.description ? (
            <p className="sidebar-context-header__description">
              {activeSurface.description}
            </p>
          ) : null}
        </header>
        <div className="sidebar-context-scroll">
        {recentItems.length > 0 && (() => {
          const recentOpen = isContextSectionOpen("recent");
          const recentCount = Math.min(recentItems.length, 5);
          return (
            <section
              className="sidebar-context-section"
              data-collapsed={recentOpen ? undefined : "true"}
            >
              <button
                type="button"
                className="sidebar-context-section__label sidebar-context-section__toggle"
                onClick={() => toggleContextSection("recent")}
                aria-expanded={recentOpen}
                aria-controls="sidebar-section-recent"
              >
                <ChevronIcon open={recentOpen} />
                <span>Recent</span>
                <span className="sidebar-context-section__count" aria-hidden="true">
                  {recentCount}
                </span>
              </button>
              {recentOpen && (
                <ul
                  id="sidebar-section-recent"
                  className="sidebar-recent"
                  role="list"
                >
                  {recentItems.slice(0, 5).map((recent) => {
                const selected =
                  activeSurfaceId === recent.surfaceId &&
                  activeNavItemId === recent.itemId;
                return (
                  <li key={`${recent.surfaceId}:${recent.itemId}`}>
                    <WorkspaceSidebarRow
                      className="sidebar-tree__item-row"
                      selected={selected}
                    >
                      <button
                        type="button"
                        className="sidebar-nav-item sidebar-tree__item sidebar-recent__item"
                        onClick={() =>
                          {
                            onRecordRecent({
                              itemId: recent.itemId,
                              label: recent.label,
                              surfaceId: recent.surfaceId,
                              surfaceTitle: recent.surfaceTitle,
                            });
                            onSelectNavItem(recent.surfaceId, recent.itemId);
                          }
                        }
                        aria-current={selected ? "page" : undefined}
                      >
                        <span className="sidebar-recent__clock" aria-hidden="true">
                          ◷
                        </span>
                        <span className="sidebar-recent__body">
                          <span className="sidebar-tree__item-label">
                            {recent.label}
                          </span>
                          <span className="sidebar-recent__meta">
                            {recent.surfaceTitle}
                          </span>
                        </span>
                      </button>
                    </WorkspaceSidebarRow>
                  </li>
                );
              })}
                </ul>
              )}
            </section>
          );
        })()}
        {favorites.length > 0 && (() => {
          const favoritesOpen = isContextSectionOpen("favorites");
          return (
            <section
              className="sidebar-context-section"
              data-collapsed={favoritesOpen ? undefined : "true"}
            >
              <button
                type="button"
                className="sidebar-context-section__label sidebar-context-section__toggle"
                onClick={() => toggleContextSection("favorites")}
                aria-expanded={favoritesOpen}
                aria-controls="sidebar-section-favorites"
              >
                <ChevronIcon open={favoritesOpen} />
                <span>Favorites</span>
                <span className="sidebar-context-section__count" aria-hidden="true">
                  {favorites.length}
                </span>
              </button>
              {favoritesOpen && (
                <ul
                  id="sidebar-section-favorites"
                  className="sidebar-favorites"
                  role="list"
                >
                  {favorites.map((fav) => {
                const selected =
                  activeSurfaceId === fav.surfaceId &&
                  activeNavItemId === fav.itemId;
                return (
                  <li key={`${fav.surfaceId}:${fav.itemId}`}>
                    <WorkspaceSidebarRow
                      className="sidebar-tree__item-row"
                      selected={selected}
                    >
                      <button
                        type="button"
                        className="sidebar-nav-item sidebar-tree__item"
                        onClick={() =>
                          {
                            const surface = surfaces.find(
                              (entry) => entry.id === fav.surfaceId,
                            );
                            onRecordRecent({
                              itemId: fav.itemId,
                              label: fav.label,
                              surfaceId: fav.surfaceId,
                              surfaceTitle: surface?.title ?? fav.surfaceId,
                            });
                            onSelectNavItem(fav.surfaceId, fav.itemId);
                          }
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
                      <WorkspaceIconButton
                        className="sidebar-tree__item-star"
                        data-active="true"
                        onClick={() => onToggleFavorite(fav)}
                        aria-label={`Unpin ${fav.label} from favorites`}
                        title="Unpin from favorites"
                      >
                        <StarIcon filled />
                      </WorkspaceIconButton>
                    </WorkspaceSidebarRow>
                  </li>
                );
              })}
                </ul>
              )}
            </section>
          );
        })()}
        <section className="sidebar-context-section">
          <p className="sidebar-context-section__label">Navigation</p>
          {activeSurface.navGroups?.length ? (
            <nav className="sidebar-tree" aria-label={`${activeSurface.title} navigation`}>
              {activeSurface.navGroups.map((group) => {
                const open = isGroupOpen(activeSurface.id, group, true);
                return (
                  <div key={group.id} className="sidebar-tree__group">
                    <button
                      type="button"
                      className="sidebar-tree__group-header"
                      onClick={() =>
                        toggleGroup(groupKey(activeSurface.id, group.id))
                      }
                      aria-expanded={open}
                      aria-controls={`sidebar-group-${activeSurface.id}-${group.id}`}
                    >
                      <ChevronIcon open={open} />
                      <span>{group.label}</span>
                    </button>
                    {open && (
                      <ul
                        id={`sidebar-group-${activeSurface.id}-${group.id}`}
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
                            onDragStart: (id) => startDrag(activeSurface.id, id),
                            onDrop: (targetId) => dropOnto(activeSurface.id, targetId),
                            onReorderNavItem,
                            onRecordRecent,
                            onSelectNavItem,
                            onToggleFavorite,
                            onStartRename: (id) => startRename(activeSurface.id, id),
                            onCancelRename: cancelRename,
                            onSubmitRename: submitRename,
                            renameValidate: renamingItemId
                              ? (value) =>
                                  validateRenameNavItem
                                    ? validateRenameNavItem(
                                        activeSurface.id,
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
                            surfaceId: activeSurface.id,
                            surfaceTitle: activeSurface.title,
                            toggleItemTree,
                            itemKey,
                          });
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </nav>
          ) : (
            <p className="sidebar-context-empty">
              This surface uses the main workspace canvas.
            </p>
          )}
        </section>
        </div>
        <footer className="sidebar-footer">
          <p>Jinnkunn Workspace</p>
          <p>Personal desktop</p>
        </footer>
      </div>
    </aside>
  );
}
