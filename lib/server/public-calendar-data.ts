import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import { normalizePublicCalendarData } from "@/lib/shared/public-calendar";

const CALENDAR_PUBLIC_PATH = path.join(process.cwd(), "content", "calendar-public.json");

export function getPublicCalendarData() {
  try {
    const raw = readFileSync(CALENDAR_PUBLIC_PATH, "utf8");
    return normalizePublicCalendarData(JSON.parse(raw));
  } catch {
    return normalizePublicCalendarData(null);
  }
}
