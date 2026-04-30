import type { TodoRow } from "./api";

export type TodoTimelineKind = "scheduled" | "due" | "none";

export function todoTimelineKind(todo: TodoRow): TodoTimelineKind {
  if (todo.scheduledStartAt !== null) return "scheduled";
  if (todo.dueAt !== null) return "due";
  return "none";
}

export function todoTimelineStart(todo: TodoRow): number | null {
  return todo.scheduledStartAt ?? todo.dueAt;
}

export function todoTimelineEnd(todo: TodoRow): number | null {
  if (todo.scheduledStartAt === null) return null;
  if (
    todo.scheduledEndAt !== null &&
    todo.scheduledEndAt > todo.scheduledStartAt
  ) {
    return todo.scheduledEndAt;
  }
  if (todo.estimatedMinutes !== null && todo.estimatedMinutes > 0) {
    return todo.scheduledStartAt + todo.estimatedMinutes * 60_000;
  }
  return null;
}
