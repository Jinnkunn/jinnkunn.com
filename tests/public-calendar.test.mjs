import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizePublicCalendarServedAt,
  normalizePublicCalendarData,
  publicCalendarJson,
} from "../lib/shared/public-calendar.ts";

test("public-calendar: busy events never expose supplied details", () => {
  const data = normalizePublicCalendarData({
    schemaVersion: 1,
    generatedAt: "2026-04-28T00:00:00.000Z",
    range: {
      startsAt: "2026-04-28T00:00:00.000Z",
      endsAt: "2026-05-28T00:00:00.000Z",
    },
    events: [
      {
        id: "private",
        title: "Sensitive meeting",
        startsAt: "2026-04-29T14:00:00.000Z",
        endsAt: "2026-04-29T15:00:00.000Z",
        isAllDay: false,
        visibility: "busy",
        description: "do not leak",
        location: "private room",
        url: "https://example.com/private",
      },
    ],
  });

  assert.equal(data.events.length, 1);
  assert.equal(data.events[0].title, "Busy");
  assert.equal(data.events[0].description, null);
  assert.equal(data.events[0].location, null);
  assert.equal(data.events[0].url, null);
});

test("public-calendar: full events preserve explicitly public details", () => {
  const data = normalizePublicCalendarData({
    generatedAt: "2026-04-28T00:00:00.000Z",
    range: {
      startsAt: "2026-04-28T00:00:00.000Z",
      endsAt: "2026-05-28T00:00:00.000Z",
    },
    events: [
      {
        id: "talk",
        title: "Public talk",
        startsAt: "2026-04-30T14:00:00-03:00",
        endsAt: "2026-04-30T15:00:00-03:00",
        isAllDay: false,
        visibility: "full",
        description: "Open to visitors.",
        location: "Room 1",
        url: "https://example.com/talk",
        colorHex: "#abc123",
      },
    ],
  });

  assert.equal(data.events[0].title, "Public talk");
  assert.equal(data.events[0].description, "Open to visitors.");
  assert.equal(data.events[0].location, "Room 1");
  assert.equal(data.events[0].url, "https://example.com/talk");
  assert.equal(data.events[0].colorHex, "#ABC123");
});

test("public-calendar: json serializer normalizes invalid rows away", () => {
  const json = publicCalendarJson(
    normalizePublicCalendarData({
      events: [
        { id: "", startsAt: "bad", endsAt: "bad", visibility: "full" },
        {
          id: "ok",
          title: "OK",
          startsAt: "2026-04-30T14:00:00.000Z",
          endsAt: "2026-04-30T15:00:00.000Z",
          visibility: "titleOnly",
        },
      ],
    }),
  );
  const parsed = JSON.parse(json);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].id, "ok");
  assert.equal(parsed.events[0].description, null);
});

test("public-calendar: served-at timestamp is normalized for client today state", () => {
  assert.equal(
    normalizePublicCalendarServedAt(
      "Fri, 15 May 2026 18:10:00 GMT",
      "2026-05-12T00:00:00.000Z",
    ),
    "2026-05-15T18:10:00.000Z",
  );
  assert.equal(
    normalizePublicCalendarServedAt(
      "not-a-date",
      "2026-05-12T00:00:00.000Z",
    ),
    "2026-05-12T00:00:00.000Z",
  );
});
