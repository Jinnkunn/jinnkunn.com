import { NextResponse } from "next/server";

import { getLatestPublicCalendarData } from "@/lib/server/public-calendar-data";
import { PUBLIC_CALENDAR_CACHE_TAG } from "@/lib/shared/public-calendar";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET() {
  const data = await getLatestPublicCalendarData();
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, max-age=30, stale-while-revalidate=300",
      "Cache-Tag": PUBLIC_CALENDAR_CACHE_TAG,
    },
  });
}
