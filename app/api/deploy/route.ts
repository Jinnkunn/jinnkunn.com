import { compactId } from "@/lib/shared/route-utils";
import {
  noStoreFail,
  noStoreFailFromUnknown,
  noStoreMisconfigured,
  noStoreOk,
  noStoreUnauthorized,
} from "@/lib/server/api-response";
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

function isAuthorized(req: Request): boolean {
  const expected = process.env.DEPLOY_TOKEN?.trim() ?? "";
  if (!expected) return false;
  const url = new URL(req.url);
  const got = url.searchParams.get("token") ?? "";
  return got === expected;
}

export async function GET(req: Request) {
  if (!process.env.DEPLOY_TOKEN?.trim()) {
    return noStoreMisconfigured("DEPLOY_TOKEN");
  }
  if (!isAuthorized(req)) {
    return noStoreUnauthorized();
  }

  try {
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
  } catch (e: unknown) {
    return noStoreFailFromUnknown(e, { status: 500 });
  }
}

export async function POST(req: Request) {
  // Allow POST as well, but keep the same auth mechanism so Notion "open link"
  // can use GET while other tooling can use POST.
  return GET(req);
}
