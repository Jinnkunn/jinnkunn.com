import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  filterStalePublicCalendarEvents,
  normalizePublicCalendarData,
  type PublicCalendarData,
  type PublicCalendarEvent,
} from "@/lib/shared/public-calendar";
import { getSiteAdminSourceStore } from "@/lib/server/site-admin-source-store";
import {
  readPublicCalendarEventFromDb,
  readPublicCalendarFromDb,
} from "@/lib/server/public-calendar-db";

const CALENDAR_PUBLIC_PATH = path.join(process.cwd(), "content", "calendar-public.json");
const CALENDAR_PUBLIC_REL_PATH = "content/calendar-public.json";

// Time-decay archive: events older than the default 30-day window are
// dropped before the public surfaces (page, JSON endpoint, ICS feed)
// see them. Avoids the agenda growing unbounded as semesters add up,
// and keeps the response payload small. The
// `…WithArchive` variants below skip this filter so a deep-link to a
// past event detail page still resolves.
function withDecay(data: PublicCalendarData): PublicCalendarData {
  return filterStalePublicCalendarEvents(data);
}

function readFromDisk(): PublicCalendarData {
  try {
    const raw = readFileSync(CALENDAR_PUBLIC_PATH, "utf8");
    return normalizePublicCalendarData(JSON.parse(raw));
  } catch {
    return normalizePublicCalendarData(null);
  }
}

export function getPublicCalendarData(): PublicCalendarData {
  return withDecay(readFromDisk());
}

export async function getLatestPublicCalendarData(): Promise<PublicCalendarData> {
  const dbData = await readPublicCalendarFromDb();
  if (dbData) return withDecay(dbData);
  try {
    const store = getSiteAdminSourceStore();
    const file = await store.readTextFile(CALENDAR_PUBLIC_REL_PATH);
    if (!file) return getPublicCalendarData();
    return withDecay(normalizePublicCalendarData(JSON.parse(file.content)));
  } catch {
    return getPublicCalendarData();
  }
}

/** Per-id detail lookup. The /calendar/[id] route uses this instead
 * of scanning the full agenda payload — D1 has the events keyed by
 * id, so a single indexed read returns the row directly. Falls
 * through to a full-archive scan when D1 isn't bound (preview
 * builds, dev) so the route never 500s on missing infrastructure. */
export async function getPublicCalendarEventById(
  id: string,
): Promise<PublicCalendarEvent | null> {
  const fromDb = await readPublicCalendarEventFromDb(id);
  if (fromDb) return fromDb;
  // D1 missing or no row — fall back to the file-backed archive scan.
  // Costs O(N) but only fires on dev / preview / fresh-install paths,
  // where N is small enough that the difference is invisible.
  const data = await getLatestPublicCalendarDataWithArchive();
  return data.events.find((event) => event.id === id) ?? null;
}

/** Unfiltered variant for the per-event detail page. Lets a
 * shareable `/calendar/{id}` link resolve even after the event has
 * passed the time-decay cutoff — the agenda lists drop the past, but
 * a direct link still answers. */
export async function getLatestPublicCalendarDataWithArchive(): Promise<PublicCalendarData> {
  const dbData = await readPublicCalendarFromDb();
  if (dbData) return dbData;
  try {
    const store = getSiteAdminSourceStore();
    const file = await store.readTextFile(CALENDAR_PUBLIC_REL_PATH);
    if (!file) return readFromDisk();
    return normalizePublicCalendarData(JSON.parse(file.content));
  } catch {
    return readFromDisk();
  }
}
