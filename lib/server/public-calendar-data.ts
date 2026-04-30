import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  filterStalePublicCalendarEvents,
  normalizePublicCalendarData,
  type PublicCalendarData,
} from "@/lib/shared/public-calendar";
import { getSiteAdminSourceStore } from "@/lib/server/site-admin-source-store";
import { readPublicCalendarFromDb } from "@/lib/server/public-calendar-db";

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
