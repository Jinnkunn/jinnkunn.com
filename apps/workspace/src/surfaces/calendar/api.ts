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

/** Subscribe to EKEventStoreChanged. The handler fires whenever any
 * source updates — invalidate caches and re-fetch. Returns the unlisten
 * fn; callers MUST call it on unmount. */
export function onCalendarChanged(handler: () => void): Promise<UnlistenFn> {
  return listen("calendar://changed", () => handler());
}
