import type { NextRequest } from "next/server";

import { apiError, apiOk, withSiteAdminContext } from "@/lib/server/site-admin-api";

export const runtime = "nodejs";

// Higher rate-limit ceiling than the editor endpoints — the Tauri sync
// engine polls this on a timer (default ~30s) plus extra pulls when
// pages are heavily edited. 120/min per IP is comfortable for a single
// active workspace without softening the throttle for the rest of the
// admin surface.
const RATE_LIMIT = { namespace: "site-admin-sync-pull", maxRequests: 120 };

export async function GET(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async () => {
      const url = new URL(req.url);
      const sinceRaw = url.searchParams.get("since");
      const limitRaw = url.searchParams.get("limit");
      const since = sinceRaw === null ? 0 : Number(sinceRaw);
      const limit = limitRaw === null ? null : Number(limitRaw);

      const { pullSyncBatch } = await import(
        "@/lib/server/site-admin-sync-service"
      );
      const result = await pullSyncBatch({ since, limit });
      if (!result.ok) {
        return apiError(result.error, { status: 412, code: result.code });
      }
      return apiOk({
        rows: result.rows,
        nextSince: result.nextSince,
        hasMore: result.hasMore,
      });
    },
    { rateLimit: RATE_LIMIT },
  );
}
