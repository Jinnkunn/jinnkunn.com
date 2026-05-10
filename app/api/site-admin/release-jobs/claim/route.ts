import type { NextRequest } from "next/server";

import { apiError, apiPayloadOk } from "@/lib/server/site-admin-api";
import { requireReleaseAgent } from "@/lib/server/release-agent-auth";
import { claimReleaseJob } from "@/lib/server/release-jobs-service";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = requireReleaseAgent(req);
  if (!auth.ok) return auth.res;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const agentId =
    typeof body.agentId === "string" && body.agentId.trim()
      ? body.agentId.trim()
      : auth.agentId;
  const out = await claimReleaseJob({
    agentId,
    capabilities: Array.isArray(body.capabilities) ? body.capabilities : undefined,
  });
  if (!out.ok) return apiError(out.error, { status: out.status, code: out.code });
  return apiPayloadOk(out.data);
}

