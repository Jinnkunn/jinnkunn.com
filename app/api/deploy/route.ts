import { NextResponse } from "next/server";

import { compactId } from "@/lib/shared/route-utils";
import {
  noStoreFail,
  noStoreMethodNotAllowed,
  noStoreMisconfigured,
  noStoreOk,
  withNoStoreApi,
} from "@/lib/server/api-response";
import { authorizeDeployRequest } from "@/lib/server/deploy-auth";
import { triggerDeployHook } from "@/lib/server/deploy-hook";
import { createDatabaseRow, getSiteAdminDatabaseIdByTitle } from "@/lib/server/site-admin-notion";
import { buildDeployLogCreateProperties } from "@/lib/server/site-admin-writers";

export const runtime = "nodejs";

async function logDeployToNotion(opts: {
  reqUrl: string;
  ok: boolean;
  status: number;
  message: string;
  triggeredAtIso: string;
}) {
  const adminPageId = compactId(
    process.env.NOTION_SITE_ADMIN_PAGE_ID?.trim() ?? "",
  );
  if (!adminPageId) return;

  const dbId = await getSiteAdminDatabaseIdByTitle("Deploy Logs");
  if (!dbId) return;
  await createDatabaseRow(
    dbId,
    buildDeployLogCreateProperties({
      triggeredAtIso: opts.triggeredAtIso,
      result: opts.ok ? "Triggered" : "Failed",
      httpStatus: opts.status,
      requestUrl: opts.reqUrl,
      message: opts.message,
    }),
  );
}

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
          { ok: false, error: auth.error },
          {
            status: 429,
            headers: {
              "cache-control": "no-store",
              "retry-after": String(auth.retryAfterSec ?? 60),
            },
          },
        );
      }
      return noStoreFail(auth.error, { status: auth.status });
    }

    const triggeredAtIso = new Date().toISOString();
    const out = await triggerDeployHook();
    if (!out.ok) {
      // Best-effort logging (don't fail deploy trigger because upstream logging failed).
      try {
        await logDeployToNotion({
          reqUrl: req.url,
          ok: false,
          status: out.status,
          message: out.text || `Failed to trigger deploy (status ${out.status})`,
          triggeredAtIso,
        });
      } catch {
        // ignore
      }
      return noStoreFail(`Failed to trigger deploy (status ${out.status})`, { status: 502 });
    }

    try {
      await logDeployToNotion({
        reqUrl: req.url,
        ok: true,
        status: out.status,
        message: out.text || "",
        triggeredAtIso,
      });
    } catch {
      // ignore
    }

    return noStoreOk({ triggeredAt: triggeredAtIso, status: out.status });
  }, { status: 500, fallback: "Unexpected deploy API error" });
}

export async function GET() {
  return noStoreMethodNotAllowed(["POST"]);
}
