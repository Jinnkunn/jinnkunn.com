import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPublicCalendarIcs } from "@jinnkunn/calendar-core/ics";
import { normalizePublicCalendarRuntimeData, publicCalendarEventKey } from "@jinnkunn/calendar-core/public";
import { assertPublicCalendarFeeds, verifyPublicCalendarFeeds } from "../../scripts/_lib/verify-public-calendar.mjs";

function fixture() {
  const first = {
    id: "legacy", title: "Busy", visibility: "busy", isAllDay: false,
    startsAt: "2026-11-19T14:00:00Z", endsAt: "2026-11-19T15:00:00Z",
  };
  const data = normalizePublicCalendarRuntimeData({
    events: [
      first,
      { ...first, startsAt: "2026-11-26T14:00:00Z", endsAt: "2026-11-26T15:00:00Z" },
      { ...first, id: "announcement", title: "\u68c0\u67e5, \u65e5\u5386", visibility: "full", isAllDay: true,
        startsAt: "2026-11-27T00:00:00Z", endsAt: "2026-11-28T00:00:00Z", description: "Public\nnotice", location: "Published hall" },
    ],
  });
  data.observationSnapshot = { revision: 42, eventIds: [publicCalendarEventKey(data.events[1])] };
  return { json: JSON.parse(JSON.stringify(data)), ics: buildPublicCalendarIcs(data), jsonRevision: "42", icsRevision: "42" };
}

test("public feed verification reads folded ICS and matches every JSON occurrence and its privacy", () => {
  assert.deepEqual(assertPublicCalendarFeeds(fixture()), { revision: 42, events: 3, busy: 2 });
});

test("public feed verification rejects reused UIDs even when counts match", () => {
  const feed = fixture();
  const plain = feed.ics.replace(/\r\n /g, "");
  const [first, second] = [...plain.matchAll(/^UID:(.+)\r$/gm)].map(([, uid]) => uid);
  assert.throws(() => assertPublicCalendarFeeds({ ...feed, ics: plain.replace(second, first) }), /reused event UID/);
  const noKeys = feed.json.events.map((event) => {
    const legacyEvent = { ...event };
    delete legacyEvent.occurrenceId;
    return legacyEvent;
  });
  assert.throws(() => assertPublicCalendarFeeds({ ...feed, json: { ...feed.json, events: noKeys } }), /reuses an occurrence key/);
});

test("public feed verification rejects mismatched times, revision headers, and Busy data", () => {
  const feed = fixture();
  assert.throws(() => assertPublicCalendarFeeds({ ...feed, ics: feed.ics.replace("DTSTART:20261119T140000Z", "DTSTART:20261119T143000Z") }), /disagree on an event time/);
  assert.throws(() => assertPublicCalendarFeeds({ ...feed, jsonRevision: "41", icsRevision: "41" }), /does not describe the JSON body/);
  assert.throws(() => assertPublicCalendarFeeds({ ...feed, ics: feed.ics.replace("SUMMARY:Busy", "SUMMARY:Busy\r\nATTENDEE:synthetic") }), /private details/);
  feed.json.events[0].location = "Synthetic private room";
  assert.throws(() => assertPublicCalendarFeeds(feed), /private details/);
});

test("public feed verification waits for cached revisions using only the two read requests", async () => {
  const feed = fixture();
  const paths = [];
  let icsReads = 0;
  const result = await verifyPublicCalendarFeeds((path) => {
    paths.push(path);
    if (path.endsWith(".ics")) return new Response(feed.ics, {
      headers: { "Content-Type": "text/calendar", "X-Calendar-Revision": ++icsReads === 1 ? "41" : "42" },
    });
    return Response.json(feed.json, { headers: { "X-Calendar-Revision": "42" } });
  }, { retryDelays: [0, 0] });
  assert.deepEqual(result, { revision: 42, events: 3, busy: 2 });
  assert.deepEqual(paths, ["/api/public/calendar", "/api/public/calendar/calendar.ics", "/api/public/calendar", "/api/public/calendar/calendar.ics"]);
});
