import crypto from "node:crypto";
import { NextResponse } from "next/server";

import { getProtectedRoutes } from "@/lib/protected-routes";
import type { ProtectedRoute } from "@/lib/shared/protected-route";
import { getFormString, readFormBody } from "@/lib/server/validate";

export const runtime = "nodejs";

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function normalizeNextPath(p: unknown): string {
  const raw = String(p ?? "").trim();
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  return raw;
}

function redirectToAuth(
  req: Request,
  { next, rid, error }: { next: string; rid?: string; error?: string },
) {
  const url = new URL(req.url);
  url.pathname = "/auth";
  url.search = "";
  url.searchParams.set("next", next);
  if (rid) url.searchParams.set("rid", rid);
  if (error) url.searchParams.set("error", error);
  return NextResponse.redirect(url, { status: 302 });
}

export async function POST(req: Request) {
  const form = await readFormBody(req);
  const f = form ?? new FormData();
  const next = normalizeNextPath(getFormString(f, "next", { maxLen: 2048 }));
  const rid = getFormString(f, "rid", { maxLen: 128 });
  const password = getFormString(f, "password", { trim: false, maxLen: 2048 });

  const routes: ProtectedRoute[] = getProtectedRoutes();
  const route = routes.find((r) => r.id === rid);
  if (!route) return redirectToAuth(req, { next, rid, error: "1" });

  if ((route.auth || "password") !== "password") {
    return redirectToAuth(req, { next, rid, error: "1" });
  }

  const key = (route.key || (route.pageId ? "pageId" : "path")) as "pageId" | "path";
  const secret = key === "pageId" ? String(route.pageId || route.id || "") : String(route.path || "");
  const computed = sha256Hex(`${secret}\n${password}`);
  if (computed !== route.token) return redirectToAuth(req, { next, rid, error: "1" });

  const res = NextResponse.redirect(new URL(next, req.url), { status: 302 });

  const proto = req.headers.get("x-forwarded-proto") || "";
  const secure = proto.includes("https") || process.env.NODE_ENV === "production";
  res.cookies.set(`site_auth_${route.id}`, route.token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return res;
}
