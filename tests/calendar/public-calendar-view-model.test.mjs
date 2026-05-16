import test from "node:test";
import assert from "node:assert/strict";

import {
  addCalendarDays,
  buildAgendaGroups,
  buildDayIndex,
  decoratePublicCalendarEvent,
  eventsForDayKey,
  formatToolbarTitle,
  keyForDate,
  monthGridDays,
  startOfCalendarDay,
} from "../../components/calendar/public-calendar-model.ts";
import { normalizePublicCalendarData } from "../../lib/shared/public-calendar.ts";

test("public-calendar-view-model: month grid starts on Sunday and marks current day by served timestamp", () => {
  const timeZone = "America/Halifax";
  const anchor = startOfCalendarDay(new Date("2026-05-15T18:10:00.000Z"), timeZone);
  const days = monthGridDays(anchor, timeZone);

  assert.equal(days.length, 42);
  assert.equal(keyForDate(days[0], timeZone), "2026-04-26");
  assert.equal(keyForDate(days[6], timeZone), "2026-05-02");
  assert.equal(keyForDate(anchor, timeZone), "2026-05-15");
  assert.equal(
    days.some((day) => keyForDate(day, timeZone) === keyForDate(anchor, timeZone)),
    true,
  );
});

test("public-calendar-view-model: timezone day keys follow the selected display zone", () => {
  const event = normalizePublicCalendarData({
    events: [
      {
        id: "late",
        title: "Late call",
        startsAt: "2026-05-16T02:30:00.000Z",
        endsAt: "2026-05-16T03:30:00.000Z",
        isAllDay: false,
        visibility: "titleOnly",
      },
    ],
  }).events[0];

  const halifax = decoratePublicCalendarEvent(event, "America/Halifax");
  const vancouver = decoratePublicCalendarEvent(event, "America/Vancouver");

  assert.equal(halifax.startDayKey, "2026-05-15");
  assert.equal(vancouver.startDayKey, "2026-05-15");
  assert.equal(halifax.touchedDayKeys.includes("2026-05-16"), true);
  assert.equal(vancouver.touchedDayKeys.includes("2026-05-15"), true);
});

test("public-calendar-view-model: hydration-stable day index keeps all refreshed events visible", () => {
  const timeZone = "America/Halifax";
  const data = normalizePublicCalendarData({
    generatedAt: "2026-05-15T18:10:00.000Z",
    events: [
      {
        id: "accepted",
        title: "Accepted event",
        startsAt: "2026-05-15T14:00:00.000Z",
        endsAt: "2026-05-15T15:00:00.000Z",
        isAllDay: false,
        visibility: "titleOnly",
      },
      {
        id: "later",
        title: "Later event",
        startsAt: "2026-05-16T14:00:00.000Z",
        endsAt: "2026-05-16T15:00:00.000Z",
        isAllDay: false,
        visibility: "titleOnly",
      },
    ],
  });
  const decorated = data.events.map((event) =>
    decoratePublicCalendarEvent(event, timeZone),
  );
  const index = buildDayIndex(decorated);

  assert.deepEqual(
    eventsForDayKey(index, "2026-05-15").map((event) => event.id),
    ["accepted"],
  );
  assert.deepEqual(
    eventsForDayKey(index, "2026-05-16").map((event) => event.id),
    ["later"],
  );
});

test("public-calendar-view-model: week navigation remains Sunday-first across DST boundaries", () => {
  const timeZone = "America/Halifax";
  const start = startOfCalendarDay(new Date("2026-03-08T15:00:00.000Z"), timeZone);
  const week = Array.from({ length: 7 }, (_, i) =>
    addCalendarDays(start, i, timeZone),
  );

  assert.deepEqual(
    week.map((day) => keyForDate(day, timeZone)),
    [
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
      "2026-03-13",
      "2026-03-14",
    ],
  );
  assert.match(formatToolbarTitle("week", start, timeZone), /^Mar 8 - Mar 14, 2026$/);
});

test("public-calendar-view-model: agenda groups start from the live current date", () => {
  const timeZone = "America/Halifax";
  const data = normalizePublicCalendarData({
    generatedAt: "2026-05-12T03:00:00.000Z",
    events: [
      {
        id: "old",
        title: "Old event",
        startsAt: "2026-05-12T14:00:00.000Z",
        endsAt: "2026-05-12T15:00:00.000Z",
        isAllDay: false,
        visibility: "titleOnly",
      },
      {
        id: "today",
        title: "Today event",
        startsAt: "2026-05-15T14:00:00.000Z",
        endsAt: "2026-05-15T15:00:00.000Z",
        isAllDay: false,
        visibility: "titleOnly",
      },
    ],
  });
  const decorated = data.events.map((event) =>
    decoratePublicCalendarEvent(event, timeZone),
  );
  const groups = buildAgendaGroups(
    decorated,
    30,
    new Date("2026-05-15T18:10:00.000Z"),
    timeZone,
  );

  assert.deepEqual(groups.map(([day]) => day), ["2026-05-15"]);
});
