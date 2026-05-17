import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeCalendarObservations,
  normalizeCalendarObservationSyncPayload,
} from "../../lib/shared/calendar-core.ts";

test("calendar-core: normalizes observations and dedupes shared iCal UID", () => {
  const payload = normalizeCalendarObservationSyncPayload({
    collector: { id: "ios:phone", kind: "ios" },
    sources: [
      { id: "icloud", provider: "apple", title: "iCloud" },
      { id: "mac-icloud", provider: "apple", title: "iCloud on Mac" },
    ],
    range: {
      startsAt: "2026-05-17T00:00:00-03:00",
      endsAt: "2026-05-18T00:00:00-03:00",
    },
    observations: [
      {
        sourceId: "icloud",
        sourceEventId: "ios-event",
        iCalUid: "shared-uid",
        title: "Jinkun, Vlado meeting",
        startsAt: "2026-05-17T14:00:00-03:00",
        endsAt: "2026-05-17T15:00:00-03:00",
      },
      {
        sourceId: "mac-icloud",
        sourceEventId: "mac-event",
        iCalUid: "shared-uid",
        title: "Jinkun, Vlado meeting",
        startsAt: "2026-05-17T14:00:00-03:00",
        endsAt: "2026-05-17T15:00:00-03:00",
      },
    ],
  });

  const entities = mergeCalendarObservations(payload.observations);
  assert.equal(entities.length, 1);
  assert.equal(entities[0].sourceRefs.length, 2);
  assert.equal(entities[0].confidence, 100);
});

test("calendar-core: does not merge same-title events at different times", () => {
  const payload = normalizeCalendarObservationSyncPayload({
    collector: { id: "ios:phone", kind: "ios" },
    sources: [{ id: "icloud", provider: "apple", title: "iCloud" }],
    range: {
      startsAt: "2026-05-17T00:00:00Z",
      endsAt: "2026-05-18T00:00:00Z",
    },
    observations: [
      {
        sourceId: "icloud",
        sourceEventId: "morning",
        title: "Office hours",
        startsAt: "2026-05-17T13:00:00Z",
        endsAt: "2026-05-17T14:00:00Z",
      },
      {
        sourceId: "icloud",
        sourceEventId: "afternoon",
        title: "Office hours",
        startsAt: "2026-05-17T18:00:00Z",
        endsAt: "2026-05-17T19:00:00Z",
      },
    ],
  });

  const entities = mergeCalendarObservations(payload.observations);
  assert.equal(entities.length, 2);
});

test("calendar-core: meeting URL can merge cross-source copies", () => {
  const payload = normalizeCalendarObservationSyncPayload({
    collector: { id: "mac", kind: "tauri-macos" },
    sources: [
      { id: "google", provider: "google", title: "Google" },
      { id: "outlook", provider: "outlook", title: "Outlook" },
    ],
    range: {
      startsAt: "2026-05-17T00:00:00Z",
      endsAt: "2026-05-18T00:00:00Z",
    },
    observations: [
      {
        sourceId: "google",
        sourceEventId: "g-1",
        title: "Research meeting",
        url: "https://meet.google.com/abc-defg-hij",
        startsAt: "2026-05-17T16:00:00Z",
        endsAt: "2026-05-17T17:00:00Z",
      },
      {
        sourceId: "outlook",
        sourceEventId: "o-1",
        title: "Research meeting",
        location: "https://meet.google.com/abc-defg-hij",
        startsAt: "2026-05-17T16:00:00Z",
        endsAt: "2026-05-17T17:00:00Z",
      },
    ],
  });

  const entities = mergeCalendarObservations(payload.observations);
  assert.equal(entities.length, 1);
  assert.equal(entities[0].sourceRefs.length, 2);
});
