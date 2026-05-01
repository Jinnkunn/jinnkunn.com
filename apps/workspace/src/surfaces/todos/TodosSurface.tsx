import { useEffect, useMemo, useState } from "react";

import {
  todosArchive,
  todosClearCompleted,
  todosCreate,
  todosList,
  todosUpdate,
  type TodoRow,
} from "../../modules/todos/api";
import { parseNoteTodoSource } from "../../modules/notes/todoLinks";
import {
  todoTimelineKind,
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
import {
  WorkspaceCommandBar,
  WorkspaceCommandButton,
  WorkspaceCommandGroup,
  WorkspaceSurfaceFrame,
} from "../../ui/primitives";
import {
  TODO_PLANNING_NAV_IDS,
  TODOS_COMPLETED_NAV_ID,
  TODOS_DEFAULT_NAV_ITEM_ID,
  TODOS_INBOX_NAV_ID,
  TODOS_SCHEDULED_NAV_ID,
  TODOS_TODAY_NAV_ID,
  TODOS_UNSCHEDULED_NAV_ID,
  TODOS_UPCOMING_NAV_ID,
} from "./nav";

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

function formatTodoMeta(todo: TodoRow): string {
  const parts: string[] = [];
  const timelineStart = todoTimelineStart(todo);
  if (timelineStart !== null && todoTimelineKind(todo) === "scheduled") {
    parts.push(`Scheduled ${formatTime(timelineStart)}`);
  } else if (todo.dueAt !== null) {
    parts.push(`Due ${formatDueDate(todo.dueAt)}`);
  } else {
    parts.push("Unscheduled");
  }
  if (todo.estimatedMinutes !== null) {
    parts.push(`${todo.estimatedMinutes}m`);
  }
  if (todo.scheduledStartAt !== null && todo.dueAt !== null) {
    parts.push(`due ${formatDueDate(todo.dueAt)}`);
  }
  return parts.join(" / ");
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
      return "No completed todos.";
    case "inbox":
      return "Inbox is clear.";
    case "scheduled":
      return "No scheduled todos.";
    case "today":
      return "No todos for today.";
    case "unscheduled":
      return "No unscheduled todos.";
    case "upcoming":
      return "No upcoming todos.";
  }
}

function formatTodosError(error: unknown): string {
  const message = String(error);
  if (
    message.includes("invoke") ||
    message.includes("__TAURI_INTERNALS__") ||
    message.includes("is not a function")
  ) {
    return "Todo data is available in the desktop app.";
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

function TodoQuickScheduleActions({
  todo,
  onClear,
  onPreset,
}: {
  todo: TodoRow;
  onClear: (todo: TodoRow) => Promise<void>;
  onPreset: (todo: TodoRow, preset: TodoSchedulePreset) => Promise<void>;
}) {
  const plannedDate = dateInputValue(todoTimelineStart(todo));
  return (
    <div className="todos-row__quick" aria-label="Quick schedule">
      {TODO_SCHEDULE_PRESETS.map((preset) => {
        const presetDate = dateInputValue(todoPresetUpdateParams(preset).dueAt);
        return (
          <button
            type="button"
            key={preset}
            className="todos-row__quick-button"
            data-active={plannedDate === presetDate ? "true" : undefined}
            onClick={() => void onPreset(todo, preset)}
          >
            {todoSchedulePresetLabel(preset)}
          </button>
        );
      })}
      <button
        type="button"
        className="todos-row__quick-button"
        disabled={todo.scheduledStartAt === null && todo.dueAt === null}
        onClick={() => void onClear(todo)}
      >
        Clear
      </button>
    </div>
  );
}

export function TodosSurface() {
  const { activeNavItemId, selectWorkspaceNavItem, setActiveNavItemId } =
    useSurfaceNav();
  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState("");
  const [draftTitles, setDraftTitles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!activeNavItemId || !TODO_PLANNING_NAV_IDS.has(activeNavItemId)) {
      setActiveNavItemId(TODOS_DEFAULT_NAV_ITEM_ID);
    }
  }, [activeNavItemId, setActiveNavItemId]);

  useEffect(() => {
    let cancelled = false;
    todosList()
      .then((rows) => {
        if (!cancelled) setTodos(sortTodos(rows));
      })
      .catch((error) => {
        if (!cancelled) setMessage(`Failed to load todos: ${formatTodosError(error)}`);
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

  const activeCount = todos.filter((todo) => !todo.archivedAt && !todo.completedAt).length;
  const completedCount = todos.filter((todo) => !todo.archivedAt && todo.completedAt).length;
  const viewLabel = filterLabel(filter);

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
        scheduledEndAt: scheduleEndTimestamp(scheduledStartAt, estimate),
        scheduledStartAt,
        title: normalized,
      });
      setTitle("");
      setDueDate("");
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
            <input
              aria-label="Todo title"
              placeholder="New todo"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <input
              aria-label="Due date"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
            <input
              aria-label="Scheduled time"
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => {
                setScheduledAt(event.target.value);
                if (event.target.value && !estimatedMinutes) {
                  setEstimatedMinutes("30");
                }
              }}
            />
            <input
              aria-label="Estimate minutes"
              min="1"
              max="1440"
              placeholder="30m"
              type="number"
              value={estimatedMinutes}
              onChange={(event) => setEstimatedMinutes(event.target.value)}
            />
            <WorkspaceCommandButton
              disabled={saving || !title.trim()}
              tone="accent"
              type="submit"
            >
              Add
            </WorkspaceCommandButton>
          </form>
        }
        trailing={
          <WorkspaceCommandGroup align="end" className="todos-commandbar__meta">
            <span className="todos-counts">
              {viewLabel}: {visibleTodos.length} / {activeCount} open / {completedCount} done
            </span>
            <WorkspaceCommandButton
              disabled={completedCount === 0}
              onClick={() => void clearCompleted()}
              tone="ghost"
            >
              Clear Done
            </WorkspaceCommandButton>
          </WorkspaceCommandGroup>
        }
      />

      {message ? (
        <div className="todos-message" role="status">
          {message}
        </div>
      ) : null}

      <section className="todos-list-shell" aria-busy={loading ? "true" : undefined}>
        {loading ? (
          <div className="todos-empty">Loading todos...</div>
        ) : visibleTodos.length === 0 ? (
          <div className="todos-empty">
            {emptyLabel(filter)}
          </div>
        ) : (
          <ul className="todos-list" role="list">
            {visibleTodos.map((todo) => {
              const completed = Boolean(todo.completedAt);
              const noteSource = parseNoteTodoSource(todo.notes);
              return (
                <li
                  className="todos-row"
                  data-completed={completed ? "true" : undefined}
                  key={todo.id}
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
                    <span className="todos-row__meta">
                      {formatTodoMeta(todo)}
                    </span>
                    {noteSource ? (
                      <button
                        type="button"
                        className="todos-row__source"
                        onClick={() =>
                          selectWorkspaceNavItem("notes", noteNavId(noteSource.id))
                        }
                      >
                        From {noteSource.title}
                      </button>
                    ) : null}
                    <TodoQuickScheduleActions
                      todo={todo}
                      onClear={clearPlanning}
                      onPreset={applySchedulePreset}
                    />
                  </div>
                  <input
                    aria-label="Due date"
                    className="todos-row__date"
                    type="date"
                    value={dateInputValue(todo.dueAt)}
                    onChange={(event) => void updateDueDate(todo, event.target.value)}
                  />
                  <input
                    aria-label="Scheduled time"
                    className="todos-row__schedule"
                    type="datetime-local"
                    value={dateTimeInputValue(todo.scheduledStartAt)}
                    onChange={(event) => void updateSchedule(todo, event.target.value)}
                  />
                  <input
                    aria-label="Estimate minutes"
                    className="todos-row__estimate"
                    min="1"
                    max="1440"
                    type="number"
                    value={todo.estimatedMinutes ?? ""}
                    onChange={(event) => void updateEstimate(todo, event.target.value)}
                  />
                  <button
                    type="button"
                    className="todos-row__archive"
                    onClick={() => void archiveTodo(todo)}
                  >
                    Archive
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </WorkspaceSurfaceFrame>
  );
}
