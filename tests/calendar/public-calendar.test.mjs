import test from "node:test";
import assert from "node:assert/strict";

import {
  filterStalePublicCalendarEvents,
  normalizePublicCalendarServedAt,
  normalizePublicCalendarData,
  normalizePublicCalendarRuntimeData,
  publicCalendarEventKey,
  publicCalendarFreshness,
  publicCalendarRevisionHeaders,
  publicCalendarJson,
  selectPublicCalendarHydrationData,
  selectPublicCalendarRuntimeData,
} from "../../lib/shared/public-calendar.ts";

function busySlot(id, day) {
  return {
    id, visibility: "busy",
    startsAt: `2026-05-${day}T14:00:00Z`,
    endsAt: `2026-05-${day}T15:00:00Z`,
  };
}

test("public-calendar: only a Live receipt determines freshness and it is not writable", () => {
  const verifiedAt = "2026-11-19T10:00:00.000Z";
  const raw = { generatedAt: verifiedAt, events: [], observationSnapshot: { revision: 42, eventIds: [], verifiedAt } };
  const known = normalizePublicCalendarRuntimeData(raw);
  assert.equal(known.observationSnapshot.verifiedAt, verifiedAt);
  assert.equal(normalizePublicCalendarData(raw).observationSnapshot, undefined);
  assert.equal(publicCalendarRevisionHeaders(known)["X-Calendar-Verified-At"], verifiedAt);
  assert.equal(publicCalendarFreshness(undefined, Date.parse(verifiedAt)), "unverified");
  assert.equal(publicCalendarFreshness(verifiedAt, Date.parse("2026-11-19T09:50:00Z")), "unverified");
  assert.equal(publicCalendarFreshness(verifiedAt, Date.parse("2026-11-19T16:00:00Z")), "current");
  assert.equal(publicCalendarFreshness(verifiedAt, Date.parse("2026-11-19T16:00:01Z")), "stale");
  const missingReceipt = normalizePublicCalendarRuntimeData({ ...raw, observationSnapshot: { revision: 42, eventIds: [] } });
  assert.equal(selectPublicCalendarHydrationData({ currentData: known, refreshedData: missingReceipt }), known);
});

test("public-calendar: legacy occurrence IDs survive decay, source changes and refresh", () => {
  const sourceData = normalizePublicCalendarData({
    generatedAt: "2026-05-28T00:00:00Z",
    events: [busySlot("weekly", "15"), busySlot("weekly", "15"), busySlot("weekly", "22"), busySlot("unique", "23")],
  });
  const projected = selectPublicCalendarRuntimeData({ sourceData });
  assert.deepEqual(projected.events.map(({ id }) => id), ["weekly", "weekly", "unique"]);
  const keys = projected.events.map(publicCalendarEventKey);
  assert.equal(new Set(keys).size, 3);
  assert.equal(keys[2], "unique");
  const decayed = filterStalePublicCalendarEvents(projected, { now: new Date("2026-06-16T00:00:00Z") });
  const normalized = normalizePublicCalendarRuntimeData(JSON.parse(JSON.stringify(decayed)));
  assert.deepEqual(normalized.events.map(publicCalendarEventKey), keys.slice(1));
  assert.equal(normalizePublicCalendarData(decayed).events[0].occurrenceId, undefined, "runtime keys are not accepted on write");

  const dbData = normalizePublicCalendarData({ ...sourceData, generatedAt: "2026-05-29T00:00:00Z", events: [sourceData.events[2]] });
  const dbResult = selectPublicCalendarRuntimeData({ dbData, sourceData });
  assert.deepEqual(dbResult.events.map(publicCalendarEventKey), [keys[1]]);

  const hydrated = selectPublicCalendarHydrationData({ currentData: projected, refreshedData: dbResult });
  assert.deepEqual(hydrated.events.map(publicCalendarEventKey), keys, "an unverified partial feed is not proof the other slots vanished");
});

test("public-calendar: a verified occurrence never removes another day that reuses the same legacy ID", () => {
  const sourceData = normalizePublicCalendarData({ events: [busySlot("weekly", "15")] });
  const observed = normalizePublicCalendarData({ events: [busySlot("weekly", "22")] });
  const first = selectPublicCalendarRuntimeData({ sourceData, observedData: {
    ...observed, observationSnapshot: { revision: 1, eventIds: ["weekly"] },
  } });
  assert.equal(first.events.length, 2, "same stem with no time overlap is not coverage");
  assert.deepEqual(first.observationSnapshot.eventIds, [publicCalendarEventKey(first.events[1])]);
  const after = selectPublicCalendarRuntimeData({ sourceData, observedData: {
    ...observed, events: [], observationSnapshot: { revision: 2, eventIds: [] },
  } });
  const hydrated = selectPublicCalendarHydrationData({ currentData: first, refreshedData: after });
  assert.deepEqual(hydrated.events.map(({ startsAt }) => startsAt), [sourceData.events[0].startsAt]);
});

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
        audience: "all",
        colorHex: "#abc123",
      },
    ],
  });

  assert.equal(data.events[0].title, "Public talk");
  assert.equal(data.events[0].description, "Open to visitors.");
  assert.equal(data.events[0].location, "Room 1");
  assert.equal(data.events[0].url, "https://example.com/talk");
  assert.equal(data.events[0].audience, "all");
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

test("public-calendar: runtime data prefers complete source when db projection is partial", () => {
  const base = {
    schemaVersion: 1,
    generatedAt: "2026-05-15T15:09:23.901Z",
    range: {
      startsAt: "2026-05-15T03:00:00.000Z",
      endsAt: "2027-05-15T03:00:00.000Z",
    },
  };
  const dbData = normalizePublicCalendarData({
    ...base,
    events: [
      {
        id: "db-only",
        title: "DB event",
        startsAt: "2026-05-15T14:00:00.000Z",
        endsAt: "2026-05-15T15:00:00.000Z",
        isAllDay: false,
        visibility: "titleOnly",
      },
    ],
  });
  const sourceData = normalizePublicCalendarData({
    ...base,
    events: [
      ...dbData.events,
      {
        id: "source-extra",
        title: "Source event",
        startsAt: "2026-05-16T14:00:00.000Z",
        endsAt: "2026-05-16T15:00:00.000Z",
        isAllDay: false,
        visibility: "titleOnly",
      },
    ],
  });

  assert.equal(
    selectPublicCalendarRuntimeData({ dbData, sourceData }).events.length,
    2,
  );
});

test("public-calendar: runtime data still prefers newer db projection", () => {
  const sourceData = normalizePublicCalendarData({
    generatedAt: "2026-05-15T15:09:23.901Z",
    range: {
      startsAt: "2026-05-15T03:00:00.000Z",
      endsAt: "2027-05-15T03:00:00.000Z",
    },
    events: [
      {
        id: "source",
        title: "Source event",
        startsAt: "2026-05-15T14:00:00.000Z",
        endsAt: "2026-05-15T15:00:00.000Z",
        isAllDay: false,
        visibility: "titleOnly",
      },
    ],
  });
  const dbData = normalizePublicCalendarData({
    ...sourceData,
    generatedAt: "2026-05-15T16:09:23.901Z",
    events: [],
  });

  assert.equal(
    selectPublicCalendarRuntimeData({ dbData, sourceData }).generatedAt,
    "2026-05-15T16:09:23.901Z",
  );
});

test("public-calendar: runtime data supplements missing observed busy events", () => {
  const sourceData = normalizePublicCalendarData({
    generatedAt: "2026-05-15T15:09:23.901Z",
    range: {
      startsAt: "2026-05-15T03:00:00.000Z",
      endsAt: "2027-05-15T03:00:00.000Z",
    },
    events: [
      {
        id: "public-talk",
        title: "Public talk",
        startsAt: "2026-05-15T14:00:00.000Z",
        endsAt: "2026-05-15T15:00:00.000Z",
        isAllDay: false,
        visibility: "full",
        description: "Keep the public detail.",
        location: "Room 1",
      },
    ],
  });
  const observedData = normalizePublicCalendarData({
    generatedAt: "2026-05-15T16:09:23.901Z",
    range: sourceData.range,
    events: [
      {
        id: "observed-duplicate",
        title: "Private title",
        startsAt: "2026-05-15T14:00:00.000Z",
        endsAt: "2026-05-15T15:15:00.000Z",
        isAllDay: false,
        visibility: "busy",
      },
      {
        id: "observed-new",
        title: "Private phone-only event",
        startsAt: "2026-05-15T14:45:00.000Z",
        endsAt: "2026-05-15T15:45:00.000Z",
        isAllDay: false,
        visibility: "busy",
        description: "must not leak",
      },
      {
        id: "second-observation-of-new-event",
        title: "Private second-device event",
        startsAt: "2026-05-15T15:00:00.000Z",
        endsAt: "2026-05-15T15:45:00.000Z",
        isAllDay: false,
        visibility: "busy",
      },
    ],
  });

  const selected = selectPublicCalendarRuntimeData({
    dbData: null,
    sourceData,
    observedData,
  });

  assert.deepEqual(
    selected.events.map((event) => event.id),
    ["public-talk", "observed-new"],
  );
  assert.equal(selected.generatedAt, "2026-05-15T16:09:23.901Z");
  assert.equal(selected.events[0].title, "Public talk");
  assert.equal(selected.events[0].description, "Keep the public detail.");
  assert.equal(selected.events[1].title, "Busy");
  assert.equal(selected.events[1].description, null);
});

test("public-calendar: hydration does not replace complete data with stale partial data", () => {
  const currentData = normalizePublicCalendarData({
    generatedAt: "2026-05-15T15:09:23.901Z",
    range: {
      startsAt: "2026-05-15T03:00:00.000Z",
      endsAt: "2027-05-15T03:00:00.000Z",
    },
    events: [
      {
        id: "one",
        title: "One",
        startsAt: "2026-05-15T14:00:00.000Z",
        endsAt: "2026-05-15T15:00:00.000Z",
        isAllDay: false,
        visibility: "titleOnly",
      },
      {
        id: "two",
        title: "Two",
        startsAt: "2026-05-16T14:00:00.000Z",
        endsAt: "2026-05-16T15:00:00.000Z",
        isAllDay: false,
        visibility: "titleOnly",
      },
    ],
  });
  const stalePartial = normalizePublicCalendarData({
    ...currentData,
    events: [currentData.events[0]],
  });

  assert.equal(
    selectPublicCalendarHydrationData({
      currentData,
      refreshedData: stalePartial,
    }).events.length,
    2,
  );
});

test("public-calendar: hydration merges newer partial data without flicker", () => {
  const currentData = normalizePublicCalendarData({
    generatedAt: "2026-05-15T15:09:23.901Z",
    range: {
      startsAt: "2026-05-15T03:00:00.000Z",
      endsAt: "2027-05-15T03:00:00.000Z",
    },
    events: [
      {
        id: "one",
        title: "One",
        startsAt: "2026-05-15T14:00:00.000Z",
        endsAt: "2026-05-15T15:00:00.000Z",
        isAllDay: false,
        visibility: "titleOnly",
      },
    ],
  });
  const newerData = normalizePublicCalendarData({
    ...currentData,
    generatedAt: "2026-05-15T16:09:23.901Z",
    events: [],
  });

  assert.equal(
    selectPublicCalendarHydrationData({
      currentData,
      refreshedData: newerData,
    }).events.length,
    1,
  );
});

test("public-calendar: hydration accepts newer additions while carrying static rows", () => {
  const currentData = normalizePublicCalendarData({
    generatedAt: "2026-05-15T15:09:23.901Z",
    range: {
      startsAt: "2026-05-15T03:00:00.000Z",
      endsAt: "2027-05-15T03:00:00.000Z",
    },
    events: [
      {
        id: "static",
        title: "Static event",
        startsAt: "2026-05-15T14:00:00.000Z",
        endsAt: "2026-05-15T15:00:00.000Z",
        isAllDay: false,
        visibility: "titleOnly",
      },
    ],
  });
  const newerData = normalizePublicCalendarData({
    ...currentData,
    generatedAt: "2026-05-15T16:09:23.901Z",
    events: [
      {
        id: "new",
        title: "New accepted event",
        startsAt: "2026-05-16T14:00:00.000Z",
        endsAt: "2026-05-16T15:00:00.000Z",
        isAllDay: false,
        visibility: "titleOnly",
      },
    ],
  });

  assert.deepEqual(
    selectPublicCalendarHydrationData({
      currentData,
      refreshedData: newerData,
    }).events.map((event) => event.id),
    ["static", "new"],
  );
});
