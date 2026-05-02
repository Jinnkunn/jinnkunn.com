import { describe, expect, it } from "vitest";

import {
  isWeekend,
  monthGridDays,
  rangeForView,
  weekDays,
} from "./dateRange";
import {
  zonedDateFromDayKey,
  zonedDayKey,
} from "../../../../../lib/shared/calendar-timezone.ts";

const TIME_ZONE = "America/Halifax";

function dayKeys(days: readonly Date[]): string[] {
  return days.map((day) => zonedDayKey(day, TIME_ZONE));
}

describe("calendar date ranges", () => {
  it("renders weeks Sunday-first", () => {
    const days = weekDays(zonedDateFromDayKey("2026-05-06", TIME_ZONE), TIME_ZONE);

    expect(dayKeys(days)).toEqual([
      "2026-05-03",
      "2026-05-04",
      "2026-05-05",
      "2026-05-06",
      "2026-05-07",
      "2026-05-08",
      "2026-05-09",
    ]);
  });

  it("fetches week and month ranges aligned to Sunday-first grids", () => {
    const anchor = zonedDateFromDayKey("2026-05-06", TIME_ZONE);
    const weekRange = rangeForView("week", anchor, TIME_ZONE);
    expect(zonedDayKey(weekRange.startsAt, TIME_ZONE)).toBe("2026-05-03");
    expect(zonedDayKey(weekRange.endsAt, TIME_ZONE)).toBe("2026-05-10");

    const monthDays = monthGridDays(anchor, TIME_ZONE);
    expect(monthDays).toHaveLength(42);
    expect(dayKeys(monthDays.slice(0, 7))).toEqual([
      "2026-04-26",
      "2026-04-27",
      "2026-04-28",
      "2026-04-29",
      "2026-04-30",
      "2026-05-01",
      "2026-05-02",
    ]);
  });

  it("marks Saturday and Sunday as weekend days", () => {
    expect(isWeekend(zonedDateFromDayKey("2026-05-03", TIME_ZONE), TIME_ZONE)).toBe(
      true,
    );
    expect(isWeekend(zonedDateFromDayKey("2026-05-06", TIME_ZONE), TIME_ZONE)).toBe(
      false,
    );
    expect(isWeekend(zonedDateFromDayKey("2026-05-09", TIME_ZONE), TIME_ZONE)).toBe(
      true,
    );
  });
});
