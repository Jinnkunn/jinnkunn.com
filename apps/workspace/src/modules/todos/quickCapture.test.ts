import { describe, expect, it } from "vitest";

import {
  hasQuickTodoPrefix,
  parseQuickTodoInput,
} from "./quickCapture";

const NOW = new Date(2026, 3, 30, 14, 0, 0, 0);

function localMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

describe("todos quick capture", () => {
  it("parses Chinese relative date, English time, and estimate", () => {
    const draft = parseQuickTodoInput("明天 3pm 写周报 45m", NOW);

    expect(draft).toMatchObject({
      dueAt: null,
      estimatedMinutes: 45,
      scheduledEndAt: localMs(2026, 5, 1, 15, 45),
      scheduledStartAt: localMs(2026, 5, 1, 15, 0),
      title: "写周报",
    });
  });

  it("turns a dated task without time into a due date", () => {
    const draft = parseQuickTodoInput("+ submit paper tomorrow 2h", NOW);

    expect(draft).toMatchObject({
      dueAt: localMs(2026, 5, 1, 12, 0),
      estimatedMinutes: 120,
      scheduledEndAt: null,
      scheduledStartAt: null,
      title: "submit paper",
    });
  });

  it("keeps explicit today even when the time is earlier than now", () => {
    const draft = parseQuickTodoInput("today 09:30 review notes", NOW);

    expect(draft).toMatchObject({
      dueAt: null,
      scheduledStartAt: localMs(2026, 4, 30, 9, 30),
      title: "review notes",
    });
  });

  it("moves bare past times to tomorrow", () => {
    const draft = parseQuickTodoInput("9am standup", NOW);

    expect(draft).toMatchObject({
      scheduledStartAt: localMs(2026, 5, 1, 9, 0),
      title: "standup",
    });
  });

  it("detects explicit quick-capture prefixes", () => {
    expect(hasQuickTodoPrefix("+ write tests")).toBe(true);
    expect(hasQuickTodoPrefix("todo: write tests")).toBe(true);
    expect(hasQuickTodoPrefix("calendar")).toBe(false);
  });
});
