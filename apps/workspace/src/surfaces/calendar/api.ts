import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  Calendar,
  CalendarAuthorizationStatus,
  CalendarEvent,
  CalendarSource,
  FetchEventsRequest,
} from "./types";

// Thin wrappers around the EventKit bridge in
// src-tauri/src/calendar/commands.rs. Same convention as lib/tauri.ts —
// every Rust command has exactly one mirror here so command names stay
// off the call sites.

/** Read the current authorization without prompting. Returns
 * `notDetermined` on first launch, before `requestAccess` is called. */
export function calendarAuthorizationStatus(): Promise<CalendarAuthorizationStatus> {
  return invoke("calendar_authorization_status");
}

/** Trigger the system permission prompt. Resolves with the resulting
 * authorization status (e.g. `fullAccess` after user approves). */
export function calendarRequestAccess(): Promise<CalendarAuthorizationStatus> {
  return invoke("calendar_request_access");
}

/** List all account-level sources (iCloud, Exchange, CalDAV, …). One
 * entry per macOS Calendar sidebar header. */
export function calendarListSources(): Promise<CalendarSource[]> {
  return invoke("calendar_list_sources");
}

/** List calendars across all (or a specific) source. When `sourceId` is
 * omitted the bridge returns calendars for every source. */
export function calendarListCalendars(sourceId?: string): Promise<Calendar[]> {
  return invoke("calendar_list_calendars", { sourceId });
}

/** Fetch occurrences in a date range. Recurring events are expanded by
 * EventKit on the Rust side, so each occurrence arrives as its own row. */
export function calendarFetchEvents(
  request: FetchEventsRequest,
): Promise<CalendarEvent[]> {
  return invoke("calendar_fetch_events", { request });
}

export type RecurrenceFrequency = "daily" | "weekly" | "biweekly" | "monthly";

export interface RecurrenceSpec {
  frequency: RecurrenceFrequency;
  /** Total number of occurrences including the first. The Rust side
   * clamps to a safety ceiling (200) so a typo can't generate years
   * of events. */
  count: number;
}

export interface CreateEventRequest {
  calendarId: string;
  title: string;
  /** ISO 8601, e.g. `2026-05-12T14:00:00-04:00`. */
  startsAt: string;
  endsAt: string;
  isAllDay?: boolean;
  notes?: string;
  location?: string;
  url?: string;
  /** When set, the event is created as a recurring series. EKEvent
   * stores it as one row with an attached EKRecurrenceRule, and
   * `fetch_events` later expands the occurrences for any range query. */
  recurrence?: RecurrenceSpec;
}

/** Create a non-recurring event in the chosen calendar. EventKit
 * fires its change notification after the save, so any registered
 * `onCalendarChanged` listener will trigger a refetch and the new
 * event will appear in the visible range automatically. The returned
 * `CalendarEvent` is the saved row re-projected — callers can
 * optimistically splice it into local state without waiting for the
 * notification. */
export function calendarCreateEvent(
  request: CreateEventRequest,
): Promise<CalendarEvent> {
  return invoke("calendar_create_event", { request });
}

/** Subscribe to EKEventStoreChanged. The handler fires whenever any
 * source updates — invalidate caches and re-fetch. Returns the unlisten
 * fn; callers MUST call it on unmount. */
export function onCalendarChanged(handler: () => void): Promise<UnlistenFn> {
  return listen("calendar://changed", () => handler());
}
