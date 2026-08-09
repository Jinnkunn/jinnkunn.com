import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiError, requireSiteAdminContext } from "@/lib/server/site-admin-api";
import {
  inferSiteAdminAppTokenEnvironment,
  issueSiteAdminAppToken,
} from "@/lib/server/site-admin-app-token";
import { checkRateLimit, requestIpFromHeaders } from "@/lib/server/rate-limit";
import { checkSameSiteRequest } from "@/lib/server/request-guards";
import { writeSiteAdminAuditLog } from "@/lib/server/site-admin-audit-log";
import {
  buildSiteAdminAppAuthSignInUrl,
  parseSiteAdminAppRedirectUri,
} from "@/lib/site-admin/app-auth-redirect";

export const runtime = "nodejs";

const ENDPOINT = "/api/site-admin/app-auth/authorize";

// Token issuance is the most security-sensitive admin path: a
// successful call hands out a long-lived app token to the desktop
// client. Keep the per-IP allowance tight so a compromised session
// cookie cannot be used to mint an unlimited fleet of tokens.
const APP_AUTH_RATE_LIMIT = {
  namespace: "site-admin-app-auth",
  maxRequests: 15,
  windowMs: 60 * 1000,
};

function toLoginRedirect(req: NextRequest): NextResponse {
  return NextResponse.redirect(buildSiteAdminAppAuthSignInUrl(req.url), { status: 302 });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/**
 * Interstitial shown when the request was not initiated by this site.
 *
 * A GET that mints a 30-day admin token is exactly the shape CSRF
 * exploits: any page the signed-in admin visits could trigger it and
 * have the token delivered to a redirect target it controls. Rather
 * than hard-failing every non-same-origin request (which would also
 * break the legitimate sign-in bounce — the hop back from the OAuth
 * provider is `Sec-Fetch-Site: cross-site`), require a deliberate click
 * here. Following this link is a same-origin navigation, so the retry
 * passes the check and the user has seen where the token is going.
 */
function consentPage(req: NextRequest, target: URL, login: string): NextResponse {
  const current = new URL(req.url);
  const retryHref = `${current.pathname}${current.search}`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Authorize app access</title>
</head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.6">
<h1 style="font-size:1.25rem">Authorize app access</h1>
<p>An application is requesting a Site Admin token for <strong>${escapeHtml(login)}</strong>.</p>
<p>The token will be sent to:<br><code>${escapeHtml(`${target.protocol}//${target.host}${target.pathname}`)}</code></p>
<p>This request did not start on this site. Only continue if you just started a sign-in from the desktop or mobile app.</p>
<p><a href="${escapeHtml(retryHref)}" rel="nofollow">Authorize</a></p>
</body>
</html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
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
  const callbackTarget = parseSiteAdminAppRedirectUri(redirectUriRaw);
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

  const sameSite = checkSameSiteRequest(req);
  if (!sameSite.ok) {
    await writeSiteAdminAuditLog({
      action: "auth.denied",
      result: "error",
      actor: auth.value.login,
      endpoint: ENDPOINT,
      method: "GET",
      status: 200,
      code: "CROSS_SITE_TOKEN_REQUEST",
      message: "cross-site token request held for consent",
      metadata: { reason: sameSite.reason, redirectTarget: callbackTarget.origin },
    });
    return consentPage(req, callbackTarget, auth.value.login);
  }

  let token: { token: string; expiresAt: string };
  try {
    token = issueSiteAdminAppToken(auth.value.login, {
      environment: inferSiteAdminAppTokenEnvironment(req.url),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err || "Token issue failed");
    await writeSiteAdminAuditLog({
      action: "app-auth.token.issue",
      result: "error",
      actor: auth.value.login,
      endpoint: ENDPOINT,
      method: "GET",
      status: 500,
      code: "APP_TOKEN_ISSUE_FAILED",
      message,
    });
    return apiError(message, { status: 500, code: "APP_TOKEN_ISSUE_FAILED" });
  }

  await writeSiteAdminAuditLog({
    action: "app-auth.token.issue",
    result: "success",
    actor: auth.value.login,
    endpoint: ENDPOINT,
    method: "GET",
    status: 302,
    metadata: {
      redirectTarget: `${callbackTarget.protocol}//${callbackTarget.host}${callbackTarget.pathname}`,
      expiresAt: token.expiresAt,
      environment: inferSiteAdminAppTokenEnvironment(req.url),
    },
  });

  callbackTarget.searchParams.set("token", token.token);
  callbackTarget.searchParams.set("login", auth.value.login);
  callbackTarget.searchParams.set("expiresAt", token.expiresAt);
  if (state) callbackTarget.searchParams.set("state", state);
  return NextResponse.redirect(callbackTarget, { status: 302 });
}
