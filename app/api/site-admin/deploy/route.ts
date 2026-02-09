import { NextResponse, type NextRequest } from "next/server";
import { isSiteAdminAuthorized, parseAllowedAdminUsers } from "@/lib/site-admin-auth";

export const runtime = "nodejs";

function json(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: { "cache-control": "no-store" },
  });
}

async function requireAdmin(req: NextRequest): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const allow = parseAllowedAdminUsers();
  if (!allow.size) return { ok: false, res: json({ ok: false, error: "Admin allowlist not configured" }, { status: 500 }) };

  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "";
  if (!secret) return { ok: false, res: json({ ok: false, error: "Missing NEXTAUTH_SECRET" }, { status: 500 }) };

  const ok = await isSiteAdminAuthorized(req);
  if (!ok) {
    return { ok: false, res: json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  }
  return { ok: true };
}

async function triggerDeploy(): Promise<{ ok: boolean; status: number; text: string }> {
  const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL?.trim() ?? "";
  if (!hookUrl) return { ok: false, status: 500, text: "Missing VERCEL_DEPLOY_HOOK_URL" };

  const res = await fetch(hookUrl, { method: "POST" });
  const text = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, text };
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const triggeredAtIso = new Date().toISOString();
  const out = await triggerDeploy();

  if (!out.ok) {
    return json(
      { ok: false, error: `Failed to trigger deploy (status ${out.status})` },
      { status: 502 },
    );
  }

  return json({ ok: true, triggeredAt: triggeredAtIso, status: out.status });
}
