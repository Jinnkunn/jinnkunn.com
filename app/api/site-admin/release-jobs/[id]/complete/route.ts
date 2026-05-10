import type { NextRequest } from "next/server";

import { apiError, apiPayloadOk } from "@/lib/server/site-admin-api";
import { requireReleaseAgent } from "@/lib/server/release-agent-auth";
import { completeReleaseJob } from "@/lib/server/release-jobs-service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: RouteContext) {
  const auth = requireReleaseAgent(req);
  if (!auth.ok) return auth.res;
  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const result =
    body.result && typeof body.result === "object" && !Array.isArray(body.result)
      ? (body.result as Record<string, unknown>)
      : {};
  const out = await completeReleaseJob({
    agentId: auth.agentId,
    id,
    status: body.status,
    error: body.error,
    result,
  });
  if (!out.ok) return apiError(out.error, { status: out.status, code: out.code });
  return apiPayloadOk({ job: out.data });
}
