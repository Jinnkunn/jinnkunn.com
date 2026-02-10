import crypto from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const NOTION_API = "https://api.notion.com/v1";

type NotionListResponse<T> = {
  results?: T[];
  has_more?: boolean;
  next_cursor?: string | null;
};

type NotionChildDatabaseBlock = {
  id: string;
  type?: string;
  child_database?: { title?: string };
};

type NotionPage = {
  id?: string;
} & Record<string, unknown>;

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function json(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
) {
  return NextResponse.json(body, {
    status: init?.status,
    headers: {
      "cache-control": "no-store",
      ...(init?.headers ?? {}),
    },
  });
}

function compactNotionId(idOrUrl: string): string {
  const s = String(idOrUrl || "").trim();
  const m =
    s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) ||
    s.match(/[0-9a-f]{32}/i);
  if (!m) return "";
  return m[0].replace(/-/g, "").toLowerCase();
}

function richText(content: string) {
  const c = String(content ?? "").trim();
  if (!c) return [];
  return [{ type: "text", text: { content: c } }];
}

function safeUrl(u: string): string {
  const s = String(u || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s.replace(/^\/+/, "")}`;
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

async function notionRequest(
  pathname: string,
  {
    method = "GET",
    body,
    searchParams,
  }: {
    method?: string;
    body?: unknown;
    searchParams?: Record<string, string | number | undefined>;
  } = {},
): Promise<unknown> {
  const token = process.env.NOTION_TOKEN?.trim() ?? "";
  const notionVersion = process.env.NOTION_VERSION?.trim() ?? "2022-06-28";
  if (!token) throw new Error("Missing NOTION_TOKEN");

  const url = new URL(`${NOTION_API}/${pathname}`);
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      if (v === undefined) continue;
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": notionVersion,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }
  if (!res.ok) {
    throw new Error(
      `Upstream API error ${res.status} for ${pathname}: ${text?.slice(0, 180)}`,
    );
  }
  return json;
}

async function findDeployLogsDbId(adminPageId: string): Promise<string | null> {
  let cursor: string | undefined = undefined;
  for (let page = 0; page < 6; page++) {
    const data = (await notionRequest(`blocks/${adminPageId}/children`, {
      searchParams: { page_size: 100, start_cursor: cursor },
    })) as NotionListResponse<NotionChildDatabaseBlock>;

    const results = Array.isArray(data?.results) ? data.results : [];
    for (const b of results) {
      if (b?.type !== "child_database") continue;
      const title = String(b?.child_database?.title ?? "").trim().toLowerCase();
      if (title === "deploy logs") return compactNotionId(b.id);
    }

    if (!data?.has_more) break;
    cursor = data?.next_cursor ?? undefined;
    if (!cursor) break;
  }
  return null;
}

async function queryDatabase(
  databaseId: string,
  body: Record<string, unknown>,
): Promise<NotionPage[]> {
  const out: NotionPage[] = [];
  let cursor: string | undefined = undefined;

  for (let page = 0; page < 10; page++) {
    const data = (await notionRequest(`databases/${databaseId}/query`, {
      method: "POST",
      body: {
        page_size: 100,
        start_cursor: cursor,
        ...body,
      },
    })) as NotionListResponse<NotionPage>;

    const results = Array.isArray(data?.results) ? data.results : [];
    out.push(...results);
    if (!data?.has_more) break;
    cursor = data?.next_cursor ?? undefined;
    if (!cursor) break;
  }
  return out;
}

async function updatePageProperties(pageId: string, properties: Record<string, unknown>) {
  await notionRequest(`pages/${pageId}`, {
    method: "PATCH",
    body: { properties },
  });
}

async function createDbRow(databaseId: string, properties: Record<string, unknown>) {
  return notionRequest("pages", {
    method: "POST",
    body: {
      parent: { database_id: databaseId },
      properties,
    },
  });
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
  const rows = await queryDatabase(dbId, {
    filter: {
      property: "Deployment ID",
      rich_text: { equals: did },
    },
  });
  return rows[0] ?? null;
}

async function findRecentTriggeredRow(dbId: string, { withinMs }: { withinMs: number }) {
  const afterIso = new Date(Date.now() - withinMs).toISOString();
  const rows = await queryDatabase(dbId, {
    filter: {
      and: [
        { property: "Result", select: { equals: "Triggered" } },
        { property: "Triggered At", date: { on_or_after: afterIso } },
      ],
    },
    sorts: [{ property: "Triggered At", direction: "descending" }],
  });
  return rows[0] ?? null;
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

  let row = deploymentId ? await findRowByDeploymentId(opts.dbId, deploymentId) : null;
  if (!row && opts.eventType === "deployment.created") {
    row = await findRecentTriggeredRow(opts.dbId, { withinMs: 10 * 60 * 1000 });
  }

  const properties: Record<string, unknown> = {
    Result: { select: { name: result } },
    "Last Event": { rich_text: richText(opts.eventType) },
  };
  if (deploymentId) properties["Deployment ID"] = { rich_text: richText(deploymentId) };
  if (opts.deploymentUrl) properties.Deployment = { url: safeUrl(opts.deploymentUrl) };
  if (opts.dashboardUrl) properties.Dashboard = { url: safeUrl(opts.dashboardUrl) };
  if (opts.target) properties.Target = { select: { name: opts.target } };

  if (row?.id) {
    await updatePageProperties(compactNotionId(row.id), properties);
    return;
  }

  const name = `Deploy @ ${opts.eventCreatedAtIso.replace("T", " ").replace("Z", " UTC")}`;
  await createDbRow(opts.dbId, {
    Name: { title: richText(name) },
    "Triggered At": { date: { start: opts.eventCreatedAtIso } },
    ...properties,
  });
}

export async function POST(req: Request) {
  const secret = process.env.VERCEL_WEBHOOK_SECRET?.trim() ?? "";
  if (!secret) {
    return json(
      { ok: false, error: "Server misconfigured: missing VERCEL_WEBHOOK_SECRET" },
      { status: 500 },
    );
  }

  const sig = req.headers.get("x-vercel-signature") ?? "";
  const rawBody = await req.text();
  if (!verifyVercelSignature({ rawBody, secret, got: sig })) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let evt: unknown = null;
  try {
    evt = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const evtObj = asRecord(evt) ?? {};
  const eventType = String(evtObj.type ?? "").trim();
  const payloadObj = asRecord(evtObj.payload) ?? {};
  const deploymentObj = asRecord(payloadObj.deployment) ?? {};
  const linksObj = asRecord(payloadObj.links) ?? {};
  if (!eventType) return json({ ok: true, skipped: true });

  const createdAtMs = Number(evtObj.createdAt ?? Date.now());
  const eventCreatedAtIso = new Date(
    Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
  ).toISOString();

  const deploymentId = String(deploymentObj.id ?? payloadObj.id ?? "").trim();
  const deploymentUrl = String(deploymentObj.url ?? payloadObj.url ?? "").trim();
  const dashboardUrl = String(linksObj.deployment ?? "").trim();
  const target = String(deploymentObj.target ?? "").trim();

  const adminPageId = compactNotionId(
    process.env.NOTION_SITE_ADMIN_PAGE_ID?.trim() ?? "",
  );
  if (!adminPageId) {
    return json(
      { ok: false, error: "Server misconfigured: missing NOTION_SITE_ADMIN_PAGE_ID" },
      { status: 500 },
    );
  }

  const dbId = await findDeployLogsDbId(adminPageId);
  if (!dbId) return json({ ok: true, skipped: true, reason: "No Deploy Logs DB" });

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
        await updatePageProperties(compactNotionId(row.id), {
          Result: { select: { name: mapEventToResult(eventType) } },
        });
      }
    } catch {
      // ignore
    }
  }

  return json({ ok: true });
}

export async function GET() {
  return json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
}
