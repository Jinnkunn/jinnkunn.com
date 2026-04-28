import { NextResponse } from "next/server";

import { getLatestPublicCalendarData } from "@/lib/server/public-calendar-data";

export const runtime = "nodejs";

export async function GET() {
  const data = await getLatestPublicCalendarData();
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, max-age=30, stale-while-revalidate=300",
    },
  });
}
