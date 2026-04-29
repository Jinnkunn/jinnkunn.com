import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import { normalizePublicCalendarData } from "@/lib/shared/public-calendar";
import { getSiteAdminSourceStore } from "@/lib/server/site-admin-source-store";
import { readPublicCalendarFromDb } from "@/lib/server/public-calendar-db";

const CALENDAR_PUBLIC_PATH = path.join(process.cwd(), "content", "calendar-public.json");
const CALENDAR_PUBLIC_REL_PATH = "content/calendar-public.json";

export function getPublicCalendarData() {
  try {
    const raw = readFileSync(CALENDAR_PUBLIC_PATH, "utf8");
    return normalizePublicCalendarData(JSON.parse(raw));
  } catch {
    return normalizePublicCalendarData(null);
  }
}

export async function getLatestPublicCalendarData() {
  const dbData = await readPublicCalendarFromDb();
  if (dbData) return dbData;
  try {
    const store = getSiteAdminSourceStore();
    const file = await store.readTextFile(CALENDAR_PUBLIC_REL_PATH);
    if (!file) return getPublicCalendarData();
    return normalizePublicCalendarData(JSON.parse(file.content));
  } catch {
    return getPublicCalendarData();
  }
}
