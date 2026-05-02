import { useEffect, useMemo, useState } from "react";
import { PanelRightOpen } from "lucide-react";

import {
  todosArchive,
  todosClearCompleted,
  todosCreate,
  todosList,
  todosUpdate,
  type TodoRow,
} from "../../modules/todos/api";
import {
  projectsList,
  type ProjectRow,
} from "../../modules/projects/api";
import { parseNoteTodoSource } from "../../modules/notes/todoLinks";
import type { NoteTodoSource } from "../../modules/notes/todoLinks";
import {
  todoTimelineStart,
} from "../../modules/todos/time";
import {
  TODO_SCHEDULE_PRESETS,
  addLocalDays,
  clearTodoPlanningUpdateParams,
  dateInputToTimestamp,
  dateInputValue,
  dateTimeInputToTimestamp,
  dateTimeInputValue,
  estimateInputToMinutes,
  scheduleEndTimestamp,
  startOfLocalDay,
  todoPresetUpdateParams,
  todoSchedulePresetLabel,
  type TodoSchedulePreset,
} from "../../modules/todos/planning";
import { useSurfaceNav } from "../../shell/surface-nav-context";
import { noteNavId } from "../notes/tree";
import { projectNavId } from "../projects/nav";
import {
  WorkspaceActionMenu,
  WorkspaceCommandBar,
  WorkspaceCommandButton,
  WorkspaceCommandGroup,
  WorkspaceEmptyState,
  WorkspaceIconButton,
  WorkspaceInlineStatus,
  WorkspaceInspector,
  WorkspaceInspectorHeader,
  WorkspaceInspectorSection,
  WorkspaceSplitView,
  WorkspaceSurfaceFrame,
} from "../../ui/primitives";
import {
  TODO_PLANNING_NAV_IDS,
  type TodoNavCounts,
  createTodosNavGroups,
  todoIdFromNavItem,
  todoNavId,
  TODOS_COMPLETED_NAV_ID,
  TODOS_DEFAULT_NAV_ITEM_ID,
  TODOS_FOCUS_NAV_GROUP_ID,
  TODOS_INBOX_NAV_ID,
  TODOS_REVIEW_NAV_GROUP_ID,
  TODOS_SCHEDULE_NAV_GROUP_ID,
  TODOS_SCHEDULED_NAV_ID,
  TODOS_TODAY_NAV_ID,
  TODOS_UNSCHEDULED_NAV_ID,
  TODOS_UPCOMING_NAV_ID,
} from "./nav";
import "../../styles/surfaces/todos.css";

const WORKSPACE_ENTITY_DRAG_TYPE = "application/x-workspace-entity";

type TodoFilter =
  | "completed"
  | "inbox"
  | "scheduled"
  | "today"
  | "unscheduled"
  | "upcoming";

function filterFromNavItem(id: string | null): TodoFilter {
  if (id === TODOS_COMPLETED_NAV_ID) return "completed";
  if (id === TODOS_INBOX_NAV_ID) return "inbox";
  if (id === TODOS_SCHEDULED_NAV_ID) return "scheduled";
  if (id === TODOS_UNSCHEDULED_NAV_ID) return "unscheduled";
  if (id === TODOS_UPCOMING_NAV_ID) return "upcoming";
  return "today";
}

function formatDueDate(timestamp: number | null): string {
  if (!timestamp) return "No due date";
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function todoPlanningTimestamp(todo: TodoRow): number | null {
  return todoTimelineStart(todo);
}

function filterTodo(todo: TodoRow, filter: TodoFilter, now = new Date()): boolean {
  if (todo.archivedAt !== null) return false;
  if (filter === "completed") return todo.completedAt !== null;
  if (todo.completedAt !== null) return false;

  const tomorrowStart = addLocalDays(startOfLocalDay(now), 1).getTime();
  const upcomingEnd = addLocalDays(startOfLocalDay(now), 15).getTime();
  const timestamp = todoPlanningTimestamp(todo);

  switch (filter) {
    case "inbox":
      return todo.scheduledStartAt === null && todo.dueAt === null;
    case "today":
      return timestamp !== null && timestamp < tomorrowStart;
    case "upcoming":
      return timestamp !== null && timestamp >= tomorrowStart && timestamp < upcomingEnd;
    case "scheduled":
      return todo.scheduledStartAt !== null;
    case "unscheduled":
      return todo.scheduledStartAt === null;
  }
}

function navItemForTodo(todo: TodoRow): string {
  if (todo.completedAt !== null) return TODOS_COMPLETED_NAV_ID;
  if (todo.scheduledStartAt === null && todo.dueAt === null) return TODOS_INBOX_NAV_ID;
  if (filterTodo(todo, "today")) return TODOS_TODAY_NAV_ID;
  if (filterTodo(todo, "upcoming")) return TODOS_UPCOMING_NAV_ID;
  if (todo.scheduledStartAt !== null) return TODOS_SCHEDULED_NAV_ID;
  return TODOS_UNSCHEDULED_NAV_ID;
}

function filterLabel(filter: TodoFilter): string {
  switch (filter) {
    case "completed":
      return "Done";
    case "inbox":
      return "Inbox";
    case "scheduled":
      return "Scheduled";
    case "today":
      return "Today";
    case "unscheduled":
      return "Unscheduled";
    case "upcoming":
      return "Upcoming";
  }
}

function emptyLabel(filter: TodoFilter): string {
  switch (filter) {
    case "completed":
      return "No completed todos";
    case "inbox":
      return "Inbox clear";
    case "scheduled":
      return "No scheduled todos";
    case "today":
      return "No todos";
    case "unscheduled":
      return "No unscheduled todos";
    case "upcoming":
      return "No upcoming todos";
  }
}

function isNativeBridgeUnavailable(error: unknown): boolean {
  const message = String(error);
  return (
    message.includes("invoke") ||
    message.includes("__TAURI_INTERNALS__") ||
    message.includes("is not a function")
  );
}

function formatTodosError(error: unknown): string {
  if (isNativeBridgeUnavailable(error)) {
    return "Todo data unavailable in this preview.";
  }
  return String(error);
}

function sortTodos(rows: readonly TodoRow[]): TodoRow[] {
  return [...rows].sort((a, b) => {
    const aDone = a.completedAt ? 1 : 0;
    const bDone = b.completedAt ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    if (!aDone) {
      const aTimeline = todoTimelineStart(a) ?? Number.MAX_SAFE_INTEGER;
      const bTimeline = todoTimelineStart(b) ?? Number.MAX_SAFE_INTEGER;
      if (aTimeline !== bTimeline) return aTimeline - bTimeline;
      return a.sortOrder - b.sortOrder;
    }
    return (b.completedAt ?? 0) - (a.completedAt ?? 0);
  });
}

export function TodosSurface() {
  const {
    activeNavItemId,
    selectWorkspaceNavItem,
    setActiveNavItemId,
    setNavGroupItems,
  } =
    useSurfaceNav();
  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [projectId, setProjectId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState("");
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [draftTitles, setDraftTitles] = useState<Record<string, string>>({});
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (
      !activeNavItemId ||
      (!TODO_PLANNING_NAV_IDS.has(activeNavItemId) &&
        !todoIdFromNavItem(activeNavItemId))
    ) {
      setActiveNavItemId(TODOS_DEFAULT_NAV_ITEM_ID);
    }
  }, [activeNavItemId, setActiveNavItemId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([todosList(), projectsList().catch(() => [])])
      .then(([rows, projectRows]) => {
        if (!cancelled) {
          setTodos(sortTodos(rows));
          setProjects(projectRows);
        }
      })
      .catch((error) => {
        if (!cancelled && !isNativeBridgeUnavailable(error)) {
          setMessage(`Failed to load todos: ${formatTodosError(error)}`);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filter = filterFromNavItem(activeNavItemId);
  const visibleTodos = useMemo(() => {
    return todos.filter((todo) => filterTodo(todo, filter));
  }, [filter, todos]);
  const selectedTodo = useMemo(
    () => todos.find((todo) => todo.id === selectedTodoId) ?? null,
    [selectedTodoId, todos],
  );
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const activeProjects = useMemo(
    () => projects.filter((project) => project.archivedAt === null),
    [projects],
  );

  useEffect(() => {
    const targetTodoId = todoIdFromNavItem(activeNavItemId);
    if (!targetTodoId) return;
    const target = todos.find((todo) => todo.id === targetTodoId);
    if (!target) return;
    setSelectedTodoId(target.id);
    setActiveNavItemId(navItemForTodo(target));
  }, [activeNavItemId, setActiveNavItemId, todos]);

  useEffect(() => {
    if (selectedTodo && !filterTodo(selectedTodo, filter)) {
      setSelectedTodoId(null);
    }
  }, [filter, selectedTodo]);

  useEffect(() => {
    if (!selectedTodoId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      setSelectedTodoId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedTodoId]);

  const activeCount = todos.filter((todo) => !todo.archivedAt && !todo.completedAt).length;
  const completedCount = todos.filter((todo) => !todo.archivedAt && todo.completedAt).length;
  const viewLabel = filterLabel(filter);
  const navCounts = useMemo<TodoNavCounts>(
    () => ({
      [TODOS_COMPLETED_NAV_ID]: todos.filter((todo) =>
        filterTodo(todo, "completed"),
      ).length,
      [TODOS_INBOX_NAV_ID]: todos.filter((todo) =>
        filterTodo(todo, "inbox"),
      ).length,
      [TODOS_SCHEDULED_NAV_ID]: todos.filter((todo) =>
        filterTodo(todo, "scheduled"),
      ).length,
      [TODOS_TODAY_NAV_ID]: todos.filter((todo) =>
        filterTodo(todo, "today"),
      ).length,
      [TODOS_UNSCHEDULED_NAV_ID]: todos.filter((todo) =>
        filterTodo(todo, "unscheduled"),
      ).length,
      [TODOS_UPCOMING_NAV_ID]: todos.filter((todo) =>
        filterTodo(todo, "upcoming"),
      ).length,
    }),
    [todos],
  );
  const navGroups = useMemo(
    () => createTodosNavGroups(navCounts),
    [navCounts],
  );

  useEffect(() => {
    for (const group of navGroups) {
      setNavGroupItems(group.id, group.items);
    }
    return () => {
      setNavGroupItems(TODOS_FOCUS_NAV_GROUP_ID, null);
      setNavGroupItems(TODOS_SCHEDULE_NAV_GROUP_ID, null);
      setNavGroupItems(TODOS_REVIEW_NAV_GROUP_ID, null);
    };
  }, [navGroups, setNavGroupItems]);

  const upsertTodo = (row: TodoRow) => {
    setTodos((current) => sortTodos([
      ...current.filter((todo) => todo.id !== row.id),
      row,
    ]));
  };

  const upsertTodoAndRoute = (row: TodoRow) => {
    upsertTodo(row);
    if (!filterTodo(row, filter)) {
      setActiveNavItemId(navItemForTodo(row));
    }
  };

  const createTodo = async () => {
    const normalized = title.trim();
    if (!normalized) return;
    setSaving(true);
    setMessage(null);
    try {
      const scheduledStartAt = dateTimeInputToTimestamp(scheduledAt);
      const estimate = estimateInputToMinutes(estimatedMinutes);
      const row = await todosCreate({
        dueAt: dateInputToTimestamp(dueDate),
        estimatedMinutes: estimate,
        projectId: projectId || null,
        scheduledEndAt: scheduleEndTimestamp(scheduledStartAt, estimate),
        scheduledStartAt,
        title: normalized,
      });
      setTitle("");
      setDueDate("");
      setProjectId("");
      setScheduledAt("");
      setEstimatedMinutes("");
      upsertTodoAndRoute(row);
    } catch (error) {
      setMessage(`Failed to create todo: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleCompleted = async (todo: TodoRow) => {
    const optimistic = {
      ...todo,
      completedAt: todo.completedAt ? null : Date.now(),
      updatedAt: Date.now(),
    };
    upsertTodo(optimistic);
    try {
      const row = await todosUpdate({
        completed: !todo.completedAt,
        id: todo.id,
      });
      upsertTodo(row);
    } catch (error) {
      upsertTodo(todo);
      setMessage(`Failed to update todo: ${String(error)}`);
    }
  };

  const commitTitle = async (todo: TodoRow) => {
    const next = (draftTitles[todo.id] ?? todo.title).trim();
    setDraftTitles((current) => {
      const copy = { ...current };
      delete copy[todo.id];
      return copy;
    });
    if (!next || next === todo.title) return;
    try {
      const row = await todosUpdate({ id: todo.id, title: next });
      upsertTodo(row);
    } catch (error) {
      setMessage(`Failed to rename todo: ${String(error)}`);
    }
  };

  const updateDueDate = async (todo: TodoRow, value: string) => {
    try {
      const row = await todosUpdate({
        dueAt: dateInputToTimestamp(value),
        id: todo.id,
      });
      upsertTodoAndRoute(row);
    } catch (error) {
      setMessage(`Failed to update due date: ${String(error)}`);
    }
  };

  const updateSchedule = async (todo: TodoRow, value: string) => {
    const scheduledStartAt = dateTimeInputToTimestamp(value);
    try {
      const row = await todosUpdate({
        id: todo.id,
        scheduledEndAt: scheduleEndTimestamp(
          scheduledStartAt,
          todo.estimatedMinutes,
        ),
        scheduledStartAt,
      });
      upsertTodoAndRoute(row);
    } catch (error) {
      setMessage(`Failed to update schedule: ${String(error)}`);
    }
  };

  const updateEstimate = async (todo: TodoRow, value: string) => {
    const estimate = estimateInputToMinutes(value);
    try {
      const row = await todosUpdate({
        estimatedMinutes: estimate,
        id: todo.id,
        scheduledEndAt: scheduleEndTimestamp(todo.scheduledStartAt, estimate),
      });
      upsertTodo(row);
    } catch (error) {
      setMessage(`Failed to update estimate: ${String(error)}`);
    }
  };

  const updateProject = async (todo: TodoRow, value: string) => {
    try {
      const row = await todosUpdate({
        id: todo.id,
        projectId: value || null,
      });
      upsertTodo(row);
    } catch (error) {
      setMessage(`Failed to update project: ${String(error)}`);
    }
  };

  const updateNotes = async (todo: TodoRow, value: string) => {
    if (value === todo.notes) return;
    try {
      const row = await todosUpdate({
        id: todo.id,
        notes: value,
      });
      upsertTodo(row);
    } catch (error) {
      setMessage(`Failed to update notes: ${String(error)}`);
    }
  };

  const applySchedulePreset = async (
    todo: TodoRow,
    preset: TodoSchedulePreset,
  ) => {
    try {
      const row = await todosUpdate({
        id: todo.id,
        ...todoPresetUpdateParams(preset),
      });
      upsertTodoAndRoute(row);
    } catch (error) {
      setMessage(`Failed to schedule todo: ${String(error)}`);
    }
  };

  const clearPlanning = async (todo: TodoRow) => {
    try {
      const row = await todosUpdate({
        id: todo.id,
        ...clearTodoPlanningUpdateParams(),
      });
      upsertTodoAndRoute(row);
    } catch (error) {
      setMessage(`Failed to clear schedule: ${String(error)}`);
    }
  };

  const archiveTodo = async (todo: TodoRow) => {
    setTodos((current) => current.filter((row) => row.id !== todo.id));
    if (selectedTodoId === todo.id) setSelectedTodoId(null);
    try {
      await todosArchive(todo.id);
    } catch (error) {
      upsertTodo(todo);
      setMessage(`Failed to archive todo: ${String(error)}`);
    }
  };

  const clearCompleted = async () => {
    const completed = todos.filter((todo) => todo.completedAt);
    if (!completed.length) return;
    setTodos((current) => current.filter((todo) => !todo.completedAt));
    try {
      await todosClearCompleted();
    } catch (error) {
      setTodos(sortTodos([...todos]));
      setMessage(`Failed to clear completed todos: ${String(error)}`);
    }
  };
  const hasPlanningDraft = Boolean(dueDate || scheduledAt || estimatedMinutes || projectId);

  return (
    <WorkspaceSurfaceFrame className="todos-surface">
      <WorkspaceCommandBar
        className="todos-commandbar"
        leading={
          <form
            className="todos-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void createTodo();
            }}
          >
            <div className="todos-composer__main">
              <input
                aria-label="Todo title"
                autoComplete="off"
                name="todo-title"
                placeholder="New todo…"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <WorkspaceCommandButton
                disabled={saving || !title.trim()}
                tone="accent"
                type="submit"
              >
                Add
              </WorkspaceCommandButton>
            </div>
            <WorkspaceActionMenu
              className="todos-composer__planning"
              label={hasPlanningDraft ? "Planned" : "Plan"}
            >
              <div className="todos-composer__planning-grid">
                <label className="workspace-action-menu__field">
                  <span>Due</span>
                  <input
                    aria-label="Due date"
                    name="todo-due-date"
                    type="date"
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                  />
                </label>
                <label className="workspace-action-menu__field">
                  <span>Scheduled</span>
                  <input
                    aria-label="Scheduled time"
                    name="todo-scheduled-time"
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(event) => {
                      setScheduledAt(event.target.value);
                      if (event.target.value && !estimatedMinutes) {
                        setEstimatedMinutes("30");
                      }
                    }}
                  />
                </label>
                <label className="workspace-action-menu__field">
                  <span>Estimate</span>
                  <input
                    aria-label="Estimate minutes"
                    min="1"
                    max="1440"
                    name="todo-estimate-minutes"
                    placeholder="30"
                    type="number"
                    value={estimatedMinutes}
                    onChange={(event) => setEstimatedMinutes(event.target.value)}
                  />
                </label>
                {activeProjects.length ? (
                  <label className="workspace-action-menu__field">
                    <span>Project</span>
                    <select
                      aria-label="Project"
                      value={projectId}
                      onChange={(event) => setProjectId(event.currentTarget.value)}
                    >
                      <option value="">No project</option>
                      {activeProjects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.title}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {hasPlanningDraft ? (
                  <button
                    type="button"
                    className="todos-composer__planning-clear"
                    onClick={() => {
                      setDueDate("");
                      setProjectId("");
                      setScheduledAt("");
                      setEstimatedMinutes("");
                    }}
                  >
                    Clear Plan
                  </button>
                ) : null}
              </div>
            </WorkspaceActionMenu>
          </form>
        }
        trailing={
          <WorkspaceCommandGroup align="end" className="todos-commandbar__meta">
            <span
              className="todos-counts"
              title={`${activeCount} open / ${completedCount} done`}
            >
              {viewLabel} · {visibleTodos.length}
            </span>
            <WorkspaceCommandButton
              disabled={completedCount === 0}
              onClick={() => void clearCompleted()}
              tone="ghost"
            >
              Clear done
            </WorkspaceCommandButton>
          </WorkspaceCommandGroup>
        }
      />

      {message ? (
        <WorkspaceInlineStatus
          className="todos-message"
          role="status"
          tone={message.startsWith("Failed") ? "error" : "success"}
        >
          {message}
        </WorkspaceInlineStatus>
      ) : null}

      <WorkspaceSplitView
        className="todos-split-view"
        inspector={
          selectedTodo ? (
            <TodoDetailInspector
              noteSource={parseNoteTodoSource(selectedTodo.notes)}
              project={selectedTodo.projectId ? projectById.get(selectedTodo.projectId) : null}
              todo={selectedTodo}
              onArchive={() => void archiveTodo(selectedTodo)}
              onClear={() => void clearPlanning(selectedTodo)}
              onClose={() => setSelectedTodoId(null)}
              onDueDateChange={(value) => void updateDueDate(selectedTodo, value)}
              onEstimateChange={(value) => void updateEstimate(selectedTodo, value)}
              onNotesChange={(value) => void updateNotes(selectedTodo, value)}
              onOpenNote={(noteId) => selectWorkspaceNavItem("notes", noteNavId(noteId))}
              onOpenProject={(projectId) => selectWorkspaceNavItem("projects", projectNavId(projectId))}
              onPreset={(preset) => void applySchedulePreset(selectedTodo, preset)}
              onProjectChange={(value) => void updateProject(selectedTodo, value)}
              onScheduleChange={(value) => void updateSchedule(selectedTodo, value)}
              onToggle={() => void toggleCompleted(selectedTodo)}
              projects={projects}
            />
          ) : null
        }
      >
        <section className="todos-list-shell" aria-busy={loading ? "true" : undefined}>
          {loading ? (
            <WorkspaceEmptyState className="todos-empty" title="Loading todos" />
          ) : visibleTodos.length === 0 ? (
            <WorkspaceEmptyState className="todos-empty" title={emptyLabel(filter)} />
          ) : (
            <ul className="todos-list" role="list">
              {visibleTodos.map((todo) => {
                const completed = Boolean(todo.completedAt);
                const noteSource = parseNoteTodoSource(todo.notes);
                const project = todo.projectId ? projectById.get(todo.projectId) : null;
                const projectLabel = project
                  ? `${project.title}${project.archivedAt ? " (Archived)" : ""}`
                  : null;
                const timeline = todoTimelineStart(todo);
                return (
                  <li
                    className="todos-row"
                    data-completed={completed ? "true" : undefined}
                    data-selected={selectedTodoId === todo.id ? "true" : undefined}
                    draggable
                    key={todo.id}
                    onDragStart={(event) => {
                      const itemId = todoNavId(todo.id);
                      event.dataTransfer.setData(WORKSPACE_ENTITY_DRAG_TYPE, itemId);
                      event.dataTransfer.setData("text/plain", itemId);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={(event) => {
                      const target = event.target as HTMLElement | null;
                      if (target?.closest("button, input, a, select, textarea")) return;
                      setSelectedTodoId(todo.id);
                    }}
                  >
                    <button
                      type="button"
                      className="todos-row__check"
                      aria-label={completed ? "Mark open" : "Mark done"}
                      aria-pressed={completed}
                      onClick={() => void toggleCompleted(todo)}
                    >
                      <span aria-hidden="true" />
                    </button>
                    <div className="todos-row__body">
                      <input
                        aria-label="Todo title"
                        className="todos-row__title"
                        value={draftTitles[todo.id] ?? todo.title}
                        onFocus={() => setSelectedTodoId(todo.id)}
                        onBlur={() => void commitTitle(todo)}
                        onChange={(event) =>
                          setDraftTitles((current) => ({
                            ...current,
                            [todo.id]: event.target.value,
                          }))
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                          if (event.key === "Escape") {
                            setDraftTitles((current) => {
                              const copy = { ...current };
                              delete copy[todo.id];
                              return copy;
                            });
                            event.currentTarget.blur();
                          }
                        }}
                      />
                      <div className="todos-row__chips">
                        <span className="todos-row__chip">
                          {timeline === null ? "Unscheduled" : formatDueDate(timeline)}
                        </span>
                        {todo.scheduledStartAt !== null ? (
                          <span className="todos-row__chip">
                            {formatTime(todo.scheduledStartAt)}
                          </span>
                        ) : null}
                        {todo.estimatedMinutes !== null ? (
                          <span className="todos-row__chip">
                            {todo.estimatedMinutes}m
                          </span>
                        ) : null}
                        {project ? (
                          <button
                            type="button"
                            className="todos-row__source"
                            data-archived={project.archivedAt ? "true" : undefined}
                            onClick={() =>
                              selectWorkspaceNavItem("projects", projectNavId(project.id))
                            }
                          >
                            {projectLabel}
                          </button>
                        ) : null}
                        {noteSource ? (
                          <button
                            type="button"
                            className="todos-row__source"
                            onClick={() =>
                              selectWorkspaceNavItem("notes", noteNavId(noteSource.id))
                            }
                          >
                            {noteSource.title}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <WorkspaceIconButton
                      className="todos-row__details"
                      aria-label={
                        selectedTodoId === todo.id
                          ? "Close todo details"
                          : "Open todo details"
                      }
                      aria-pressed={selectedTodoId === todo.id}
                      onClick={() =>
                        setSelectedTodoId((current) =>
                          current === todo.id ? null : todo.id,
                        )
                      }
                    >
                      <PanelRightOpen
                        absoluteStrokeWidth
                        aria-hidden="true"
                        size={14}
                        strokeWidth={1.8}
                      />
                    </WorkspaceIconButton>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </WorkspaceSplitView>
    </WorkspaceSurfaceFrame>
  );
}

function TodoDetailInspector({
  noteSource,
  onArchive,
  onClear,
  onClose,
  onDueDateChange,
  onEstimateChange,
  onNotesChange,
  onOpenNote,
  onOpenProject,
  onPreset,
  onProjectChange,
  onScheduleChange,
  onToggle,
  project,
  projects,
  todo,
}: {
  noteSource: NoteTodoSource | null;
  onArchive: () => void;
  onClear: () => void;
  onClose: () => void;
  onDueDateChange: (value: string) => void;
  onEstimateChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onOpenNote: (noteId: string) => void;
  onOpenProject: (projectId: string) => void;
  onPreset: (preset: TodoSchedulePreset) => void;
  onProjectChange: (value: string) => void;
  onScheduleChange: (value: string) => void;
  onToggle: () => void;
  project: ProjectRow | null | undefined;
  projects: readonly ProjectRow[];
  todo: TodoRow;
}) {
  const completed = todo.completedAt !== null;

  return (
    <WorkspaceInspector className="todos-detail-panel" label="Todo details">
      <WorkspaceInspectorHeader
        heading={todo.title}
        kicker={completed ? "Done" : "Todo"}
        actions={
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        }
      />
      <WorkspaceInspectorSection>
        <button
          type="button"
          className="todos-detail-panel__complete"
          aria-pressed={completed}
          onClick={onToggle}
        >
          {completed ? "Reopen" : "Done"}
        </button>
      </WorkspaceInspectorSection>
      <WorkspaceInspectorSection heading="Plan">
        <div className="todos-detail-panel__quick">
          {TODO_SCHEDULE_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset}
              onClick={() => onPreset(preset)}
            >
              {todoSchedulePresetLabel(preset)}
            </button>
          ))}
          <button type="button" onClick={onClear}>
            Clear
          </button>
        </div>
        <label className="todos-detail-panel__field">
          <span>Due</span>
          <input
            type="date"
            value={dateInputValue(todo.dueAt)}
            onChange={(event) => onDueDateChange(event.currentTarget.value)}
          />
        </label>
        <label className="todos-detail-panel__field">
          <span>Scheduled</span>
          <input
            type="datetime-local"
            value={dateTimeInputValue(todo.scheduledStartAt)}
            onChange={(event) => onScheduleChange(event.currentTarget.value)}
          />
        </label>
        <label className="todos-detail-panel__field">
          <span>Estimate</span>
          <input
            min="1"
            max="1440"
            type="number"
            value={todo.estimatedMinutes ?? ""}
            onChange={(event) => onEstimateChange(event.currentTarget.value)}
          />
        </label>
        {projects.length ? (
          <label className="todos-detail-panel__field">
            <span>Project</span>
            <select
              value={todo.projectId ?? ""}
              onChange={(event) => onProjectChange(event.currentTarget.value)}
            >
              <option value="">No project</option>
              {projects.map((project) => (
                <option
                  disabled={project.archivedAt !== null}
                  key={project.id}
                  value={project.id}
                >
                  {project.title}
                  {project.archivedAt ? " (Archived)" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </WorkspaceInspectorSection>
      <WorkspaceInspectorSection heading="Context">
        {project ? (
          <button
            type="button"
            className="todos-detail-panel__link"
            onClick={() => onOpenProject(project.id)}
          >
            <strong>{project.title}</strong>
            <span>Project</span>
          </button>
        ) : null}
        {noteSource ? (
          <button
            type="button"
            className="todos-detail-panel__link"
            onClick={() => onOpenNote(noteSource.id)}
          >
            <strong>{noteSource.title}</strong>
            <span>Source note</span>
          </button>
        ) : null}
        <label className="todos-detail-panel__field">
          <span>Notes</span>
          <textarea
            key={`${todo.id}:notes`}
            rows={4}
            defaultValue={todo.notes}
            onBlur={(event) => onNotesChange(event.currentTarget.value)}
          />
        </label>
      </WorkspaceInspectorSection>
      <WorkspaceInspectorSection heading="Actions">
        <button
          type="button"
          className="todos-detail-panel__archive"
          onClick={onArchive}
        >
          Archive
        </button>
      </WorkspaceInspectorSection>
    </WorkspaceInspector>
  );
}
