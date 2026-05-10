import type { NextRequest } from "next/server";

import {
  apiError,
  apiPayloadOk,
  withSiteAdminContext,
} from "@/lib/server/site-admin-api";
import { requireReleaseAgent } from "@/lib/server/release-agent-auth";
import {
  appendReleaseJobEvent,
  listReleaseJobEvents,
} from "@/lib/server/release-jobs-service";

export const runtime = "nodejs";

const RATE_LIMIT = { namespace: "site-admin-release-job-events", maxRequests: 120 };

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  return withSiteAdminContext(
    req,
    async () => {
      const { id } = await context.params;
      const url = new URL(req.url);
      const afterSeq = Number(url.searchParams.get("afterSeq") || "0");
      const limit = Number(url.searchParams.get("limit") || "200");
      const out = await listReleaseJobEvents({ id, afterSeq, limit });
      if (!out.ok) return apiError(out.error, { status: out.status, code: out.code });
      return apiPayloadOk(out.data);
    },
    { requireAllowlist: true, requireAuthSecret: true, rateLimit: RATE_LIMIT },
  );
}

export async function POST(req: NextRequest, context: RouteContext) {
  const auth = requireReleaseAgent(req);
  if (!auth.ok) return auth.res;
  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const out = await appendReleaseJobEvent({
    id,
    phase: body.phase,
    stream: body.stream,
    message: body.message,
  });
  if (!out.ok) return apiError(out.error, { status: out.status, code: out.code });
  return apiPayloadOk({ event: out.data });
}

