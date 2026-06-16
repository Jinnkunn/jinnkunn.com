import { NextResponse } from "next/server";

import { getProtectedRoutes } from "@/lib/protected-routes";
import type { ProtectedRoute } from "@/lib/shared/protected-route";
import { getFormString, readFormBody } from "@/lib/server/validate";
import { verifyProtectedRoutePassword } from "@/lib/server/protected-route-password";
import { computeProtectedRouteCookie } from "@/lib/shared/protected-route-cookie";

export const runtime = "nodejs";

function resolveProtectedRouteSecret(): string {
  return (
    process.env.SITE_PROTECTED_ROUTE_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.AUTH_SECRET ||
    ""
  );
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
  // Legacy verifiers were salted with the route's pageId/path. New (scrypt)
  // verifiers ignore this and carry their own random salt.
  const legacySalt =
    key === "pageId" ? String(route.pageId || route.id || "") : String(route.path || "");
  if (!verifyProtectedRoutePassword(password, route.token, legacySalt)) {
    return redirectToAuth(req, { next, rid, error: "1" });
  }

  // The cookie is an HMAC capability keyed by a server-only secret, NOT the
  // stored verifier — so it can't be forged from the content bundle.
  const cookieSecret = resolveProtectedRouteSecret();
  const cookieValue = await computeProtectedRouteCookie(route.id, cookieSecret);
  if (!cookieValue) {
    // No secret configured: refuse to issue a cookie rather than fail open.
    return redirectToAuth(req, { next, rid, error: "2" });
  }

  const res = NextResponse.redirect(new URL(next, req.url), { status: 302 });

  const proto = req.headers.get("x-forwarded-proto") || "";
  const secure = proto.includes("https") || process.env.NODE_ENV === "production";
  res.cookies.set(`site_auth_${route.id}`, cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return res;
}
