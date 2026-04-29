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
