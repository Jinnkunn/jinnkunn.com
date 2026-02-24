import type { NextRequest } from "next/server";

import { apiError, apiPayloadOk, withSiteAdmin } from "@/lib/server/site-admin-api";
import { triggerDeployHook } from "@/lib/server/deploy-hook";
import type { SiteAdminDeployPayload } from "@/lib/site-admin/api-types";

export const runtime = "nodejs";

function deployErrorMessage(status: number, attempts: number, detail: string): string {
  const suffix = detail ? `: ${detail}` : "";
  return `Failed to trigger deploy (status ${status}, attempts ${attempts})${suffix}`;
}

function trimDetail(text: string): string {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.slice(0, 200);
}

export async function POST(req: NextRequest) {
  return withSiteAdmin(
    req,
    async () => {
      const triggeredAtIso = new Date().toISOString();
      const out = await triggerDeployHook();

      if (!out.ok) {
        return apiError(
          deployErrorMessage(out.status, out.attempts, trimDetail(out.text)),
          { status: 502 },
        );
      }

      const payload: Omit<SiteAdminDeployPayload, "ok"> = {
        triggeredAt: triggeredAtIso,
        status: out.status,
      };
      return apiPayloadOk<SiteAdminDeployPayload>(payload);
    },
    {
      requireAllowlist: true,
      requireAuthSecret: true,
    },
  );
}
