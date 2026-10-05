import { NextResponse } from "next/server";

import { loadPublishedSource } from "@/lib/server/publication-review-service";
import { normalizeNowData } from "@jinnkunn/content-core/now";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await loadPublishedSource("now.json");
    const data = normalizeNowData(JSON.parse(snapshot.source || "{}"));
    const sourceVersion = { fileSha: snapshot.snapshotSha };
    return NextResponse.json(
      {
        ok: true,
        data,
        sourceVersion,
        servedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=10, stale-while-revalidate=60",
        },
      },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message, code: "PUBLIC_NOW_FAILED" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
