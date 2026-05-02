import { describe, expect, it } from "vitest";

import type { ProjectRow } from "../../modules/projects/api";
import {
  PROJECTS_ACTIVE_NAV_ID,
  PROJECTS_ARCHIVED_NAV_ID,
  PROJECTS_COMPLETED_NAV_ID,
  PROJECTS_HOME_NAV_ID,
  PROJECTS_PAUSED_NAV_ID,
  createProjectsNavGroups,
  isProjectCreateNavItem,
  projectIdFromNavItem,
  projectNavId,
  projectRowsToNavItems,
} from "./nav";

function project(id: string, openTodoCount = 0): ProjectRow {
  return {
    archivedAt: null,
    color: null,
    createdAt: 1,
    description: "",
    dueAt: null,
    icon: null,
    id,
    openTodoCount,
    pinnedAt: null,
    sortOrder: 0,
    status: "active",
    title: id,
    totalTodoCount: openTodoCount,
    updatedAt: 1,
  };
}

describe("projects nav", () => {
  it("round-trips project nav ids", () => {
    expect(projectIdFromNavItem(projectNavId("proj_123"))).toBe("proj_123");
    expect(projectIdFromNavItem(PROJECTS_HOME_NAV_ID)).toBeNull();
  });

  it("marks the group add row as a create action, not a project detail", () => {
    const group = createProjectsNavGroups()[1];
    expect(isProjectCreateNavItem(group?.addItemId)).toBe(true);
    expect(projectIdFromNavItem(group?.addItemId)).toBeNull();
  });

  it("builds project rows with open todo badges", () => {
    const items = projectRowsToNavItems([project("Launch", 3), project("Quiet")]);
    expect(items.map((item) => [item.id, item.badge])).toEqual([
      ["project:Launch", "3"],
      ["project:Quiet", undefined],
    ]);
    expect(items.every((item) => item.draggable && item.droppable && item.orderable))
      .toBe(true);
  });

  it("builds stable view and system groups", () => {
    const groups = createProjectsNavGroups({
      [PROJECTS_ACTIVE_NAV_ID]: 2,
      [PROJECTS_ARCHIVED_NAV_ID]: 1,
      [PROJECTS_COMPLETED_NAV_ID]: 4,
      [PROJECTS_HOME_NAV_ID]: 3,
      [PROJECTS_PAUSED_NAV_ID]: 5,
    });
    expect(groups.map((group) => group.id)).toEqual([
      "projects:views",
      "projects:list",
      "projects:system",
    ]);
    expect(groups[0]?.items.map((item) => [item.id, item.badge])).toEqual([
      [PROJECTS_HOME_NAV_ID, "3"],
      [PROJECTS_ACTIVE_NAV_ID, "2"],
      [PROJECTS_PAUSED_NAV_ID, "5"],
      [PROJECTS_COMPLETED_NAV_ID, "4"],
    ]);
    expect(groups[2]?.items[0]?.badge).toBe("1");
  });
});
