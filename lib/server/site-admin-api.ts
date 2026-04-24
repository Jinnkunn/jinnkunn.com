import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import {
  getSiteAdminGithubLogin,
  parseAllowedAdminEmails,
  parseAllowedAdminUsers,
  parseAllowedServiceTokens,
  parseSiteAdminAuthMode,
} from "@/lib/site-admin-auth";
import {
  readCloudflareAccessConfigFromEnv,
  verifyCloudflareAccessFromHeaders,
} from "@/lib/server/cloudflare-access-auth";
import type { ParseResult } from "@/lib/site-admin/request-types";
import { verifySiteAdminAppToken } from "@/lib/server/site-admin-app-token";
import { parseSiteAdminJsonCommand } from "@/lib/server/site-admin-request";
import {
  noStoreData,
  noStoreFailWithCode,
  noStoreFailFromUnknown,
} from "@/lib/server/api-response";
import { checkRateLimit, requestIpFromHeaders } from "@/lib/server/rate-limit";

type RequireSiteAdminOptions = {
  requireAllowlist?: boolean;
  requireAuthSecret?: boolean;
};

export type AdminRateLimitOptions = {
  /** Bucket key, e.g. "site-admin-config". Keep per-endpoint so read */
  /*  polling does not starve write mutations. */
  namespace: string;
  /** Max requests per window. Defaults tuned for the admin UI's */
  /*  polling rate (status/config/routes each load on page open). */
  maxRequests?: number;
  /** Window length. Defaults to 60s. */
  windowMs?: number;
};

const DEFAULT_ADMIN_RATE_LIMIT_MAX = 60;
const DEFAULT_ADMIN_RATE_LIMIT_WINDOW_MS = 60 * 1000;

type SiteAdminHandler = () => Promise<Response>;
type ApiErrorResponse = ReturnType<typeof apiError>;
export type SiteAdminGuardResult<T> =
  | { ok: true; value: T }
  | { ok: false; res: ApiErrorResponse };
export type SiteAdminOkPayload<T extends Record<string, unknown>> = T;
export type SiteAdminContext = { login: string };

export type RequireSiteAdminResult =
  | { ok: true }
  | { ok: false; res: ReturnType<typeof apiError> };
export type RequireSiteAdminContextResult =
  | { ok: true; value: SiteAdminContext }
  | { ok: false; res: ReturnType<typeof apiError> };

function readBearerToken(req: NextRequest): string {
  const raw = String(req.headers.get("authorization") || "").trim();
  if (!raw) return "";
  const [scheme, ...rest] = raw.split(/\s+/);
  if (scheme.toLowerCase() !== "bearer") return "";
  return rest.join(" ").trim();
}

export function apiOk<T extends Record<string, unknown> = Record<string, never>>(
  payload?: T,
  init?: { status?: number },
) {
  if (payload && Object.keys(payload).length > 0) {
    return noStoreData(payload, init);
  }
  return noStoreData(null, init);
}

export function apiPayloadOk<T extends Record<string, unknown>>(
  payload: SiteAdminOkPayload<T>,
  init?: { status?: number },
) {
  return noStoreData(payload, init);
}

export function apiError(
  error: string,
  init?: { status?: number; code?: string; extras?: Record<string, unknown> },
) {
  return noStoreFailWithCode(error, init);
}

export function apiErrorFromUnknown(
  e: unknown,
  init?: { status?: number; fallback?: string; code?: string },
) {
  return noStoreFailFromUnknown(e, init);
}

export async function requireSiteAdmin(
  req: NextRequest,
  opts?: RequireSiteAdminOptions,
): Promise<RequireSiteAdminResult> {
  const auth = await requireSiteAdminContext(req, opts);
  if (!auth.ok) return auth;
  return { ok: true };
}

export async function requireSiteAdminContext(
  req: NextRequest,
  opts?: RequireSiteAdminOptions,
): Promise<RequireSiteAdminContextResult> {
  const mode = parseSiteAdminAuthMode();
  const allow = parseAllowedAdminUsers();

  // 1. Cloudflare Access (preferred when configured). Verifies the
  //    `Cf-Access-Jwt-Assertion` header against the team's JWKS and checks
  //    the resolved email / service-token name against the admin allowlists.
  //    The verifier uses node:crypto so it MUST stay in server-only code
  //    (not reachable from Edge-runtime middleware).
  if (mode !== "legacy") {
    const cfConfig = readCloudflareAccessConfigFromEnv();
    if (cfConfig) {
      let identity = null;
      try {
        identity = await verifyCloudflareAccessFromHeaders(req.headers, cfConfig);
      } catch {
        identity = null;
      }
      if (identity) {
        const allowedEmails = parseAllowedAdminEmails();
        const allowedServices = parseAllowedServiceTokens();
        const approved =
          identity.kind === "user"
            ? allowedEmails.has(identity.email)
            : allowedServices.has(identity.subject);
        if (approved) {
          return { ok: true, value: { login: identity.subject } };
        }
      }
    }
    if (mode === "cf-access") {
      return { ok: false, res: apiError("Unauthorized", { status: 401, code: "UNAUTHORIZED" }) };
    }
  }

  // 2. Legacy: GitHub allowlist for bearer tokens / NextAuth cookies.
  if (opts?.requireAllowlist) {
    if (!allow.size) {
      return {
        ok: false,
        res: apiError("Admin allowlist not configured", {
          status: 500,
          code: "ADMIN_ALLOWLIST_MISSING",
        }),
      };
    }
  }

  if (!allow.size) {
    return { ok: false, res: apiError("Unauthorized", { status: 401, code: "UNAUTHORIZED" }) };
  }

  if (opts?.requireAuthSecret) {
    const secret =
      process.env.SITE_ADMIN_APP_TOKEN_SECRET ||
      process.env.NEXTAUTH_SECRET ||
      process.env.AUTH_SECRET ||
      "";
    if (!secret.trim()) {
      return {
        ok: false,
        res: apiError("Missing NEXTAUTH_SECRET/SITE_ADMIN_APP_TOKEN_SECRET", {
          status: 500,
          code: "AUTH_SECRET_MISSING",
        }),
      };
    }
  }

  const bearerToken = readBearerToken(req);
  if (bearerToken) {
    const verified = verifySiteAdminAppToken(bearerToken);
    if (!verified.ok || !allow.has(verified.login)) {
      return { ok: false, res: apiError("Unauthorized", { status: 401, code: "UNAUTHORIZED" }) };
    }
    return { ok: true, value: { login: verified.login } };
  }

  const login = await getSiteAdminGithubLogin(req);
  if (!login || !allow.has(login)) {
    return { ok: false, res: apiError("Unauthorized", { status: 401, code: "UNAUTHORIZED" }) };
  }
  return { ok: true, value: { login } };
}

type WithSiteAdminOptions = RequireSiteAdminOptions & {
  rateLimit?: AdminRateLimitOptions;
};

/**
 * Rate-limit this request against its per-endpoint bucket, if `opts`
 * declares one. Returning `null` means the request may proceed; a
 * Response means the caller should short-circuit with the 429.
 *
 * Admin requests run behind auth, but the auth check itself is non-
 * trivial (cookie decode, JWT verify, allowlist lookup). Throttling
 * before the handler runs both blunts brute-force attempts against
 * token/session decoding and protects the heavier downstream work
 * (Notion reads, D1 writes) from a flood.
 */
function applyAdminRateLimit(req: NextRequest, opts?: AdminRateLimitOptions): Response | null {
  if (!opts) return null;
  const ip = requestIpFromHeaders(req.headers);
  const result = checkRateLimit({
    namespace: opts.namespace,
    ip,
    maxRequests: opts.maxRequests ?? DEFAULT_ADMIN_RATE_LIMIT_MAX,
    windowMs: opts.windowMs ?? DEFAULT_ADMIN_RATE_LIMIT_WINDOW_MS,
  });
  if (result.ok) return null;
  return NextResponse.json(
    { ok: false, error: "Too Many Requests", code: "RATE_LIMITED" },
    {
      status: 429,
      headers: {
        "cache-control": "no-store",
        "retry-after": String(result.retryAfterSec),
      },
    },
  );
}

export async function withSiteAdmin(
  req: NextRequest,
  run: SiteAdminHandler,
  opts?: WithSiteAdminOptions,
): Promise<Response> {
  const throttled = applyAdminRateLimit(req, opts?.rateLimit);
  if (throttled) return throttled;
  const auth = await requireSiteAdmin(req, opts);
  if (!auth.ok) return auth.res;
  try {
    return await run();
  } catch (e: unknown) {
    return apiErrorFromUnknown(e);
  }
}

export async function withSiteAdminContext(
  req: NextRequest,
  run: (context: SiteAdminContext) => Promise<Response>,
  opts?: WithSiteAdminOptions,
): Promise<Response> {
  const throttled = applyAdminRateLimit(req, opts?.rateLimit);
  if (throttled) return throttled;
  const auth = await requireSiteAdminContext(req, opts);
  if (!auth.ok) return auth.res;
  try {
    return await run(auth.value);
  } catch (e: unknown) {
    return apiErrorFromUnknown(e);
  }
}

export function fromParsedCommand<T>(parsed: ParseResult<T>): SiteAdminGuardResult<T> {
  if (!parsed.ok) {
    return {
      ok: false,
      res: apiError(parsed.error, { status: parsed.status, code: "BAD_REQUEST" }),
    };
  }
  return { ok: true, value: parsed.value };
}

export async function readSiteAdminJsonCommand<T>(
  req: Request,
  parseBody: (body: Record<string, unknown>) => ParseResult<T>,
  opts?: { invalidJsonError?: string; invalidJsonStatus?: number },
): Promise<SiteAdminGuardResult<T>> {
  const parsed = await parseSiteAdminJsonCommand(req, parseBody, opts);
  return fromParsedCommand(parsed);
}

export function requireNonEmptyString(
  value: string,
  error: string,
  status = 400,
): SiteAdminGuardResult<string> {
  const out = String(value || "").trim();
  if (!out) return { ok: false, res: apiError(error, { status }) };
  return { ok: true, value: out };
}

export function apiExhaustive(_value: never, message = "Unsupported request"): Response {
  return apiError(message, { status: 400, code: "UNSUPPORTED_REQUEST" });
}
