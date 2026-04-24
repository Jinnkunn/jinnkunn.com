import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { apiError, apiPayloadOk, withSiteAdminContext } from "@/lib/server/site-admin-api";
import { postSiteAdminDeployBackend } from "@/lib/server/site-admin-backend-service";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return withSiteAdminContext(
    req,
    async (ctx) => {
      const out = await postSiteAdminDeployBackend();
      await writeSiteAdminAuditLog({
        actor: ctx.login,
        action: "deploy.trigger",
        endpoint: "/api/site-admin/deploy",
        method: "POST",
        status: out.ok ? 200 : out.status,
        result: out.ok ? "success" : "error",
        code: out.ok ? "OK" : out.code,
        message: out.ok ? "" : out.error,
      });
      if (!out.ok) return apiError(out.error, { status: out.status, code: out.code });
      return apiPayloadOk(out.data);
    },
    {
      requireAllowlist: true,
      requireAuthSecret: true,
      // Deploy through the admin UI is less frequent than read
      // polling but still needs to tolerate a burst when a user
      // retries. 20/min per IP balances those forces.
      rateLimit: { namespace: "site-admin-deploy", maxRequests: 20 },
    },
  );
}

export async function GET(req: NextRequest) {
  const url = new URL("/site-admin", req.url);
  url.searchParams.set("legacy", "deploy-api");
  return NextResponse.redirect(url, { status: 307 });
}
