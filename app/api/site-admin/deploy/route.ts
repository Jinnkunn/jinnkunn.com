import type { NextRequest } from "next/server";

import { apiError, apiOk, withSiteAdmin } from "@/lib/server/site-admin-api";
import type { SiteAdminDeployPayload } from "@/lib/site-admin/api-types";

export const runtime = "nodejs";

async function triggerDeploy(): Promise<{ ok: boolean; status: number; text: string }> {
  const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL?.trim() ?? "";
  if (!hookUrl) return { ok: false, status: 500, text: "Missing VERCEL_DEPLOY_HOOK_URL" };

  const res = await fetch(hookUrl, { method: "POST" });
  const text = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, text };
}

export async function POST(req: NextRequest) {
  return withSiteAdmin(
    req,
    async () => {
      const triggeredAtIso = new Date().toISOString();
      const out = await triggerDeploy();

      if (!out.ok) {
        return apiError(`Failed to trigger deploy (status ${out.status})`, { status: 502 });
      }

      const payload: Omit<SiteAdminDeployPayload, "ok"> = {
        triggeredAt: triggeredAtIso,
        status: out.status,
      };
      return apiOk(payload);
    },
    {
      requireAllowlist: true,
      requireAuthSecret: true,
    },
  );
}
