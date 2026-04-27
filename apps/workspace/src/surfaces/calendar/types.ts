/** TypeScript mirrors of Rust types exposed by the EventKit bridge.
 *
 * Keep these in lockstep with `src-tauri/src/calendar/types.rs`. There is
 * no codegen — this is intentional, matching the project-wide manual-mirror
 * convention noted in RUST_AUDIT.md. */

/** Mirror of `EKAuthorizationStatus`. `writeOnly` only appears on macOS 14+
 * / iOS 17+ when the app holds the partial-access entitlement. */
export type CalendarAuthorizationStatus =
  | "notDetermined"
  | "restricted"
  | "denied"
  | "fullAccess"
  | "writeOnly";

/** Mirror of `EKSourceType`. `local` covers on-device calendars, `birthdays`
 * is the synthesised contacts source, `subscribed` is read-only ICS feeds. */
export type CalendarSourceType =
  | "local"
  | "exchange"
  | "calDAV"
  | "mobileMe"
  | "subscribed"
  | "birthdays";

/** A top-level account container — one entry per row in the macOS Calendar
 * sidebar's account headers (e.g. "iCloud", "i@jinnkunn.com"). */
export interface CalendarSource {
  id: string;
  title: string;
  sourceType: CalendarSourceType;
}

/** A calendar within a source. `colorHex` is `#RRGGBB`, derived from the
 * `EKCalendar.cgColor` so we can render the same chip the system Calendar
 * app uses. `allowsModifications` is false for subscribed/holiday feeds. */
export interface Calendar {
  id: string;
  sourceId: string;
  title: string;
  colorHex: string;
  allowsModifications: boolean;
}

/** A single occurrence — recurring events are pre-expanded by EventKit
 * inside `fetch_events`, so each instance arrives as its own record. The
 * `eventIdentifier` is per-occurrence; `calendarItemExternalIdentifier` is
 * stable across devices and is what we'll key our own metadata by. */
export interface CalendarEvent {
  eventIdentifier: string;
  externalIdentifier: string | null;
  calendarId: string;
  title: string;
  notes: string | null;
  location: string | null;
  url: string | null;
  /** ISO 8601 with timezone, e.g. "2026-04-27T10:00:00-04:00". */
  startsAt: string;
  endsAt: string;
  isAllDay: boolean;
  /** True when this row was synthesised from an RRULE expansion. */
  isRecurring: boolean;
}

export interface FetchEventsRequest {
  /** Inclusive start, ISO 8601. */
  startsAt: string;
  /** Exclusive end, ISO 8601. */
  endsAt: string;
  /** When empty, fetches across all calendars the user has visible. */
  calendarIds: string[];
}
