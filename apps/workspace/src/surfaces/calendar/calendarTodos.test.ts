import { describe, expect, it } from "vitest";

import type { TodoRow } from "../../modules/todos/api";
import {
  formatTodoOverlayError,
  formatTodoPlanningMeta,
  sortCalendarTodos,
} from "./calendarTodos";

function todo(patch: Partial<TodoRow> & Pick<TodoRow, "id">): TodoRow {
  const { id, ...rest } = patch;
  return {
    archivedAt: null,
    completedAt: null,
    createdAt: 1,
    dueAt: null,
    estimatedMinutes: null,
    id,
    notes: "",
    projectId: null,
    scheduledEndAt: null,
    scheduledStartAt: null,
    sortOrder: 0,
    title: id,
    updatedAt: 1,
    ...rest,
  };
}

describe("calendar todo helpers", () => {
  it("sorts planned open todos before unscheduled and completed todos", () => {
    const sorted = sortCalendarTodos([
      todo({ completedAt: 400, id: "done", sortOrder: 0 }),
      todo({ dueAt: 300, id: "later", sortOrder: 0 }),
      todo({ id: "none", sortOrder: 0 }),
      todo({ dueAt: 100, id: "earlier", sortOrder: 5 }),
      todo({ dueAt: 100, id: "same-time-first", sortOrder: 1 }),
    ]);

    expect(sorted.map((row) => row.id)).toEqual([
      "same-time-first",
      "earlier",
      "later",
      "none",
      "done",
    ]);
  });

  it("formats fallback planning and desktop-only errors", () => {
    expect(
      formatTodoPlanningMeta(
        todo({ estimatedMinutes: 45, id: "unplanned" }),
      ),
    ).toBe("No date / 45m");
    expect(formatTodoOverlayError("invoke is not available")).toBe(
      "Todo data is available in the desktop app.",
    );
  });
});
