import type { NextRequest } from "next/server";

import { apiError, apiPayloadOk } from "@/lib/server/site-admin-api";
import { requireReleaseAgent } from "@/lib/server/release-agent-auth";
import {
  getReleaseJob,
  touchRunningReleaseAgent,
} from "@/lib/server/release-jobs-service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  const auth = requireReleaseAgent(req);
  if (!auth.ok) return auth.res;
  const { id } = await context.params;
  const out = await getReleaseJob({ id });
  if (!out.ok) return apiError(out.error, { status: out.status, code: out.code });
  if (out.data.job.status === "running" && out.data.job.agentId === auth.agentId) {
    await touchRunningReleaseAgent({
      agentId: auth.agentId,
      currentJobId: out.data.job.id,
    });
  }
  return apiPayloadOk({ job: out.data.job });
}
