import { NextResponse } from "next/server";

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

// Signed deploy requests carry tiny JSON bodies (usually `{}` or a
// handful of fields). Reject anything larger to avoid memory pressure
// on Worker / serverless runtimes from a malicious client.
const DEPLOY_MAX_BODY_BYTES = 4 * 1024;

export async function POST(req: Request) {
  return withNoStoreApi(async () => {
    const secret = process.env.DEPLOY_TOKEN?.trim() ?? "";
    if (!secret) {
      return noStoreMisconfigured("DEPLOY_TOKEN");
    }

    const declaredLength = Number(req.headers.get("content-length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > DEPLOY_MAX_BODY_BYTES) {
      return noStoreFailWithCode("Request body too large", {
        status: 413,
        code: "PAYLOAD_TOO_LARGE",
      });
    }

    const rawBody = await req.text();
    if (rawBody.length > DEPLOY_MAX_BODY_BYTES) {
      return noStoreFailWithCode("Request body too large", {
        status: 413,
        code: "PAYLOAD_TOO_LARGE",
      });
    }
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

    const out = await triggerDeployHook();
    if (!out.ok) {
      const message = formatDeployTriggerError(out.status, out.attempts, trimErrorDetail(out.text));
      return noStoreFailWithCode(message, { status: 502, code: "DEPLOY_TRIGGER_FAILED" });
    }

    const triggeredAtIso = new Date().toISOString();
    return noStoreOk({
      triggeredAt: triggeredAtIso,
      status: out.status,
      ...(out.provider ? { provider: out.provider } : {}),
      ...(out.deploymentId ? { deploymentId: out.deploymentId } : {}),
    });
  }, { status: 500, fallback: "Unexpected deploy API error" });
}

export async function GET() {
  return noStoreMethodNotAllowed(["POST"]);
}
