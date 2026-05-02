import type { TodoRow } from "../todos/api";
import type { ProjectRow, ProjectStatus } from "./api";

export type ProjectsFilter = "active" | "archived" | "completed" | "paused";

const DAY_MS = 86_400_000;

export interface ProjectTodoStats {
  completedCount: number;
  nextTodo: TodoRow | null;
  openCount: number;
  totalCount: number;
}

export interface ProjectAttentionItem {
  project: ProjectRow;
  reason: "dueSoon" | "inactive" | "noNextAction";
}

export function todoProjectId(todo: TodoRow): string | null {
  return todo.projectId ?? null;
}

export function todoTimeline(todo: TodoRow): number | null {
  return todo.scheduledStartAt ?? todo.dueAt ?? null;
}

export function sortProjectTodos(todos: readonly TodoRow[]): TodoRow[] {
  return [...todos].sort((a, b) => {
    const aDone = a.completedAt ? 1 : 0;
    const bDone = b.completedAt ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    const aTime = todoTimeline(a) ?? Number.MAX_SAFE_INTEGER;
    const bTime = todoTimeline(b) ?? Number.MAX_SAFE_INTEGER;
    if (aTime !== bTime) return aTime - bTime;
    return a.sortOrder - b.sortOrder;
  });
}

export function todosForProject(
  todos: readonly TodoRow[],
  projectId: string,
): TodoRow[] {
  return sortProjectTodos(
    todos.filter((todo) => todoProjectId(todo) === projectId),
  );
}

export function projectTodoStats(
  project: ProjectRow,
  todos: readonly TodoRow[] = [],
): ProjectTodoStats {
  if (todos.length === 0) {
    return {
      completedCount: Math.max(0, project.totalTodoCount - project.openTodoCount),
      nextTodo: null,
      openCount: project.openTodoCount,
      totalCount: project.totalTodoCount,
    };
  }
  const projectTodos = todosForProject(todos, project.id);
  const openTodos = projectTodos.filter((todo) => todo.completedAt === null);
  return {
    completedCount: projectTodos.length - openTodos.length,
    nextTodo: openTodos[0] ?? null,
    openCount: openTodos.length,
    totalCount: projectTodos.length,
  };
}

export function sortProjects(rows: readonly ProjectRow[]): ProjectRow[] {
  return [...rows].sort((a, b) => {
    const aArchived = a.archivedAt ? 1 : 0;
    const bArchived = b.archivedAt ? 1 : 0;
    if (aArchived !== bArchived) return aArchived - bArchived;
    const aPinned = a.pinnedAt ? 0 : 1;
    const bPinned = b.pinnedAt ? 0 : 1;
    if (aPinned !== bPinned) return aPinned - bPinned;
    if ((b.pinnedAt ?? 0) !== (a.pinnedAt ?? 0)) {
      return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0);
    }
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return b.updatedAt - a.updatedAt;
  });
}

export function filterProjects(
  projects: readonly ProjectRow[],
  filter: ProjectsFilter,
): ProjectRow[] {
  return sortProjects(
    projects.filter((project) => {
      if (filter === "archived") return project.archivedAt !== null;
      if (project.archivedAt !== null) return false;
      return project.status === filter;
    }),
  );
}

export function projectsByStatusCount(
  projects: readonly ProjectRow[],
  status: ProjectStatus,
): number {
  return projects.filter(
    (project) => project.archivedAt === null && project.status === status,
  ).length;
}

export function projectsDueSoon(
  projects: readonly ProjectRow[],
  now = Date.now(),
  daysAhead = 14,
): ProjectRow[] {
  const end = now + daysAhead * DAY_MS;
  return sortProjects(
    projects.filter(
      (project) =>
        project.archivedAt === null &&
        project.status !== "completed" &&
        project.dueAt !== null &&
        project.dueAt <= end,
    ),
  ).sort((a, b) => (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER));
}

export function recentProjects(
  projects: readonly ProjectRow[],
  limit = 5,
): ProjectRow[] {
  return [...projects]
    .filter((project) => project.archivedAt === null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

export function projectsNeedingAttention(
  projects: readonly ProjectRow[],
  todos: readonly TodoRow[] = [],
  now = Date.now(),
): ProjectAttentionItem[] {
  const dueSoonEnd = now + 7 * DAY_MS;
  const inactiveCutoff = now - 14 * DAY_MS;
  const out: ProjectAttentionItem[] = [];

  for (const project of projects) {
    if (project.archivedAt !== null || project.status !== "active") continue;
    const stats = projectTodoStats(project, todos);
    if (stats.openCount === 0) {
      out.push({ project, reason: "noNextAction" });
      continue;
    }
    if (project.dueAt !== null && project.dueAt <= dueSoonEnd) {
      out.push({ project, reason: "dueSoon" });
      continue;
    }
    if (project.updatedAt <= inactiveCutoff) {
      out.push({ project, reason: "inactive" });
    }
  }

  return out.slice(0, 6);
}
