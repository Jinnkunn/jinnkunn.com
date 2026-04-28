import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SidebarFavorite } from "./favorites";
import type { SidebarRecentItem } from "./recent";
import type { SurfaceDefinition, SurfaceNavItem } from "../surfaces/types";

interface WorkspaceCommand {
  group: string;
  hint?: string;
  id: string;
  keywords: string;
  label: string;
  run: () => void;
}

interface WorkspaceCommandPaletteProps {
  activeNavItemId: string | null;
  activeSurfaceId: string;
  eventCount: number;
  favorites: readonly SidebarFavorite[];
  onClearWorkspaceEvents: () => void;
  onClose: () => void;
  onOpenWorkspaceDashboard: () => void;
  onRecordRecent: (entry: Omit<SidebarRecentItem, "visitedAt">) => void;
  onSelectNavItem: (surfaceId: string, navItemId: string) => void;
  onSelectSurface: (id: string) => void;
  open: boolean;
  recentItems: readonly SidebarRecentItem[];
  surfaces: readonly SurfaceDefinition[];
}

function collectNavItems(
  items: readonly SurfaceNavItem[] | undefined,
  out: SurfaceNavItem[] = [],
): SurfaceNavItem[] {
  if (!items) return out;
  for (const item of items) {
    out.push(item);
    collectNavItems(item.children, out);
  }
  return out;
}

function findSurface(surfaces: readonly SurfaceDefinition[], id: string) {
  return surfaces.find((surface) => surface.id === id);
}

function commandOptionId(id: string): string {
  return `workspace-command-option-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function WorkspaceCommandPalette({
  activeNavItemId,
  activeSurfaceId,
  eventCount,
  favorites,
  onClearWorkspaceEvents,
  onClose,
  onOpenWorkspaceDashboard,
  onRecordRecent,
  onSelectNavItem,
  onSelectSurface,
  open,
  recentItems,
  surfaces,
}: WorkspaceCommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const dismiss = useCallback(() => {
    setQuery("");
    setCursor(0);
    onClose();
  }, [onClose]);

  const run = useCallback(
    (action: () => void) => {
      action();
      dismiss();
    },
    [dismiss],
  );

  const commands = useMemo<WorkspaceCommand[]>(() => {
    const items: WorkspaceCommand[] = [];
    const seen = new Set<string>();

    const pushNavCommand = (
      group: string,
      surfaceId: string,
      itemId: string,
      label: string,
      hint?: string,
    ) => {
      const surface = findSurface(surfaces, surfaceId);
      if (!surface || surface.disabled) return;
      const commandId = `${group}:${surfaceId}:${itemId}`;
      if (seen.has(commandId)) return;
      seen.add(commandId);
      items.push({
        group,
        hint: hint ?? surface.title,
        id: commandId,
        label,
        keywords: `${surface.title} ${surfaceId} ${itemId} ${label}`,
        run: () => {
          onRecordRecent({
            itemId,
            label,
            surfaceId,
            surfaceTitle: surface.title,
          });
          onSelectNavItem(surfaceId, itemId);
        },
      });
    };

    const runNavAction = (
      surfaceId: string,
      itemId: string,
      label: string,
      surfaceTitle?: string,
    ) => {
      const surface = findSurface(surfaces, surfaceId);
      if (!surface || surface.disabled) return;
      onRecordRecent({
        itemId,
        label,
        surfaceId,
        surfaceTitle: surfaceTitle ?? surface.title,
      });
      onSelectNavItem(surfaceId, itemId);
    };

    items.push({
      group: "Workspace",
      hint: activeSurfaceId === "workspace" ? "current" : "home",
      id: "workspace:dashboard",
      label: "Open Workspace Dashboard",
      keywords: "workspace dashboard command center home overview launch",
      run: onOpenWorkspaceDashboard,
    });

    if (eventCount > 0) {
      items.push({
        group: "Workspace",
        hint: `${eventCount} events`,
        id: "workspace:clear-activity",
        label: "Clear Workspace Activity",
        keywords: "workspace activity notifications events clear reset",
        run: onClearWorkspaceEvents,
      });
    }

    for (const action of [
      {
        hint: "Deploy health",
        id: "quick:site-status",
        itemId: "status",
        keywords: "deploy status staging production worker candidate publish",
        label: "Open Site Status",
        surfaceId: "site-admin",
      },
      {
        hint: "Landing page",
        id: "quick:home-editor",
        itemId: "home",
        keywords: "home landing editor mdx page",
        label: "Open Home Editor",
        surfaceId: "site-admin",
      },
      {
        hint: "Reusable blocks",
        id: "quick:shared-content",
        itemId: "components",
        keywords: "shared components news teaching publications works",
        label: "Open Shared Content",
        surfaceId: "site-admin",
      },
      {
        hint: "Route and icon checks",
        id: "quick:site-links",
        itemId: "links",
        keywords: "links audit icon link internal route broken protected",
        label: "Open Link Audit",
        surfaceId: "site-admin",
      },
    ] as const) {
      items.push({
        group: "Quick Actions",
        hint: action.hint,
        id: action.id,
        label: action.label,
        keywords: action.keywords,
        run: () =>
          runNavAction(
            action.surfaceId,
            action.itemId,
            action.label,
            "Site Admin",
          ),
      });
    }

    for (const recent of recentItems) {
      pushNavCommand(
        "Recent",
        recent.surfaceId,
        recent.itemId,
        recent.label,
        recent.surfaceTitle,
      );
    }

    for (const favorite of favorites) {
      pushNavCommand(
        "Pinned",
        favorite.surfaceId,
        favorite.itemId,
        favorite.label,
      );
    }

    for (const surface of surfaces) {
      if (surface.disabled) continue;
      items.push({
        group: "Surfaces",
        hint: surface.id === activeSurfaceId ? "current" : undefined,
        id: `surface:${surface.id}`,
        label: `Open ${surface.title}`,
        keywords: `${surface.title} ${surface.id} switch open tool surface`,
        run: () => onSelectSurface(surface.id),
      });

      const navItems = surface.navGroups?.flatMap((group) =>
        collectNavItems(group.items),
      ) ?? [];
      for (const item of navItems) {
        if (item.selectable === false) continue;
        const current =
          surface.id === activeSurfaceId && item.id === activeNavItemId;
        items.push({
          group: surface.title,
          hint: current ? "current" : surface.title,
          id: `nav:${surface.id}:${item.id}`,
          label: item.label,
          keywords: `${surface.title} ${surface.id} ${item.id} ${item.label}`,
          run: () => {
            onRecordRecent({
              itemId: item.id,
              label: item.label,
              surfaceId: surface.id,
              surfaceTitle: surface.title,
            });
            onSelectNavItem(surface.id, item.id);
          },
        });
      }
    }

    return items;
  }, [
    activeNavItemId,
    activeSurfaceId,
    eventCount,
    favorites,
    onClearWorkspaceEvents,
    onOpenWorkspaceDashboard,
    onSelectNavItem,
    onRecordRecent,
    onSelectSurface,
    recentItems,
    surfaces,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((cmd) =>
      `${cmd.group} ${cmd.label} ${cmd.hint ?? ""} ${cmd.keywords}`
        .toLowerCase()
        .includes(q),
    );
  }, [commands, query]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCursor(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const activeEl = list.children[cursor] as HTMLElement | undefined;
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [cursor, open, filtered]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setCursor((current) => Math.min(filtered.length - 1, current + 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setCursor((current) => Math.max(0, current - 1));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const target = filtered[cursor];
        if (target) run(target.run);
      }
    },
    [cursor, dismiss, filtered, run],
  );

  if (!open) return null;

  const activeOptionId = filtered[cursor]
    ? commandOptionId(filtered[cursor].id)
    : undefined;
  let lastGroup = "";

  return (
    <div
      className="command-palette__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div
        className="command-palette command-palette--workspace"
        role="dialog"
        aria-modal="true"
        aria-label="Workspace command palette"
        onKeyDown={onKeyDown}
      >
        <div className="command-palette__input-wrap">
          <span className="command-palette__scope">Workspace</span>
          <input
            ref={inputRef}
            className="command-palette__input"
            placeholder="Jump to a tool, page, or recent item..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-controls="workspace-command-palette-list"
            aria-activedescendant={activeOptionId}
          />
          <kbd className="command-palette__hint-key">Esc</kbd>
        </div>
        {filtered.length === 0 ? (
          <div className="command-palette__empty">
            <p>No matches.</p>
            <span>{'Try "home", "calendar", "settings", or a page title.'}</span>
          </div>
        ) : (
          <ul
            id="workspace-command-palette-list"
            className="command-palette__list"
            role="listbox"
            ref={listRef}
          >
            {filtered.map((cmd, index) => {
              const showGroup = cmd.group !== lastGroup;
              lastGroup = cmd.group;
              return (
                <li
                  className="command-palette__entry"
                  key={cmd.id}
                  role="presentation"
                >
                  {showGroup ? (
                    <div className="command-palette__group-label">
                      {cmd.group}
                    </div>
                  ) : null}
                  <button
                    id={commandOptionId(cmd.id)}
                    className="command-palette__row"
                    type="button"
                    role="option"
                    aria-selected={index === cursor}
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => run(cmd.run)}
                  >
                    <span className="command-palette__label">{cmd.label}</span>
                    {cmd.hint ? (
                      <span className="command-palette__hint">{cmd.hint}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
