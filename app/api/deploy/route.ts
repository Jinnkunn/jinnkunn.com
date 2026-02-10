import { notionRequest } from "@/lib/notion/api.mjs";
import { compactId } from "@/lib/shared/route-utils.mjs";
import { jsonNoStore } from "@/lib/server/validate";

export const runtime = "nodejs";

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

function json(
  body: unknown,
  init?: { status?: number },
) {
  return jsonNoStore(body, { status: init?.status ?? 200 });
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
      if (title === "deploy logs") return compactId(b.id);
    }

    if (!data?.has_more) break;
    cursor = data?.next_cursor ?? undefined;
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
  const adminPageId = compactId(
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
