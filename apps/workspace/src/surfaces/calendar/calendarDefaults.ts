// Per-calendar default visibility rules.
//
// The original metadata model classified every event individually: each
// EventKit row needed an explicit hidden / busy / titleOnly / full
// choice, defaulting to "busy" if untouched. Reasonable for a few
// events; tedious once the operator has hundreds of recurring class
// meetings or office-hour slots that all want the same disclosure
// level.
//
// This module adds a per-calendar default that the resolver consults
// BEFORE falling back to the global "busy" default. Per-event
// overrides still beat the calendar default (so a single private
// 1:1 inside the otherwise-public Teaching calendar can be hidden
// without disturbing the rest), but the typical case — "everything
// in calendar X starts at visibility Y" — is now a single click.
//
// Storage: workspace-only, in localStorage. Public-site rules already
// have the per-event metadata in D1; this rule sheet stays workspace-
// local because (a) it's UX scaffolding, not the source of truth for
// public projection — once the operator publishes, the resolved
// visibility becomes the per-event metadata for that occurrence; and
// (b) keeping it on the laptop matches how the operator thinks about
// it ("on this machine, treat my Teaching calendar as titleOnly").

import type { CalendarPublicVisibility } from "./publicProjection";

const STORAGE_KEY = "workspace.calendar.calendarDefaults.v1";

interface PersistedShape {
  /** calendarId → default visibility for events in that calendar.
   * Calendars without an entry fall through to the global "busy"
   * default at metadataForEvent time. */
  byCalendarId: Record<string, CalendarPublicVisibility>;
}

export type CalendarDefaultRules = ReadonlyMap<string, CalendarPublicVisibility>;

const VISIBILITY_VALUES = new Set<CalendarPublicVisibility>([
  "hidden",
  "busy",
  "titleOnly",
  "full",
]);

function isVisibility(value: unknown): value is CalendarPublicVisibility {
  return typeof value === "string" && VISIBILITY_VALUES.has(value as CalendarPublicVisibility);
}

export function loadCalendarDefaultRules(): Map<string, CalendarPublicVisibility> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    const out = new Map<string, CalendarPublicVisibility>();
    if (parsed && typeof parsed === "object" && parsed.byCalendarId) {
      for (const [id, vis] of Object.entries(parsed.byCalendarId)) {
        if (isVisibility(vis)) out.set(id, vis);
      }
    }
    return out;
  } catch {
    return new Map();
  }
}

export function saveCalendarDefaultRules(
  rules: ReadonlyMap<string, CalendarPublicVisibility>,
): void {
  try {
    const byCalendarId: Record<string, CalendarPublicVisibility> = {};
    for (const [id, vis] of rules.entries()) {
      byCalendarId[id] = vis;
    }
    const payload: PersistedShape = { byCalendarId };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota / private mode — degrade silently. Defaults reset to
    // "busy" for everything next launch; the per-event metadata is
    // still authoritative.
  }
}

/** Resolve the visibility for an event whose calendar has no
 * per-event override. Honors the calendar's default if set; falls
 * back to the historical "busy" otherwise. Centralized so callers
 * don't have to repeat the chain. */
export function resolveCalendarDefault(
  rules: ReadonlyMap<string, CalendarPublicVisibility>,
  calendarId: string,
): CalendarPublicVisibility {
  return rules.get(calendarId) ?? "busy";
}
