import crypto from "node:crypto";

import {
  noStoreBadRequest,
  noStoreFailFromUnknown,
  noStoreMethodNotAllowed,
  noStoreMisconfigured,
  noStoreOk,
  noStoreUnauthorized,
} from "@/lib/server/api-response";
import {
  createDatabaseRow,
  findFirstRowByFilter,
  getSiteAdminDatabaseIdByTitle,
  notionRowId,
  patchPageProperties,
  type NotionRow,
} from "@/lib/server/site-admin-notion";
import {
  buildDeployLogCreateProperties,
  buildDeployLogUpdateProperties,
} from "@/lib/server/site-admin-writers";

export const runtime = "nodejs";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function normalizeSignature(sig: string): string {
  const s = String(sig || "").trim();
  if (!s) return "";
  if (s.startsWith("sha1=")) return s.slice("sha1=".length);
  return s;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function verifyVercelSignature(opts: { rawBody: string; secret: string; got: string }) {
  const expected = crypto
    .createHmac("sha1", opts.secret)
    .update(opts.rawBody, "utf8")
    .digest("hex");
  const got = normalizeSignature(opts.got);
  if (!got) return false;
  return timingSafeEqualHex(got, expected);
}

function mapEventToResult(eventType: string) {
  switch (eventType) {
    case "deployment.created":
      return "Building";
    case "deployment.ready":
    case "deployment.succeeded":
      return "Ready";
    case "deployment.error":
      return "Error";
    case "deployment.canceled":
      return "Canceled";
    default:
      return "Building";
  }
}

async function findRowByDeploymentId(dbId: string, deploymentId: string) {
  const did = String(deploymentId || "").trim();
  if (!did) return null;
  return findFirstRowByFilter(dbId, {
    property: "Deployment ID",
    rich_text: { equals: did },
  });
}

async function findRecentTriggeredRow(dbId: string, { withinMs }: { withinMs: number }) {
  const afterIso = new Date(Date.now() - withinMs).toISOString();
  return findFirstRowByFilter(
    dbId,
    {
      and: [
        { property: "Result", select: { equals: "Triggered" } },
        { property: "Triggered At", date: { on_or_after: afterIso } },
      ],
    },
    [{ property: "Triggered At", direction: "descending" }],
  );
}

async function upsertDeployLogFromEvent(opts: {
  dbId: string;
  eventType: string;
  eventCreatedAtIso: string;
  deploymentId: string;
  deploymentUrl: string;
  dashboardUrl: string;
  target: string;
}) {
  const result = mapEventToResult(opts.eventType);
  const deploymentId = String(opts.deploymentId || "").trim();

  let row: NotionRow | null = deploymentId
    ? await findRowByDeploymentId(opts.dbId, deploymentId)
    : null;
  if (!row && opts.eventType === "deployment.created") {
    row = await findRecentTriggeredRow(opts.dbId, { withinMs: 10 * 60 * 1000 });
  }

  const properties = buildDeployLogUpdateProperties({
    result,
    lastEvent: opts.eventType,
    deploymentId,
    deploymentUrl: opts.deploymentUrl,
    dashboardUrl: opts.dashboardUrl,
    target: opts.target,
  });

  if (row?.id) {
    await patchPageProperties(notionRowId(row), properties);
    return;
  }

  await createDatabaseRow(
    opts.dbId,
    buildDeployLogCreateProperties({
      triggeredAtIso: opts.eventCreatedAtIso,
      result,
      lastEvent: opts.eventType,
      deploymentId,
      deploymentUrl: opts.deploymentUrl,
      dashboardUrl: opts.dashboardUrl,
      target: opts.target,
    }),
  );
}

export async function POST(req: Request) {
  const secret = process.env.VERCEL_WEBHOOK_SECRET?.trim() ?? "";
  if (!secret) {
    return noStoreMisconfigured("VERCEL_WEBHOOK_SECRET");
  }

  const sig = req.headers.get("x-vercel-signature") ?? "";
  const rawBody = await req.text();
  if (!verifyVercelSignature({ rawBody, secret, got: sig })) {
    return noStoreUnauthorized();
  }

  let evt: unknown = null;
  try {
    evt = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return noStoreBadRequest("Invalid JSON body");
  }

  try {
    const evtObj = asRecord(evt) ?? {};
    const eventType = String(evtObj.type ?? "").trim();
    const payloadObj = asRecord(evtObj.payload) ?? {};
    const deploymentObj = asRecord(payloadObj.deployment) ?? {};
    const linksObj = asRecord(payloadObj.links) ?? {};
    if (!eventType) return noStoreOk({ skipped: true });

    const createdAtMs = Number(evtObj.createdAt ?? Date.now());
    const eventCreatedAtIso = new Date(
      Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
    ).toISOString();

    const deploymentId = String(deploymentObj.id ?? payloadObj.id ?? "").trim();
    const deploymentUrl = String(deploymentObj.url ?? payloadObj.url ?? "").trim();
    const dashboardUrl = String(linksObj.deployment ?? "").trim();
    const target = String(deploymentObj.target ?? "").trim();

    if (!(process.env.NOTION_SITE_ADMIN_PAGE_ID || "").trim()) {
      return noStoreMisconfigured("NOTION_SITE_ADMIN_PAGE_ID");
    }

    const dbId = await getSiteAdminDatabaseIdByTitle("Deploy Logs");
    if (!dbId) return noStoreOk({ skipped: true, reason: "No Deploy Logs DB" });

    // Best-effort: if the DB doesn't have the extra columns, we still want to
    // update `Result` when possible. If it fails, don't retry storm the webhook.
    try {
      await upsertDeployLogFromEvent({
        dbId,
        eventType,
        eventCreatedAtIso,
        deploymentId,
        deploymentUrl,
        dashboardUrl,
        target,
      });
    } catch {
      try {
        // Minimal fallback update: keep only Result.
        const row =
          (eventType === "deployment.created"
            ? await findRecentTriggeredRow(dbId, { withinMs: 10 * 60 * 1000 })
            : null) ?? null;
        if (row?.id) {
          await patchPageProperties(notionRowId(row), {
            Result: { select: { name: mapEventToResult(eventType) } },
          });
        }
      } catch {
        // ignore
      }
    }

    return noStoreOk();
  } catch (e: unknown) {
    return noStoreFailFromUnknown(e, { status: 500 });
  }
}

export async function GET() {
  return noStoreMethodNotAllowed(["POST"]);
}
