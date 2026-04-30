import { describe, expect, it } from "vitest";

import {
  DEFAULT_SMART_RULES,
  resolveSmartDefault,
} from "./smartDefaults";
import type { CalendarEvent } from "./types";

const baseEvent: CalendarEvent = {
  eventIdentifier: "e1",
  externalIdentifier: "e1",
  calendarId: "cal-1",
  title: "Generic event",
  notes: null,
  location: null,
  url: null,
  startsAt: "2026-05-01T14:00:00.000Z",
  endsAt: "2026-05-01T15:00:00.000Z",
  isAllDay: false,
  isRecurring: false,
};

describe("calendar smartDefaults: resolveSmartDefault", () => {
  it("returns null when no rule matches", () => {
    const event = { ...baseEvent, title: "Some private thing" };
    expect(resolveSmartDefault(event, DEFAULT_SMART_RULES)).toBeNull();
  });

  it("matches 'office hours' as titleOnly", () => {
    const event = { ...baseEvent, title: "Office hours – Wed afternoon" };
    expect(resolveSmartDefault(event, DEFAULT_SMART_RULES)).toBe("titleOnly");
  });

  it("matches case-insensitively (OFFICE HOURS)", () => {
    const event = { ...baseEvent, title: "OFFICE HOURS" };
    expect(resolveSmartDefault(event, DEFAULT_SMART_RULES)).toBe("titleOnly");
  });

  it("matches '1:1 with Alice' as busy", () => {
    const event = { ...baseEvent, title: "1:1 with Alice" };
    expect(resolveSmartDefault(event, DEFAULT_SMART_RULES)).toBe("busy");
  });

  it("matches a private meal as busy", () => {
    expect(
      resolveSmartDefault(
        { ...baseEvent, title: "Lunch with Bob" },
        DEFAULT_SMART_RULES,
      ),
    ).toBe("busy");
    expect(
      resolveSmartDefault(
        { ...baseEvent, title: "Coffee chat" },
        DEFAULT_SMART_RULES,
      ),
    ).toBe("busy");
  });

  it("matches a class meeting like CS5008 as titleOnly", () => {
    const event = { ...baseEvent, title: "CS5008 lab" };
    expect(resolveSmartDefault(event, DEFAULT_SMART_RULES)).toBe("titleOnly");
  });

  it("promotes any event with a URL to titleOnly when nothing else matches", () => {
    const event = {
      ...baseEvent,
      title: "Generic placeholder",
      url: "https://example.com/event",
    };
    expect(resolveSmartDefault(event, DEFAULT_SMART_RULES)).toBe("titleOnly");
  });

  it("a more-specific rule wins over the URL-based fallback", () => {
    // Has a URL AND matches the private-meal pattern. The private-
    // meal rule comes earlier in the list, so its `busy` outcome
    // should beat the catch-all "url → titleOnly".
    const event = {
      ...baseEvent,
      title: "Lunch with Bob",
      url: "https://yelp.com/place/x",
    };
    expect(resolveSmartDefault(event, DEFAULT_SMART_RULES)).toBe("busy");
  });

  it("an invalid regex in localStorage doesn't crash the resolver", () => {
    const rules = [{ id: "bad", pattern: "[unclosed", visibility: "full" as const }];
    expect(() => resolveSmartDefault(baseEvent, rules)).not.toThrow();
    expect(resolveSmartDefault(baseEvent, rules)).toBeNull();
  });
});
