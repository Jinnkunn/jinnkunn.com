import { useEffect, useMemo, useState } from "react";

import {
  todosArchive,
  todosClearCompleted,
  todosCreate,
  todosList,
  todosUpdate,
  type TodoRow,
} from "../../modules/todos/api";
import { useSurfaceNav } from "../../shell/surface-nav-context";
import {
  WorkspaceCommandBar,
  WorkspaceCommandButton,
  WorkspaceCommandGroup,
  WorkspaceSurfaceFrame,
} from "../../ui/primitives";
import {
  TODOS_ACTIVE_NAV_ID,
  TODOS_ALL_NAV_ID,
  TODOS_COMPLETED_NAV_ID,
  TODOS_DEFAULT_NAV_ITEM_ID,
} from "./nav";

type TodoFilter = "active" | "all" | "completed";

function filterFromNavItem(id: string | null): TodoFilter {
  if (id === TODOS_ALL_NAV_ID) return "all";
  if (id === TODOS_COMPLETED_NAV_ID) return "completed";
  return "active";
}

function dateInputValue(timestamp: number | null): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateInputToTimestamp(value: string): number | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 12, 0, 0, 0).getTime();
}

function formatDueDate(timestamp: number | null): string {
  if (!timestamp) return "No due date";
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function sortTodos(rows: readonly TodoRow[]): TodoRow[] {
  return [...rows].sort((a, b) => {
    const aDone = a.completedAt ? 1 : 0;
    const bDone = b.completedAt ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    if (!aDone) {
      const aDue = a.dueAt ?? Number.MAX_SAFE_INTEGER;
      const bDue = b.dueAt ?? Number.MAX_SAFE_INTEGER;
      if (aDue !== bDue) return aDue - bDue;
      return a.sortOrder - b.sortOrder;
    }
    return (b.completedAt ?? 0) - (a.completedAt ?? 0);
  });
}

export function TodosSurface() {
  const { activeNavItemId, setActiveNavItemId } = useSurfaceNav();
  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [draftTitles, setDraftTitles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!activeNavItemId) setActiveNavItemId(TODOS_DEFAULT_NAV_ITEM_ID);
  }, [activeNavItemId, setActiveNavItemId]);

  useEffect(() => {
    let cancelled = false;
    todosList()
      .then((rows) => {
        if (!cancelled) setTodos(sortTodos(rows));
      })
      .catch((error) => {
        if (!cancelled) setMessage(`Failed to load todos: ${String(error)}`);
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
    const activeRows = todos.filter((todo) => !todo.archivedAt);
    if (filter === "all") return activeRows;
    if (filter === "completed") {
      return activeRows.filter((todo) => todo.completedAt);
    }
    return activeRows.filter((todo) => !todo.completedAt);
  }, [filter, todos]);

  const activeCount = todos.filter((todo) => !todo.archivedAt && !todo.completedAt).length;
  const completedCount = todos.filter((todo) => !todo.archivedAt && todo.completedAt).length;

  const upsertTodo = (row: TodoRow) => {
    setTodos((current) => sortTodos([
      ...current.filter((todo) => todo.id !== row.id),
      row,
    ]));
  };

  const createTodo = async () => {
    const normalized = title.trim();
    if (!normalized) return;
    setSaving(true);
    setMessage(null);
    try {
      const row = await todosCreate({
        dueAt: dateInputToTimestamp(dueDate),
        title: normalized,
      });
      upsertTodo(row);
      setTitle("");
      setDueDate("");
      if (filter === "completed") setActiveNavItemId(TODOS_ACTIVE_NAV_ID);
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
      upsertTodo(row);
    } catch (error) {
      setMessage(`Failed to update due date: ${String(error)}`);
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
          <WorkspaceCommandGroup align="end">
            <span className="todos-counts">
              {activeCount} open / {completedCount} done
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
            {filter === "completed" ? "No completed todos." : "No todos."}
          </div>
        ) : (
          <ul className="todos-list" role="list">
            {visibleTodos.map((todo) => {
              const completed = Boolean(todo.completedAt);
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
                      {formatDueDate(todo.dueAt)}
                    </span>
                  </div>
                  <input
                    aria-label="Due date"
                    className="todos-row__date"
                    type="date"
                    value={dateInputValue(todo.dueAt)}
                    onChange={(event) => void updateDueDate(todo, event.target.value)}
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
