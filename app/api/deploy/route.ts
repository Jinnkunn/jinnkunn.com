import { NextResponse } from "next/server";

export const runtime = "nodejs";

const NOTION_API = "https://api.notion.com/v1";

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

function sanitizeUrlForLogs(u: string): string {
  try {
    const url = new URL(u);
    if (url.searchParams.has("token")) url.searchParams.set("token", "[redacted]");
    return url.toString();
  } catch {
    return String(u || "").replace(/token=[^&]+/gi, "token=[redacted]");
  }
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
) {
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
      `Notion API error ${res.status} for ${pathname}: ${text?.slice(0, 180)}`,
    );
  }
  return json as any;
}

async function findDeployLogsDbId(adminPageId: string): Promise<string | null> {
  let cursor: string | undefined = undefined;
  for (let page = 0; page < 6; page++) {
    const data = await notionRequest(`blocks/${adminPageId}/children`, {
      searchParams: { page_size: 100, start_cursor: cursor },
    });

    const results = Array.isArray(data?.results) ? data.results : [];
    for (const b of results) {
      if (b?.type !== "child_database") continue;
      const title = String(b?.child_database?.title ?? "").trim().toLowerCase();
      if (title === "deploy logs") return compactNotionId(b.id);
    }

    if (!data?.has_more) break;
    cursor = data?.next_cursor;
    if (!cursor) break;
  }
  return null;
}

async function logDeployToNotion(opts: {
  reqUrl: string;
  ok: boolean;
  status: number;
  message: string;
  triggeredAtIso: string;
}) {
  const adminPageId = compactNotionId(
    process.env.NOTION_SITE_ADMIN_PAGE_ID?.trim() ?? "",
  );
  if (!adminPageId) return;

  const dbId = await findDeployLogsDbId(adminPageId);
  if (!dbId) return;

  const name = `Deploy @ ${opts.triggeredAtIso.replace("T", " ").replace("Z", " UTC")}`;
  const safeReq = sanitizeUrlForLogs(opts.reqUrl);
  const msg = String(opts.message || "").trim().slice(0, 1800);

  await notionRequest("pages", {
    method: "POST",
    body: {
      parent: { database_id: dbId },
      properties: {
        Name: { title: richText(name) },
        "Triggered At": { date: { start: opts.triggeredAtIso } },
        Result: { select: { name: opts.ok ? "Triggered" : "Failed" } },
        "HTTP Status": { number: opts.status },
        Request: { url: safeReq },
        Message: { rich_text: richText(msg) },
      },
    },
  });
}

async function triggerDeploy(): Promise<{ ok: boolean; status: number; text: string }> {
  const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL?.trim() ?? "";
  if (!hookUrl) {
    return { ok: false, status: 500, text: "Missing VERCEL_DEPLOY_HOOK_URL" };
  }

  const res = await fetch(hookUrl, { method: "POST" });
  const text = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, text };
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
    return json(
      { ok: false, error: "Server misconfigured: missing DEPLOY_TOKEN" },
      { status: 500 },
    );
  }
  if (!isAuthorized(req)) {
    return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const triggeredAtIso = new Date().toISOString();
  const out = await triggerDeploy();
  if (!out.ok) {
    // Best-effort logging (don't fail deploy trigger because Notion logging failed).
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
    return json(
      { ok: false, error: `Failed to trigger deploy (status ${out.status})` },
      { status: 502 },
    );
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

  return json({
    ok: true,
    triggeredAt: triggeredAtIso,
    status: out.status,
  });
}

export async function POST(req: Request) {
  // Allow POST as well, but keep the same auth mechanism so Notion "open link"
  // can use GET while other tooling can use POST.
  return GET(req);
}
