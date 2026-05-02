import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getCommandActions } from "../modules/registry";
import {
  notesCreate,
  notesList,
  notesSearch,
  notesUpdate,
  type NoteSearchResult,
} from "../modules/notes/api";
import {
  contactsCreate,
  contactsSearch,
  type ContactSearchResult,
} from "../modules/contacts/api";
import {
  LOCAL_CALENDAR_SOURCE_TITLE,
  localCalendarCreateCalendar,
  localCalendarCreateEvent,
  localCalendarFetchEvents,
  localCalendarListCalendars,
  type LocalCalendarEventRow,
} from "../modules/calendar/localCalendarApi";
import {
  projectsCreate,
  projectsList,
  type ProjectRow,
} from "../modules/projects/api";
import {
  NOTE_ICON_INBOX,
  NOTES_INBOX_TITLE,
  findNoteByTitle,
  hasQuickNotePrefix,
  noteRowFromDetail,
  parseQuickNoteInput,
} from "../modules/notes/workflow";
import { todosCreate, todosList, type TodoRow } from "../modules/todos/api";
import {
  hasQuickTodoPrefix,
  parseQuickTodoInput,
  type QuickTodoDraft,
} from "../modules/todos/quickCapture";
import {
  TODOS_INBOX_NAV_ID,
  TODOS_SCHEDULED_NAV_ID,
  TODOS_TODAY_NAV_ID,
  TODOS_UNSCHEDULED_NAV_ID,
  TODOS_UPCOMING_NAV_ID,
  todoNavId,
} from "../surfaces/todos/nav";
import { noteNavId } from "../surfaces/notes/tree";
import { projectNavId } from "../surfaces/projects/nav";
import { contactNavId } from "../surfaces/contacts/nav";
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

interface WorkspaceSearchResults {
  contacts: ContactSearchResult[];
  events: LocalCalendarEventRow[];
  loading: boolean;
  notes: NoteSearchResult[];
  projects: ProjectRow[];
  query: string;
  todos: TodoRow[];
}

const EMPTY_SEARCH_RESULTS: WorkspaceSearchResults = {
  contacts: [],
  events: [],
  loading: false,
  notes: [],
  projects: [],
  query: "",
  todos: [],
};

interface WorkspaceCommandPaletteProps {
  activeNavItemId: string | null;
  activeSurfaceId: string;
  canGoBack: boolean;
  eventCount: number;
  favorites: readonly SidebarFavorite[];
  onClearWorkspaceEvents: () => void;
  onClose: () => void;
  onGoBack: () => void;
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
  canGoBack,
  eventCount,
  favorites,
  onClearWorkspaceEvents,
  onClose,
  onGoBack,
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
  const [searchResults, setSearchResults] =
    useState<WorkspaceSearchResults>(EMPTY_SEARCH_RESULTS);
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

    if (canGoBack) {
      items.push({
        group: "Workspace",
        hint: "⌘[",
        id: "workspace:go-back",
        label: "Back to Previous Place",
        keywords: "back previous history return go back",
        run: onGoBack,
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
    canGoBack,
    eventCount,
    favorites,
    onClearWorkspaceEvents,
    onGoBack,
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

  useEffect(() => {
    const q = query.trim();
    const normalized = q.toLowerCase();
    if (!open || normalized.length < 2 || hasAnyQuickCapturePrefix(query)) {
      return;
    }

    let cancelled = false;
    const handle = window.setTimeout(() => {
      setSearchResults((current) => ({
        ...current,
        loading: true,
        query: normalized,
      }));
      const today = startOfLocalDay(new Date());
      const startsAt = addLocalDays(today, -14).toISOString();
      const endsAt = addLocalDays(today, 90).toISOString();
      void Promise.allSettled([
        notesSearch(q),
        todosList(),
        projectsList(),
        contactsSearch(q),
        localCalendarFetchEvents({
          calendarIds: [],
          endsAt,
          startsAt,
        }),
      ]).then(([notesResult, todosResult, projectsResult, contactsResult, eventsResult]) => {
        if (cancelled) return;
        const todos = settledValue(todosResult, []).filter((todo) =>
          todo.archivedAt === null &&
          (matchesSearchText(todo.title, normalized) ||
            matchesSearchText(todo.notes, normalized)),
        );
        const projects = settledValue(projectsResult, []).filter((project) =>
          project.archivedAt === null &&
          (matchesSearchText(project.title, normalized) ||
            matchesSearchText(project.description, normalized)),
        );
        const events = settledValue(eventsResult, []).filter((event) =>
          matchesSearchText(event.title, normalized) ||
          matchesSearchText(event.location, normalized) ||
          matchesSearchText(event.notes, normalized),
        );
        setSearchResults({
          contacts: settledValue(contactsResult, []).slice(0, 6),
          events: events.slice(0, 6),
          loading: false,
          notes: settledValue(notesResult, []).slice(0, 6),
          projects: projects.slice(0, 6),
          query: normalized,
          todos: todos.slice(0, 6),
        });
      });
    }, 140);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, query]);

  const searchCommands = useMemo<WorkspaceCommand[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q || searchResults.query !== q || hasAnyQuickCapturePrefix(query)) {
      return [];
    }

    const items: WorkspaceCommand[] = [];
    const notesSurface = findSurface(surfaces, "notes");
    const todosSurface = findSurface(surfaces, "todos");
    const projectsSurface = findSurface(surfaces, "projects");
    const contactsSurface = findSurface(surfaces, "contacts");
    const calendarSurface = findSurface(surfaces, "calendar");

    if (notesSurface && !notesSurface.disabled) {
      for (const note of searchResults.notes) {
        const itemId = noteNavId(note.id);
        items.push({
          group: "Search Results",
          hint: `Note${note.excerpt ? ` / ${compactHint(note.excerpt)}` : ""}`,
          id: `search:note:${note.id}`,
          keywords: `note notes ${note.title} ${note.excerpt}`,
          label: note.title || "Untitled note",
          run: () => {
            onRecordRecent({
              itemId,
              label: note.title || "Untitled note",
              surfaceId: "notes",
              surfaceTitle: notesSurface.title,
            });
            onSelectNavItem("notes", itemId);
          },
        });
      }
    }

    if (todosSurface && !todosSurface.disabled) {
      for (const todo of searchResults.todos) {
        const itemId = todoNavId(todo.id);
        items.push({
          group: "Search Results",
          hint: todoSearchHint(todo),
          id: `search:todo:${todo.id}`,
          keywords: `todo task ${todo.title} ${todo.notes}`,
          label: todo.title || "Untitled todo",
          run: () => {
            onRecordRecent({
              itemId,
              label: todo.title || "Untitled todo",
              surfaceId: "todos",
              surfaceTitle: todosSurface.title,
            });
            onSelectNavItem("todos", itemId);
          },
        });
      }
    }

    if (projectsSurface && !projectsSurface.disabled) {
      for (const project of searchResults.projects) {
        const itemId = projectNavId(project.id);
        items.push({
          group: "Search Results",
          hint: projectSearchHint(project),
          id: `search:project:${project.id}`,
          keywords: `project ${project.title} ${project.description}`,
          label: project.title || "Untitled project",
          run: () => {
            onRecordRecent({
              itemId,
              label: project.title || "Untitled project",
              surfaceId: "projects",
              surfaceTitle: projectsSurface.title,
            });
            onSelectNavItem("projects", itemId);
          },
        });
      }
    }

    if (contactsSurface && !contactsSurface.disabled) {
      for (const contact of searchResults.contacts) {
        const itemId = contactNavId(contact.id);
        items.push({
          group: "Search Results",
          hint: `Contact${contact.company ? ` / ${contact.company}` : ""}`,
          id: `search:contact:${contact.id}`,
          keywords: `contact person crm ${contact.displayName} ${contact.company ?? ""} ${contact.excerpt}`,
          label: contact.displayName || "Untitled contact",
          run: () => {
            onRecordRecent({
              itemId,
              label: contact.displayName || "Untitled contact",
              surfaceId: "contacts",
              surfaceTitle: contactsSurface.title,
            });
            onSelectNavItem("contacts", itemId);
          },
        });
      }
    }

    if (calendarSurface && !calendarSurface.disabled) {
      for (const event of searchResults.events) {
        items.push({
          group: "Search Results",
          hint: eventSearchHint(event),
          id: `search:event:${event.eventIdentifier}:${event.startsAt}`,
          keywords: `calendar event ${event.title} ${event.location ?? ""} ${event.notes ?? ""}`,
          label: event.title || "Untitled event",
          run: () => onSelectSurface("calendar"),
        });
      }
    }

    return items;
  }, [
    onRecordRecent,
    onSelectNavItem,
    onSelectSurface,
    query,
    searchResults,
    surfaces,
  ]);

  const quickTodoDraft = useMemo(
    () => parseQuickTodoInput(query),
    [query],
  );
  const quickNoteDraft = useMemo(
    () => parseQuickNoteInput(query),
    [query],
  );
  const quickProjectDraft = useMemo(
    () => parseQuickProjectInput(query),
    [query],
  );
  const quickContactDraft = useMemo(
    () => parseQuickContactInput(query),
    [query],
  );
  const quickEventDraft = useMemo(
    () => parseQuickEventInput(query),
    [query],
  );

  const filtered = useMemo<WorkspaceCommand[]>(() => {
    const todoSurface = findSurface(surfaces, "todos");
    const notesSurface = findSurface(surfaces, "notes");
    const projectsSurface = findSurface(surfaces, "projects");
    const contactsSurface = findSurface(surfaces, "contacts");
    const calendarSurface = findSurface(surfaces, "calendar");
    const shouldOfferQuickTodo =
      quickTodoDraft &&
      todoSurface &&
      !todoSurface.disabled &&
      !hasQuickNotePrefix(query) &&
      !hasQuickProjectPrefix(query) &&
      !hasQuickContactPrefix(query) &&
      !hasQuickEventPrefix(query) &&
      (hasQuickTodoPrefix(query) || baseFiltered.length === 0);
    const shouldOfferQuickNote =
      quickNoteDraft &&
      notesSurface &&
      !notesSurface.disabled &&
      hasQuickNotePrefix(query);
    const shouldOfferQuickProject =
      quickProjectDraft &&
      projectsSurface &&
      !projectsSurface.disabled &&
      hasQuickProjectPrefix(query);
    const shouldOfferQuickContact =
      quickContactDraft &&
      contactsSurface &&
      !contactsSurface.disabled &&
      hasQuickContactPrefix(query);
    const shouldOfferQuickEvent =
      quickEventDraft &&
      calendarSurface &&
      !calendarSurface.disabled &&
      hasQuickEventPrefix(query);
    const quickCommands: WorkspaceCommand[] = [];
    if (shouldOfferQuickNote) {
      quickCommands.push({
        group: "Quick Capture",
        hint: quickNoteDraft.preview,
        id: "quick-capture:note",
        keywords: `note notes quick capture inbox create ${query}`,
        label: `Create note · ${quickNoteDraft.title}`,
        run: async () => {
          const rows = await notesList();
          let inbox = findNoteByTitle(rows, NOTES_INBOX_TITLE, null);
          if (!inbox) {
            const createdInbox = await notesCreate({
              title: NOTES_INBOX_TITLE,
            });
            const inboxDetail = await notesUpdate({
              icon: NOTE_ICON_INBOX,
              id: createdInbox.note.id,
            });
            inbox = noteRowFromDetail(inboxDetail);
          }
          const created = await notesCreate({
            parentId: inbox.id,
            title: quickNoteDraft.title,
          });
          const detail = await notesUpdate({
            bodyMdx: quickNoteDraft.bodyMdx,
            id: created.note.id,
          });
          const itemId = noteNavId(detail.id);
          onRecordRecent({
            itemId,
            label: detail.title,
            surfaceId: "notes",
            surfaceTitle: notesSurface.title,
          });
          onSelectNavItem("notes", itemId);
        },
      });
    }
    if (shouldOfferQuickTodo) {
      quickCommands.push({
        group: "Quick Capture",
        hint: quickTodoDraft.preview,
        id: "quick-capture:todo",
        keywords: `todo task quick capture create ${query}`,
        label: `Create todo · ${quickTodoDraft.title}`,
        run: async () => {
          const projectToken = extractProjectToken(quickTodoDraft.title);
          const project = projectToken.query
            ? await findProjectByToken(projectToken.query)
            : null;
          const row = await todosCreate({
            dueAt: quickTodoDraft.dueAt,
            estimatedMinutes: quickTodoDraft.estimatedMinutes,
            projectId: project?.id ?? null,
            scheduledEndAt: quickTodoDraft.scheduledEndAt,
            scheduledStartAt: quickTodoDraft.scheduledStartAt,
            title: projectToken.title,
          });
          const navItemId = todoNavId(row.id);
          onRecordRecent({
            itemId: navItemId,
            label: row.title || quickTodoNavLabel(navItemForQuickTodo(row)),
            surfaceId: "todos",
            surfaceTitle: todoSurface.title,
          });
          onSelectNavItem("todos", navItemId);
        },
      });
    }
    if (shouldOfferQuickProject) {
      quickCommands.push({
        group: "Quick Capture",
        hint: quickProjectDraft.preview,
        id: "quick-capture:project",
        keywords: `project quick capture create ${query}`,
        label: `Create project · ${quickProjectDraft.title}`,
        run: async () => {
          const row = await projectsCreate({
            dueAt: quickProjectDraft.dueAt,
            title: quickProjectDraft.title,
          });
          const itemId = projectNavId(row.id);
          onRecordRecent({
            itemId,
            label: row.title,
            surfaceId: "projects",
            surfaceTitle: projectsSurface.title,
          });
          onSelectNavItem("projects", itemId);
        },
      });
    }
    if (shouldOfferQuickContact) {
      quickCommands.push({
        group: "Quick Capture",
        hint: quickContactDraft.preview,
        id: "quick-capture:contact",
        keywords: `contact person crm quick capture create ${query}`,
        label: `Create contact · ${quickContactDraft.displayName}`,
        run: async () => {
          const row = await contactsCreate({
            company: quickContactDraft.company,
            displayName: quickContactDraft.displayName,
          });
          const itemId = contactNavId(row.id);
          onRecordRecent({
            itemId,
            label: row.displayName,
            surfaceId: "contacts",
            surfaceTitle: contactsSurface.title,
          });
          onSelectNavItem("contacts", itemId);
        },
      });
    }
    if (shouldOfferQuickEvent) {
      quickCommands.push({
        group: "Quick Capture",
        hint: quickEventDraft.preview,
        id: "quick-capture:event",
        keywords: `calendar event quick capture create ${query}`,
        label: `Create event · ${quickEventDraft.title}`,
        run: async () => {
          const calendar = await ensureWorkspaceCalendar();
          await localCalendarCreateEvent({
            calendarId: calendar.id,
            endsAt: quickEventDraft.endsAt.toISOString(),
            isAllDay: quickEventDraft.isAllDay,
            startsAt: quickEventDraft.startsAt.toISOString(),
            title: quickEventDraft.title,
          });
          onSelectSurface("calendar");
        },
      });
    }

    const searchIds = new Set(searchCommands.map((command) => command.id));
    const merged = [
      ...quickCommands,
      ...searchCommands,
      ...baseFiltered.filter((command) => !searchIds.has(command.id)),
    ];
    return merged;
  }, [
    baseFiltered,
    onRecordRecent,
    onSelectNavItem,
    onSelectSurface,
    query,
    quickContactDraft,
    quickEventDraft,
    quickNoteDraft,
    quickProjectDraft,
    quickTodoDraft,
    searchCommands,
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
            placeholder="Search workspace, or create with note: / + / project: / event:"
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
            <p>
              {searchResults.loading &&
              searchResults.query === query.trim().toLowerCase()
                ? "Searching..."
                : "No matches."}
            </p>
            <span>{'Try "home", "project: thesis", "contact: Ada @ Lab", or "+ write report tomorrow 3pm".'}</span>
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
    return "Workspace data is available in the desktop app.";
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

interface QuickProjectDraft {
  dueAt: number | null;
  preview: string;
  title: string;
}

interface QuickContactDraft {
  company: string | null;
  displayName: string;
  preview: string;
}

interface QuickEventDraft {
  endsAt: Date;
  isAllDay: boolean;
  preview: string;
  startsAt: Date;
  title: string;
}

function hasAnyQuickCapturePrefix(input: string): boolean {
  return (
    hasQuickNotePrefix(input) ||
    hasQuickTodoPrefix(input) ||
    hasQuickProjectPrefix(input) ||
    hasQuickContactPrefix(input) ||
    hasQuickEventPrefix(input)
  );
}

function hasQuickProjectPrefix(input: string): boolean {
  return /^\s*(?:project:?|proj:?|new project:?|项目[:：]?|專案[:：]?)/i.test(input);
}

function hasQuickContactPrefix(input: string): boolean {
  return /^\s*(?:contact:?|person:?|crm:?|new contact:?|联系人[:：]?|聯絡人[:：]?)/i.test(input);
}

function hasQuickEventPrefix(input: string): boolean {
  return /^\s*(?:event:?|calendar:?|cal:?|new event:?|日程[:：]?|事件[:：]?)/i.test(input);
}

function parseQuickProjectInput(input: string): QuickProjectDraft | null {
  const normalized = input.replace(
    /^\s*(?:project:?|proj:?|new project:?|项目[:：]?|專案[:：]?)\s*/i,
    "",
  ).trim();
  if (!normalized) return null;
  const draft = parseQuickTodoInput(`todo: ${normalized}`);
  if (!draft) return null;
  const dueAt = draft.scheduledStartAt ?? draft.dueAt;
  return {
    dueAt,
    preview: dueAt === null ? "active project" : `due ${formatDateTime(dueAt)}`,
    title: draft.title,
  };
}

function parseQuickContactInput(input: string): QuickContactDraft | null {
  const normalized = input.replace(
    /^\s*(?:contact:?|person:?|crm:?|new contact:?|联系人[:：]?|聯絡人[:：]?)\s*/i,
    "",
  ).trim();
  if (!normalized) return null;
  const [rawName, rawCompany] = normalized.split(/\s+@\s+/, 2);
  const displayName = normalizeCaptureTitle(rawName);
  if (!displayName) return null;
  const company = rawCompany ? normalizeCaptureTitle(rawCompany) || null : null;
  return {
    company,
    displayName,
    preview: company ? `at ${company}` : "new contact",
  };
}

function parseQuickEventInput(input: string): QuickEventDraft | null {
  const normalized = input.replace(
    /^\s*(?:event:?|calendar:?|cal:?|new event:?|日程[:：]?|事件[:：]?)\s*/i,
    "",
  ).trim();
  if (!normalized) return null;
  const draft = parseQuickTodoInput(`todo: ${normalized}`);
  if (!draft) return null;

  const startsAt = eventStartFromDraft(draft);
  const explicitEnd =
    draft.scheduledEndAt !== null && draft.scheduledEndAt > startsAt.getTime()
      ? new Date(draft.scheduledEndAt)
      : null;
  const endsAt =
    explicitEnd ??
    new Date(
      startsAt.getTime() + (draft.estimatedMinutes ?? 30) * 60_000,
    );
  return {
    endsAt,
    isAllDay: false,
    preview: formatDateTime(startsAt.getTime()),
    startsAt,
    title: draft.title,
  };
}

function eventStartFromDraft(
  draft: Pick<QuickTodoDraft, "dueAt" | "scheduledStartAt">,
): Date {
  if (draft.scheduledStartAt !== null) return new Date(draft.scheduledStartAt);
  if (draft.dueAt !== null) {
    const date = new Date(draft.dueAt);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9, 0, 0, 0);
  }
  return nextHalfHour(new Date());
}

function nextHalfHour(now: Date): Date {
  const out = new Date(now);
  out.setSeconds(0, 0);
  out.setMinutes(Math.ceil((out.getMinutes() + 1) / 30) * 30);
  return out;
}

function normalizeCaptureTitle(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function extractProjectToken(title: string): {
  query: string | null;
  title: string;
} {
  const match = title.match(/(?:^|\s)#([^\s#]+)/);
  if (!match) return { query: null, title };
  const nextTitle = normalizeCaptureTitle(title.replace(match[0], " "));
  return {
    query: match[1] ?? null,
    title: nextTitle || title,
  };
}

async function findProjectByToken(token: string): Promise<ProjectRow | null> {
  const normalized = normalizeSearchText(token);
  if (!normalized) return null;
  const rows = await projectsList();
  return (
    rows.find((project) => {
      const title = normalizeSearchText(project.title);
      return title === normalized || slugifySearchText(title) === normalized;
    }) ?? null
  );
}

async function ensureWorkspaceCalendar() {
  const calendars = await localCalendarListCalendars();
  return (
    calendars[0] ??
    localCalendarCreateCalendar({
      colorHex: "#d16a00",
      title: LOCAL_CALENDAR_SOURCE_TITLE,
    })
  );
}

function settledValue<T>(
  result: PromiseSettledResult<T>,
  fallback: T,
): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

function matchesSearchText(value: string | null | undefined, query: string): boolean {
  return normalizeSearchText(value ?? "").includes(query);
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function slugifySearchText(value: string): string {
  return value.replace(/\s+/g, "-");
}

function compactHint(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 54 ? `${normalized.slice(0, 52)}...` : normalized;
}

function todoSearchHint(todo: TodoRow): string {
  const timestamp = todo.scheduledStartAt ?? todo.dueAt;
  if (timestamp === null) return "Todo / Inbox";
  const kind = todo.scheduledStartAt === null ? "Due" : "Scheduled";
  return `Todo / ${kind} ${formatDateTime(timestamp)}`;
}

function projectSearchHint(project: ProjectRow): string {
  const status = project.status[0].toUpperCase() + project.status.slice(1);
  const due = project.dueAt === null ? "" : ` / due ${formatDate(project.dueAt)}`;
  return `Project / ${status}${due}`;
}

function eventSearchHint(event: LocalCalendarEventRow): string {
  const timestamp = Date.parse(event.startsAt);
  if (!Number.isFinite(timestamp)) return "Calendar event";
  if (event.isAllDay) return `Event / ${formatDate(timestamp)} all day`;
  return `Event / ${formatDateTime(timestamp)}`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${formatDate(timestamp)} ${date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}
