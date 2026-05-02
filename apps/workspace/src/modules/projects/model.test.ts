import { describe, expect, it } from "vitest";

import type { TodoRow } from "../todos/api";
import type { ProjectRow, ProjectStatus } from "./api";
import {
  filterProjects,
  projectTodoStats,
  projectsDueSoon,
  projectsNeedingAttention,
  todosForProject,
} from "./model";

const NOW = new Date("2026-05-01T12:00:00-03:00").getTime();

function project(
  id: string,
  overrides: Partial<ProjectRow> = {},
): ProjectRow {
  return {
    archivedAt: null,
    color: null,
    createdAt: NOW - 1_000,
    description: "",
    dueAt: null,
    icon: null,
    id,
    openTodoCount: 0,
    pinnedAt: null,
    sortOrder: 0,
    status: "active" as ProjectStatus,
    title: id,
    totalTodoCount: 0,
    updatedAt: NOW,
    ...overrides,
  };
}

function todo(id: string, projectId: string | null, completed = false): TodoRow {
  return {
    archivedAt: null,
    completedAt: completed ? NOW : null,
    createdAt: NOW,
    dueAt: null,
    estimatedMinutes: null,
    id,
    notes: "",
    projectId,
    scheduledEndAt: null,
    scheduledStartAt: null,
    sortOrder: Number(id.replace(/\D/g, "")) || 0,
    title: id,
    updatedAt: NOW,
  };
}

describe("projects model", () => {
  it("filters projects by status and archive state", () => {
    const rows = [
      project("active"),
      project("paused", { status: "paused" }),
      project("done", { status: "completed" }),
      project("archived", { archivedAt: NOW }),
    ];

    expect(filterProjects(rows, "active").map((row) => row.id)).toEqual(["active"]);
    expect(filterProjects(rows, "paused").map((row) => row.id)).toEqual(["paused"]);
    expect(filterProjects(rows, "completed").map((row) => row.id)).toEqual(["done"]);
    expect(filterProjects(rows, "archived").map((row) => row.id)).toEqual(["archived"]);
  });

  it("keeps project todo stats scoped to a project", () => {
    const rows = [
      todo("todo1", "proj_a"),
      todo("todo2", "proj_a", true),
      todo("todo3", "proj_b"),
    ];

    expect(todosForProject(rows, "proj_a").map((row) => row.id)).toEqual([
      "todo1",
      "todo2",
    ]);
    expect(projectTodoStats(project("proj_a"), rows)).toMatchObject({
      completedCount: 1,
      openCount: 1,
      totalCount: 2,
    });
  });

  it("detects home attention and due-soon projects", () => {
    const rows = [
      project("no_next"),
      project("due", { dueAt: NOW + 2 * 86_400_000 }),
      project("quiet", { updatedAt: NOW - 16 * 86_400_000 }),
      project("paused", { status: "paused" }),
    ];
    const todos = [
      todo("todo1", "due"),
      todo("todo2", "quiet"),
      todo("todo3", "paused"),
    ];

    expect(projectsNeedingAttention(rows, todos, NOW).map((item) => [
      item.project.id,
      item.reason,
    ])).toEqual([
      ["no_next", "noNextAction"],
      ["due", "dueSoon"],
      ["quiet", "inactive"],
    ]);
    expect(projectsDueSoon(rows, NOW).map((row) => row.id)).toEqual(["due"]);
  });
});
