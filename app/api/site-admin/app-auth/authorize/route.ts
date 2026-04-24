import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiError, requireSiteAdminContext } from "@/lib/server/site-admin-api";
import { issueSiteAdminAppToken } from "@/lib/server/site-admin-app-token";
import { checkRateLimit, requestIpFromHeaders } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

// Token issuance is the most security-sensitive admin path: a
// successful call hands out a long-lived app token to the desktop
// client. Keep the per-IP allowance tight so a compromised session
// cookie cannot be used to mint an unlimited fleet of tokens.
const APP_AUTH_RATE_LIMIT = {
  namespace: "site-admin-app-auth",
  maxRequests: 15,
  windowMs: 60 * 1000,
};

function parseLocalRedirectUri(raw: string): URL | null {
  try {
    const target = new URL(String(raw || ""));
    if (target.protocol !== "http:") return null;
    if (target.hostname !== "127.0.0.1" && target.hostname !== "localhost") return null;
    if (!target.port) return null;
    return target;
  } catch {
    return null;
  }
}

function toLoginRedirect(req: NextRequest): NextResponse {
  const current = new URL(req.url);
  const login = new URL("/site-admin/login", req.url);
  login.searchParams.set("next", `${current.pathname}${current.search}`);
  return NextResponse.redirect(login, { status: 302 });
}

export async function GET(req: NextRequest) {
  const ip = requestIpFromHeaders(req.headers);
  const rate = checkRateLimit({ ...APP_AUTH_RATE_LIMIT, ip });
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: "Too Many Requests", code: "RATE_LIMITED" },
      {
        status: 429,
        headers: {
          "cache-control": "no-store",
          "retry-after": String(rate.retryAfterSec),
        },
      },
    );
  }

  const current = new URL(req.url);
  const redirectUriRaw = current.searchParams.get("redirect_uri") || "";
  const state = String(current.searchParams.get("state") || "").trim();
  const callbackTarget = parseLocalRedirectUri(redirectUriRaw);
  if (!callbackTarget) {
    return apiError("Invalid redirect_uri", { status: 400, code: "INVALID_REDIRECT_URI" });
  }

  const auth = await requireSiteAdminContext(req, {
    requireAllowlist: true,
    requireAuthSecret: true,
  });
  if (!auth.ok) {
    if (auth.res.status === 401) {
      return toLoginRedirect(req);
    }
    return auth.res;
  }

  let token: { token: string; expiresAt: string };
  try {
    token = issueSiteAdminAppToken(auth.value.login);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err || "Token issue failed");
    return apiError(message, { status: 500, code: "APP_TOKEN_ISSUE_FAILED" });
  }

  callbackTarget.searchParams.set("token", token.token);
  callbackTarget.searchParams.set("login", auth.value.login);
  callbackTarget.searchParams.set("expiresAt", token.expiresAt);
  if (state) callbackTarget.searchParams.set("state", state);
  return NextResponse.redirect(callbackTarget, { status: 302 });
}

