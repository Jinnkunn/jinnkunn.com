import { NextResponse } from "next/server";

import { getLatestPublicCalendarData } from "@/lib/server/public-calendar-data";
import {
  PUBLIC_CALENDAR_CACHE_TAG,
  PUBLIC_CALENDAR_SERVED_AT_HEADER,
} from "@/lib/shared/public-calendar";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET() {
  const data = await getLatestPublicCalendarData();
  const servedAt = new Date().toISOString();
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, max-age=30, stale-while-revalidate=300",
      "Cache-Tag": PUBLIC_CALENDAR_CACHE_TAG,
      [PUBLIC_CALENDAR_SERVED_AT_HEADER]: servedAt,
    },
  });
}
