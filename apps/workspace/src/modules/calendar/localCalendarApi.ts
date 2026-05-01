import { invoke } from "@tauri-apps/api/core";

import type {
  Calendar,
  CalendarEvent,
  CalendarSource,
  FetchEventsRequest,
} from "../../surfaces/calendar/types";

/** Synthetic source id used for the local-first workspace calendar.
 * Mirrors `LOCAL_SOURCE_ID` in `src-tauri/src/local_calendar.rs`; keep
 * the two in lockstep. The frontend prepends a synthetic
 * `CalendarSource` row with this id so per-source ordering and
 * collapse prefs (keyed by source id) keep working across launches. */
export const LOCAL_CALENDAR_SOURCE_ID = "workspace-local";
export const LOCAL_CALENDAR_SOURCE_TITLE = "Workspace";

/** Helper used by the calendar surface to short-circuit any code path
 * that's specific to EventKit calendars (publishing rules, etc.). */
export function isLocalCalendarSource(sourceId: string): boolean {
  return sourceId === LOCAL_CALENDAR_SOURCE_ID;
}

export function isLocalCalendarId(id: string): boolean {
  return id.startsWith("lcal_");
}

export function isLocalEventId(id: string): boolean {
  return id.startsWith("levt_");
}

/** Synthetic source row injected into the source list so the local
 * calendar shows up as its own group in the sidebar. */
export const LOCAL_CALENDAR_SOURCE: CalendarSource = {
  id: LOCAL_CALENDAR_SOURCE_ID,
  title: LOCAL_CALENDAR_SOURCE_TITLE,
  sourceType: "local",
};

/** Local calendar row as returned by the Rust bridge. The shape mirrors
 * `Calendar` (sourceId/title/colorHex/allowsModifications) plus a few
 * audit timestamps the inspector pane uses. */
export interface LocalCalendarRow extends Calendar {
  sortOrder: number;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface LocalCalendarEventRow extends CalendarEvent {
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface LocalCalendarCreateParams {
  title?: string | null;
  colorHex?: string | null;
}

export interface LocalCalendarUpdateParams {
  id: string;
  title?: string;
  colorHex?: string;
}

export interface LocalEventCreateParams {
  calendarId: string;
  title: string;
  /** ISO 8601 with offset, e.g. `2026-04-30T10:00:00-04:00`. */
  startsAt: string;
  endsAt: string;
  isAllDay?: boolean;
  notes?: string | null;
  location?: string | null;
  url?: string | null;
}

export interface LocalEventUpdateParams {
  id: string;
  calendarId?: string;
  title?: string;
  startsAt?: string;
  endsAt?: string;
  isAllDay?: boolean;
  notes?: string | null;
  location?: string | null;
  url?: string | null;
}

export function localCalendarListCalendars(): Promise<LocalCalendarRow[]> {
  return invoke("local_calendar_list_calendars");
}

export function localCalendarCreateCalendar(
  params: LocalCalendarCreateParams,
): Promise<LocalCalendarRow> {
  return invoke("local_calendar_create_calendar", { params });
}

export function localCalendarUpdateCalendar(
  params: LocalCalendarUpdateParams,
): Promise<LocalCalendarRow> {
  return invoke("local_calendar_update_calendar", { params });
}

export function localCalendarArchiveCalendar(id: string): Promise<void> {
  return invoke("local_calendar_archive_calendar", { id });
}

export function localCalendarFetchEvents(
  request: FetchEventsRequest,
): Promise<LocalCalendarEventRow[]> {
  return invoke("local_calendar_fetch_events", { request });
}

export function localCalendarCreateEvent(
  params: LocalEventCreateParams,
): Promise<LocalCalendarEventRow> {
  return invoke("local_calendar_create_event", { params });
}

export function localCalendarUpdateEvent(
  params: LocalEventUpdateParams,
): Promise<LocalCalendarEventRow> {
  return invoke("local_calendar_update_event", { params });
}

export function localCalendarArchiveEvent(id: string): Promise<void> {
  return invoke("local_calendar_archive_event", { id });
}

export function localCalendarUnarchiveEvent(
  id: string,
): Promise<LocalCalendarEventRow> {
  return invoke("local_calendar_unarchive_event", { id });
}
