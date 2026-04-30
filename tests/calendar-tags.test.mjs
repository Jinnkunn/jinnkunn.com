import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  eventMatchesAnyTag,
  extractEventTags,
  summarizeTags,
} from "../lib/shared/calendar-tags.ts";

// Pure-function coverage for the public-calendar tag extractor. The
// chip UI on /calendar reads from these helpers directly, so a regex
// regression here would silently kill the filter.

const baseEvent = {
  id: "e1",
  title: "Public talk",
  startsAt: "2026-05-01T14:00:00.000Z",
  endsAt: "2026-05-01T15:00:00.000Z",
  isAllDay: false,
  visibility: "full",
  description: null,
  location: null,
  url: null,
};

test("extractEventTags: harvests hashtags from title", () => {
  const event = { ...baseEvent, title: "Office hours #teaching" };
  assert.deepEqual(extractEventTags(event), ["teaching"]);
});

test("extractEventTags: harvests hashtags from description (full visibility only)", () => {
  const event = {
    ...baseEvent,
    title: "Generic talk",
    description: "Joining #conf2026 — also #ai related",
  };
  assert.deepEqual(extractEventTags(event).sort(), ["ai", "conf2026"]);
});

test("extractEventTags: skips description for titleOnly visibility", () => {
  const event = {
    ...baseEvent,
    visibility: "titleOnly",
    title: "Lunch #personal",
    description: "Should not parse #leak",
  };
  assert.deepEqual(extractEventTags(event), ["personal"]);
});

test("extractEventTags: returns empty array for busy events", () => {
  const event = {
    ...baseEvent,
    visibility: "busy",
    title: "Busy", // canonical "Busy" title, no real tags possible
    description: null,
  };
  assert.deepEqual(extractEventTags(event), []);
});

test("extractEventTags: collapses case-variants into a single lowercase tag", () => {
  const event = {
    ...baseEvent,
    title: "#Talks #talks #TALKS",
  };
  assert.deepEqual(extractEventTags(event), ["talks"]);
});

test("extractEventTags: rejects pure-numeric markers like #2026", () => {
  const event = { ...baseEvent, title: "Recap #2026 #q1-summary" };
  // #2026 is dropped; the alphanumeric one survives.
  assert.deepEqual(extractEventTags(event), ["q1-summary"]);
});

test("extractEventTags: ignores hashtags inside a longer word", () => {
  // `not#a#tag` is not a tag — TAG_PATTERN requires whitespace or
  // sentence punctuation immediately before the `#`.
  const event = { ...baseEvent, title: "comment#not-a-tag #real" };
  assert.deepEqual(extractEventTags(event), ["real"]);
});

test("summarizeTags: orders by descending count then alphabetical", () => {
  const events = [
    { ...baseEvent, id: "1", title: "#a #b" },
    { ...baseEvent, id: "2", title: "#a #c" },
    { ...baseEvent, id: "3", title: "#a" },
    { ...baseEvent, id: "4", title: "#c" },
  ];
  assert.deepEqual(summarizeTags(events), [
    { tag: "a", count: 3 },
    { tag: "c", count: 2 },
    { tag: "b", count: 1 },
  ]);
});

test("eventMatchesAnyTag: empty filter set matches everything", () => {
  const event = { ...baseEvent, title: "no tags here" };
  assert.equal(eventMatchesAnyTag(event, new Set()), true);
});

test("eventMatchesAnyTag: matches when ANY selected tag is present (OR logic)", () => {
  const event = { ...baseEvent, title: "Office #teaching" };
  assert.equal(eventMatchesAnyTag(event, new Set(["teaching"])), true);
  assert.equal(
    eventMatchesAnyTag(event, new Set(["talks", "teaching"])),
    true,
  );
  assert.equal(eventMatchesAnyTag(event, new Set(["talks"])), false);
});
