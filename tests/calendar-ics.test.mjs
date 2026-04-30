import { strict as assert } from "node:assert";
import { test } from "node:test";

import { buildPublicCalendarIcs } from "../lib/shared/calendar-ics.ts";

// RFC 5545 contract tests for the public calendar feed. The generator
// is hand-rolled (no `ical-generator` dep), so a single missing CRLF
// or misordered property silently breaks Outlook subscriptions. These
// tests pin the parts that have historically tripped iCal clients.

const baseData = {
  schemaVersion: 1,
  generatedAt: "2026-04-30T12:00:00.000Z",
  range: {
    startsAt: "2026-04-01T00:00:00.000Z",
    endsAt: "2026-06-01T00:00:00.000Z",
  },
  events: [],
};

function fullEvent(overrides = {}) {
  return {
    id: "event-1",
    title: "CS5008 — Office hours",
    startsAt: "2026-05-01T18:00:00.000Z",
    endsAt: "2026-05-01T19:30:00.000Z",
    isAllDay: false,
    visibility: "full",
    description: "Drop in to talk about A2 — bring your code.",
    location: "Goldberg 105",
    url: "https://example.com/cs5008",
    ...overrides,
  };
}

test("ics: line endings are CRLF, not LF — Outlook on Windows refuses LF-only", () => {
  const ics = buildPublicCalendarIcs({ ...baseData, events: [fullEvent()] });
  const lfOnly = ics.split("\r\n").join("").includes("\n");
  assert.equal(lfOnly, false, "found bare LF inside an ICS line");
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /\r\nEND:VCALENDAR\r\n$/);
});

test("ics: required calendar-level properties are present", () => {
  const ics = buildPublicCalendarIcs({ ...baseData, events: [fullEvent()] });
  assert.match(ics, /\r\nVERSION:2\.0\r\n/);
  assert.match(ics, /\r\nPRODID:-\/\/jinkunchen\.com\/\/Public Calendar\/\/EN\r\n/);
  assert.match(ics, /\r\nCALSCALE:GREGORIAN\r\n/);
  assert.match(ics, /\r\nMETHOD:PUBLISH\r\n/);
  assert.match(ics, /X-WR-CALNAME:/);
});

test("ics: full event keeps SUMMARY/DESCRIPTION/LOCATION/URL", () => {
  const ics = buildPublicCalendarIcs({
    ...baseData,
    events: [fullEvent()],
  });
  assert.match(ics, /SUMMARY:CS5008 — Office hours/);
  assert.match(
    ics,
    /DESCRIPTION:Drop in to talk about A2 — bring your code\./,
  );
  assert.match(ics, /LOCATION:Goldberg 105/);
  assert.match(ics, /URL:https:\/\/example\.com\/cs5008/);
});

function veventBlock(ics) {
  // Carve out just the BEGIN:VEVENT…END:VEVENT slice so per-event
  // assertions don't accidentally match calendar-level properties
  // (the VCALENDAR header has its own DESCRIPTION line for the
  // subscribe-list label).
  const start = ics.indexOf("BEGIN:VEVENT");
  const end = ics.indexOf("END:VEVENT", start);
  if (start < 0 || end < 0) return "";
  return ics.slice(start, end);
}

test("ics: busy event ships CLASS:CONFIDENTIAL and strips DESCRIPTION/LOCATION/URL", () => {
  const event = fullEvent({
    visibility: "busy",
    title: "Busy",
    description: null,
    location: null,
    url: null,
  });
  const ics = buildPublicCalendarIcs({ ...baseData, events: [event] });
  const ve = veventBlock(ics);
  assert.match(ve, /SUMMARY:Busy/);
  assert.match(ve, /CLASS:CONFIDENTIAL/);
  assert.doesNotMatch(ve, /DESCRIPTION:/);
  assert.doesNotMatch(ve, /LOCATION:/);
  assert.doesNotMatch(ve, /URL:/);
});

test("ics: titleOnly event has CLASS:PUBLIC but no DESCRIPTION/LOCATION/URL", () => {
  const event = fullEvent({
    visibility: "titleOnly",
    description: null,
    location: null,
    url: null,
  });
  const ics = buildPublicCalendarIcs({ ...baseData, events: [event] });
  const ve = veventBlock(ics);
  assert.match(ve, /CLASS:PUBLIC/);
  assert.doesNotMatch(ve, /DESCRIPTION:/);
});

test("ics: timed event uses DTSTART/DTEND in UTC `YYYYMMDDTHHMMSSZ`", () => {
  const ics = buildPublicCalendarIcs({ ...baseData, events: [fullEvent()] });
  // 2026-05-01T18:00:00Z → 20260501T180000Z
  assert.match(ics, /DTSTART:20260501T180000Z/);
  assert.match(ics, /DTEND:20260501T193000Z/);
});

test("ics: all-day event uses VALUE=DATE without time component", () => {
  const event = fullEvent({
    isAllDay: true,
    startsAt: "2026-05-01T00:00:00.000Z",
    endsAt: "2026-05-02T00:00:00.000Z",
  });
  const ics = buildPublicCalendarIcs({ ...baseData, events: [event] });
  assert.match(ics, /DTSTART;VALUE=DATE:20260501/);
  assert.match(ics, /DTEND;VALUE=DATE:20260502/);
});

test("ics: text fields escape commas, semicolons, backslashes, newlines", () => {
  const event = fullEvent({
    title: "Comma, then ;semicolon and \\backslash",
    description: "line one\nline two",
  });
  const ics = buildPublicCalendarIcs({ ...baseData, events: [event] });
  assert.match(ics, /SUMMARY:Comma\\, then \\;semicolon and \\\\backslash/);
  assert.match(ics, /DESCRIPTION:line one\\nline two/);
});

test("ics: long lines fold to <=75 octets per RFC 5545 §3.1", () => {
  const longTitle = "Very ".repeat(40); // 200 chars
  const event = fullEvent({ title: longTitle.trim() });
  const ics = buildPublicCalendarIcs({ ...baseData, events: [event] });
  // Find the SUMMARY: line + any continuation lines that follow.
  const summaryStart = ics.indexOf("SUMMARY:");
  assert.notEqual(summaryStart, -1);
  // After the first 70 chars the generator should insert "\r\n " — a
  // CRLF + a single space marks a folded continuation. Without the
  // fold a 200-char title would be one continuous 207-octet line and
  // strict parsers (Outlook in particular) would reject it.
  const slice = ics.slice(summaryStart, summaryStart + 250);
  assert.match(slice, /\r\n /, "expected at least one folded continuation");
});

test("ics: each VEVENT carries a stable globally-unique UID", () => {
  const events = [
    fullEvent({ id: "event-1" }),
    fullEvent({ id: "event-2", title: "Talk" }),
  ];
  const ics = buildPublicCalendarIcs({ ...baseData, events });
  assert.match(ics, /UID:event-1@jinkunchen\.com/);
  assert.match(ics, /UID:event-2@jinkunchen\.com/);
  // Each VEVENT must be inside its own BEGIN/END pair — no nested
  // events, no missing END before the next BEGIN.
  const opens = (ics.match(/\r\nBEGIN:VEVENT\r\n/g) || []).length;
  const closes = (ics.match(/\r\nEND:VEVENT\r\n/g) || []).length;
  assert.equal(opens, 2);
  assert.equal(closes, 2);
});

test("ics: empty event list still produces a valid VCALENDAR shell", () => {
  const ics = buildPublicCalendarIcs({ ...baseData, events: [] });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /\r\nEND:VCALENDAR\r\n$/);
  assert.doesNotMatch(ics, /BEGIN:VEVENT/);
});

test("ics: refresh hint advertised so subscribed clients respect a sane TTL", () => {
  const ics = buildPublicCalendarIcs({ ...baseData, events: [] });
  assert.match(ics, /REFRESH-INTERVAL;VALUE=DURATION:PT1H/);
  assert.match(ics, /X-PUBLISHED-TTL:PT1H/);
});
