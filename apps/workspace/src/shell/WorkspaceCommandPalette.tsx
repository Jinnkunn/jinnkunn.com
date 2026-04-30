import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getCommandActions } from "../modules/registry";
import { todosCreate, type TodoRow } from "../modules/todos/api";
import {
  hasQuickTodoPrefix,
  parseQuickTodoInput,
} from "../modules/todos/quickCapture";
import {
  TODOS_INBOX_NAV_ID,
  TODOS_SCHEDULED_NAV_ID,
  TODOS_TODAY_NAV_ID,
  TODOS_UNSCHEDULED_NAV_ID,
  TODOS_UPCOMING_NAV_ID,
} from "../surfaces/todos/nav";
import type { SidebarFavorite } from "./favorites";
import type { SidebarRecentItem } from "./recent";
import type { SurfaceDefinition, SurfaceNavItem } from "../surfaces/types";

interface WorkspaceCommand {
  group: string;
  hint?: string;
  id: string;
  keywords: string;
  label: string;
  run: () => void | Promise<void>;
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
  const [commandError, setCommandError] = useState<string | null>(null);
  const [runningCommandId, setRunningCommandId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const dismiss = useCallback(() => {
    setQuery("");
    setCursor(0);
    setCommandError(null);
    setRunningCommandId(null);
    onClose();
  }, [onClose]);

  const run = useCallback(
    (command: WorkspaceCommand) => {
      if (runningCommandId) return;
      setCommandError(null);
      try {
        const result = command.run();
        if (result && typeof result.then === "function") {
          setRunningCommandId(command.id);
          void result
            .then(dismiss)
            .catch((error) => setCommandError(formatCommandError(error)))
            .finally(() => setRunningCommandId(null));
          return;
        }
        dismiss();
      } catch (error) {
        setCommandError(formatCommandError(error));
      }
    },
    [dismiss, runningCommandId],
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

    for (const action of getCommandActions()) {
      const surface = findSurface(surfaces, action.surfaceId);
      if (!surface || surface.disabled || seen.has(action.id)) continue;
      seen.add(action.id);
      items.push({
        group: action.group ?? "Quick Actions",
        hint: action.hint,
        id: action.id,
        label: action.label,
        keywords: `${surface.title} ${action.surfaceId} ${action.navItemId ?? ""} ${action.keywords}`,
        run: () => {
          if (action.navItemId) {
            onRecordRecent({
              itemId: action.navItemId,
              label: action.label,
              surfaceId: action.surfaceId,
              surfaceTitle: surface.title,
            });
            onSelectNavItem(action.surfaceId, action.navItemId);
            return;
          }
          onSelectSurface(action.surfaceId);
        },
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

  const baseFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((cmd) =>
      `${cmd.group} ${cmd.label} ${cmd.hint ?? ""} ${cmd.keywords}`
        .toLowerCase()
        .includes(q),
    );
  }, [commands, query]);

  const quickTodoDraft = useMemo(
    () => parseQuickTodoInput(query),
    [query],
  );

  const filtered = useMemo<WorkspaceCommand[]>(() => {
    const todoSurface = findSurface(surfaces, "todos");
    const shouldOfferQuickTodo =
      quickTodoDraft &&
      todoSurface &&
      !todoSurface.disabled &&
      (hasQuickTodoPrefix(query) || baseFiltered.length === 0);
    if (!shouldOfferQuickTodo) return baseFiltered;
    const command: WorkspaceCommand = {
      group: "Quick Capture",
      hint: quickTodoDraft.preview,
      id: "quick-capture:todo",
      keywords: `todo task quick capture create ${query}`,
      label: `Create todo · ${quickTodoDraft.title}`,
      run: async () => {
        const row = await todosCreate({
          dueAt: quickTodoDraft.dueAt,
          estimatedMinutes: quickTodoDraft.estimatedMinutes,
          scheduledEndAt: quickTodoDraft.scheduledEndAt,
          scheduledStartAt: quickTodoDraft.scheduledStartAt,
          title: quickTodoDraft.title,
        });
        const navItemId = navItemForQuickTodo(row);
        onRecordRecent({
          itemId: navItemId,
          label: quickTodoNavLabel(navItemId),
          surfaceId: "todos",
          surfaceTitle: todoSurface.title,
        });
        onSelectNavItem("todos", navItemId);
      },
    };
    return [command, ...baseFiltered];
  }, [
    baseFiltered,
    onRecordRecent,
    onSelectNavItem,
    query,
    quickTodoDraft,
    surfaces,
  ]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCursor(0);
    setCommandError(null);
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
        if (target) run(target);
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
            disabled={Boolean(runningCommandId)}
            role="combobox"
            aria-expanded="true"
            aria-controls="workspace-command-palette-list"
            aria-activedescendant={activeOptionId}
          />
          <kbd className="command-palette__hint-key">Esc</kbd>
        </div>
        {commandError ? (
          <div className="command-palette__error" role="status">
            {commandError}
          </div>
        ) : null}
        {filtered.length === 0 ? (
          <div className="command-palette__empty">
            <p>No matches.</p>
            <span>{'Try "home", "calendar", "settings", or type "+ write report tomorrow 3pm".'}</span>
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
                    onClick={() => run(cmd)}
                    disabled={Boolean(runningCommandId)}
                    data-running={runningCommandId === cmd.id ? "true" : undefined}
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

function navItemForQuickTodo(todo: TodoRow): string {
  if (todo.scheduledStartAt === null && todo.dueAt === null) return TODOS_INBOX_NAV_ID;
  const timestamp = todo.scheduledStartAt ?? todo.dueAt;
  if (timestamp !== null) {
    const today = startOfLocalDay(new Date());
    const tomorrow = addLocalDays(today, 1).getTime();
    const upcomingEnd = addLocalDays(today, 15).getTime();
    if (timestamp < tomorrow) return TODOS_TODAY_NAV_ID;
    if (timestamp < upcomingEnd) return TODOS_UPCOMING_NAV_ID;
  }
  if (todo.scheduledStartAt !== null) return TODOS_SCHEDULED_NAV_ID;
  return TODOS_UNSCHEDULED_NAV_ID;
}

function quickTodoNavLabel(navItemId: string): string {
  switch (navItemId) {
    case TODOS_INBOX_NAV_ID:
      return "Inbox";
    case TODOS_SCHEDULED_NAV_ID:
      return "Scheduled";
    case TODOS_UNSCHEDULED_NAV_ID:
      return "Unscheduled";
    case TODOS_UPCOMING_NAV_ID:
      return "Upcoming";
    case TODOS_TODAY_NAV_ID:
    default:
      return "Today";
  }
}

function formatCommandError(error: unknown): string {
  const message = String(error);
  if (
    message.includes("invoke") ||
    message.includes("__TAURI_INTERNALS__") ||
    message.includes("is not a function")
  ) {
    return "Todo data is available in the desktop app.";
  }
  return `Command failed: ${message}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number): Date {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  return out;
}
