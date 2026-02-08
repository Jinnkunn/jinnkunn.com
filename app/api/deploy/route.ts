import { NextResponse } from "next/server";

export const runtime = "nodejs";

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

  const out = await triggerDeploy();
  if (!out.ok) {
    return json(
      { ok: false, error: `Failed to trigger deploy (status ${out.status})` },
      { status: 502 },
    );
  }
  return json({
    ok: true,
    triggeredAt: new Date().toISOString(),
    status: out.status,
  });
}

export async function POST(req: Request) {
  // Allow POST as well, but keep the same auth mechanism so Notion "open link"
  // can use GET while other tooling can use POST.
  return GET(req);
}

