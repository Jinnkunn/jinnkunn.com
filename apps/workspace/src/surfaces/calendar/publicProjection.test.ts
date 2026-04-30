import { describe, expect, it } from "vitest";

import {
  buildPublicCalendarPayload,
  emptyMetadataStore,
  metadataForEvent,
} from "./publicProjection";
import type { Calendar, CalendarEvent } from "./types";

const event: CalendarEvent = {
  eventIdentifier: "event-1",
  externalIdentifier: "external-1",
  calendarId: "calendar-1",
  title: "Private appointment",
  notes: "private notes",
  location: "private room",
  url: "https://example.com/private",
  startsAt: "2026-04-28T14:00:00.000Z",
  endsAt: "2026-04-28T15:00:00.000Z",
  isAllDay: false,
  isRecurring: false,
};

const calendar: Calendar = {
  id: "calendar-1",
  sourceId: "source-1",
  title: "Work",
  colorHex: "#3366AA",
  allowsModifications: true,
};

describe("calendar public projection", () => {
  it("applies a per-calendar default visibility when no per-event override is set", () => {
    const metadata = emptyMetadataStore();
    const calendarDefaults = new Map([[calendar.id, "titleOnly" as const]]);
    expect(
      metadataForEvent(metadata, event, calendarDefaults).visibility,
    ).toBe("titleOnly");
  });

  it("per-event override beats per-calendar default", () => {
    let metadata = emptyMetadataStore();
    metadata = {
      schemaVersion: 1,
      byEventKey: { "external-1": { visibility: "hidden" } },
    };
    const calendarDefaults = new Map([[calendar.id, "full" as const]]);
    expect(
      metadataForEvent(metadata, event, calendarDefaults).visibility,
    ).toBe("hidden");
  });

  it("falls back to global busy when neither per-event nor per-calendar rule is set", () => {
    const metadata = emptyMetadataStore();
    expect(metadataForEvent(metadata, event, new Map()).visibility).toBe("busy");
  });

  it("smart resolver runs between per-event override and per-calendar default", () => {
    const metadata = emptyMetadataStore();
    const calendarDefaults = new Map([[calendar.id, "busy" as const]]);
    // Smart resolver bumps to titleOnly; that should beat the calendar
    // default but lose to a per-event override.
    const smartResolver = () => "titleOnly" as const;
    expect(
      metadataForEvent(metadata, event, calendarDefaults, smartResolver)
        .visibility,
    ).toBe("titleOnly");
    // Per-event override stays authoritative.
    const withOverride = {
      schemaVersion: 1 as const,
      byEventKey: { "external-1": { visibility: "hidden" as const } },
    };
    expect(
      metadataForEvent(withOverride, event, calendarDefaults, smartResolver)
        .visibility,
    ).toBe("hidden");
    // Smart resolver returning null falls through to the calendar default.
    expect(
      metadataForEvent(metadata, event, calendarDefaults, () => null).visibility,
    ).toBe("busy");
  });

  it("defaults unconfigured events to busy without leaking details", () => {
    const metadata = emptyMetadataStore();
    expect(metadataForEvent(metadata, event).visibility).toBe("busy");

    const payload = buildPublicCalendarPayload({
      events: [event],
      calendarsById: new Map([[calendar.id, calendar]]),
      metadata,
      range: {
        startsAt: "2026-04-28T00:00:00.000Z",
        endsAt: "2026-04-29T00:00:00.000Z",
      },
    });

    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]).toMatchObject({
      id: "external-1",
      title: "Busy",
      visibility: "busy",
      calendarId: undefined,
      calendarTitle: undefined,
      colorHex: "#9B9A97",
      description: null,
      location: null,
      url: null,
    });
  });

  it("rounds and merges busy blocks while filtering non-work availability noise", () => {
    const payload = buildPublicCalendarPayload({
      events: [
        {
          ...event,
          eventIdentifier: "busy-1",
          externalIdentifier: "busy-1",
          startsAt: "2026-04-28T14:07:00.000Z",
          endsAt: "2026-04-28T14:21:00.000Z",
        },
        {
          ...event,
          eventIdentifier: "busy-2",
          externalIdentifier: "busy-2",
          startsAt: "2026-04-28T14:22:00.000Z",
          endsAt: "2026-04-28T14:46:00.000Z",
        },
        {
          ...event,
          eventIdentifier: "birthday",
          externalIdentifier: "birthday",
          title: "Birthday",
        },
        {
          ...event,
          calendarId: "holidays",
          eventIdentifier: "holiday",
          externalIdentifier: "holiday",
          title: "Stat Holiday",
        },
      ],
      calendarsById: new Map([
        [calendar.id, calendar],
        ["holidays", { ...calendar, id: "holidays", title: "Holidays" }],
      ]),
      metadata: emptyMetadataStore(),
      range: {
        startsAt: "2026-04-28T00:00:00.000Z",
        endsAt: "2026-04-29T00:00:00.000Z",
      },
    });

    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]).toMatchObject({
      title: "Busy",
      visibility: "busy",
      startsAt: "2026-04-28T14:00:00.000Z",
      endsAt: "2026-04-28T15:00:00.000Z",
      colorHex: "#9B9A97",
    });
  });
});
