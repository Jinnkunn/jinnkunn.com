import type { TodoRow } from "../../modules/todos/api";
import { todoTimelineStart } from "../../modules/todos/time";

export function sortCalendarTodos(rows: readonly TodoRow[]): TodoRow[] {
  return [...rows].sort((a, b) => {
    const aDone = a.completedAt ? 1 : 0;
    const bDone = b.completedAt ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    const aTime = todoTimelineStart(a) ?? Number.MAX_SAFE_INTEGER;
    const bTime = todoTimelineStart(b) ?? Number.MAX_SAFE_INTEGER;
    if (aTime !== bTime) return aTime - bTime;
    return a.sortOrder - b.sortOrder;
  });
}

export function formatTodoOverlayError(error: unknown): string {
  const message = String(error);
  if (
    message.includes("invoke") ||
    message.includes("__TAURI_INTERNALS__") ||
    message.includes("is not a function")
  ) {
    return "Todo data is available in the desktop app.";
  }
  return message;
}

export function formatTodoPlanningMeta(todo: TodoRow): string {
  const start = todoTimelineStart(todo);
  const parts: string[] = [];
  if (todo.scheduledStartAt !== null && start !== null) {
    parts.push(`Scheduled ${formatShortDate(start)} ${formatClockTime(start)}`);
  } else if (todo.dueAt !== null) {
    parts.push(`Due ${formatShortDate(todo.dueAt)}`);
  } else {
    parts.push("No date");
  }
  if (todo.estimatedMinutes !== null) {
    parts.push(`${todo.estimatedMinutes}m`);
  }
  return parts.join(" / ");
}

function formatShortDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function formatClockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
