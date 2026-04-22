import { NextResponse } from "next/server";

import { compactId } from "@/lib/shared/route-utils";
import {
  formatDeployTriggerError,
  noStoreFailWithCode,
  noStoreMethodNotAllowed,
  noStoreMisconfigured,
  noStoreOk,
  trimErrorDetail,
  withNoStoreApi,
} from "@/lib/server/api-response";
import { authorizeDeployRequest } from "@/lib/server/deploy-auth";
import { triggerDeployHook } from "@/lib/server/deploy-hook";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return withNoStoreApi(async () => {
    const secret = process.env.DEPLOY_TOKEN?.trim() ?? "";
    if (!secret) {
      return noStoreMisconfigured("DEPLOY_TOKEN");
    }

    const rawBody = await req.text();
    const auth = authorizeDeployRequest(req, rawBody, secret);
    if (!auth.ok) {
      if (auth.status === 429) {
        return NextResponse.json(
          { ok: false, error: auth.error, code: "RATE_LIMITED" },
          {
            status: 429,
            headers: {
              "cache-control": "no-store",
              "retry-after": String(auth.retryAfterSec ?? 60),
            },
          },
        );
      }
      return noStoreFailWithCode(auth.error, { status: auth.status, code: "UNAUTHORIZED" });
    }

    const triggeredAtIso = new Date().toISOString();
    const out = await triggerDeployHook();
    if (!out.ok) {
      const message = formatDeployTriggerError(out.status, out.attempts, trimErrorDetail(out.text));
      return noStoreFailWithCode(message, { status: 502, code: "DEPLOY_TRIGGER_FAILED" });
    }

    return noStoreOk({ triggeredAt: triggeredAtIso, status: out.status });
  }, { status: 500, fallback: "Unexpected deploy API error" });
}

export async function GET() {
  return noStoreMethodNotAllowed(["POST"]);
}
