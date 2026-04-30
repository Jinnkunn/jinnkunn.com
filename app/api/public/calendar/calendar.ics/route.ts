import { NextResponse } from "next/server";

import { getLatestPublicCalendarData } from "@/lib/server/public-calendar-data";
import { buildPublicCalendarIcs } from "@/lib/shared/calendar-ics";
import { PUBLIC_CALENDAR_CACHE_TAG } from "@/lib/shared/public-calendar";

// Public calendar feed in RFC 5545 form. The JSON sibling at
// /api/public/calendar serves the same data for the workspace's
// own /calendar page; this route exists so external subscribers
// (Apple Calendar, Outlook, Google Calendar, GNOME Evolution …)
// can `webcal://jinkunchen.com/calendar.ics` and keep an auto-
// updating local copy.
//
// Same five-minute revalidation + cache-tag as the JSON endpoint
// so a workspace promote picks up both feeds in one purge. The
// content-type matters: clients sniff `text/calendar`, NOT
// application/json, and refuse to subscribe otherwise.

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET() {
  const data = await getLatestPublicCalendarData();
  const body = buildPublicCalendarIcs(data);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // `inline; filename=...` so a browser visiting the URL renders
      // it as text the user can copy, while a calendar client follows
      // the webcal:// scheme and subscribes. Both flows share the
      // same body.
      "Content-Disposition": 'inline; filename="jinkunchen-calendar.ics"',
      "Cache-Control": "public, max-age=30, stale-while-revalidate=300",
      "Cache-Tag": PUBLIC_CALENDAR_CACHE_TAG,
    },
  });
}
