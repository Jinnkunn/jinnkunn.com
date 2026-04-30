import { describe, expect, it } from "vitest";

import {
  dateAndTimeInputToTimestamp,
  dateInputValue,
  presetDueTimestamp,
  scheduleEndTimestamp,
  todoPresetUpdateParams,
} from "./planning";

describe("todo planning helpers", () => {
  it("formats local date input values", () => {
    expect(dateInputValue(new Date(2026, 3, 30, 9, 15).getTime())).toBe(
      "2026-04-30",
    );
  });

  it("combines date and time inputs into a local timestamp", () => {
    const timestamp = dateAndTimeInputToTimestamp("2026-05-01", "15:30");
    expect(timestamp).toBe(new Date(2026, 4, 1, 15, 30).getTime());
  });

  it("sets this-week due date to the current local week end", () => {
    const now = new Date(2026, 3, 30, 16, 0);
    expect(presetDueTimestamp("thisWeek", now)).toBe(
      new Date(2026, 4, 3, 12, 0).getTime(),
    );
  });

  it("sets next-week due date to the following local week end", () => {
    const now = new Date(2026, 3, 30, 16, 0);
    expect(todoPresetUpdateParams("nextWeek", now)).toEqual({
      dueAt: new Date(2026, 4, 10, 12, 0).getTime(),
      scheduledEndAt: null,
      scheduledStartAt: null,
    });
  });

  it("computes schedule end timestamps from estimates", () => {
    const start = new Date(2026, 4, 1, 15, 0).getTime();
    expect(scheduleEndTimestamp(start, 45)).toBe(
      new Date(2026, 4, 1, 15, 45).getTime(),
    );
    expect(scheduleEndTimestamp(start, null)).toBeNull();
  });
});
