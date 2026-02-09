import crypto from "node:crypto";
import { NextResponse } from "next/server";

import protectedRoutes from "@/content/generated/protected-routes.json";

export const runtime = "nodejs";

type ProtectedRoute = {
  id: string;
  path: string;
  mode: "exact" | "prefix";
  token: string;
};

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
  const form = await req.formData().catch(() => null);
  const next = normalizeNextPath(form?.get("next"));
  const rid = String(form?.get("rid") ?? "").trim();
  const password = String(form?.get("password") ?? "");

  const routes = (protectedRoutes || []) as ProtectedRoute[];
  const route = routes.find((r) => r.id === rid);
  if (!route) return redirectToAuth(req, { next, rid, error: "1" });

  const computed = sha256Hex(`${route.path}\n${password}`);
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

