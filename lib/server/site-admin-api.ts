import "server-only";

import type { NextRequest } from "next/server";

import { isSiteAdminAuthorized, parseAllowedAdminUsers } from "@/lib/site-admin-auth";
import { noStoreFail, noStoreFailFromUnknown, noStoreOk } from "@/lib/server/api-response";
import type { ParseResult } from "@/lib/server/site-admin-request";

type RequireSiteAdminOptions = {
  requireAllowlist?: boolean;
  requireAuthSecret?: boolean;
};

type SiteAdminHandler = () => Promise<Response>;
type ApiErrorResponse = ReturnType<typeof apiError>;
type SiteAdminGuardResult<T> =
  | { ok: true; value: T }
  | { ok: false; res: ApiErrorResponse };

export type RequireSiteAdminResult =
  | { ok: true }
  | { ok: false; res: ReturnType<typeof apiError> };

export function apiOk<T extends Record<string, unknown> = Record<string, never>>(
  payload?: T,
  init?: { status?: number },
) {
  return noStoreOk(payload, init);
}

export function apiError(error: string, init?: { status?: number }) {
  return noStoreFail(error, init);
}

export function apiErrorFromUnknown(
  e: unknown,
  init?: { status?: number; fallback?: string },
) {
  return noStoreFailFromUnknown(e, init);
}

export async function requireSiteAdmin(
  req: NextRequest,
  opts?: RequireSiteAdminOptions,
): Promise<RequireSiteAdminResult> {
  if (opts?.requireAllowlist) {
    const allow = parseAllowedAdminUsers();
    if (!allow.size) {
      return { ok: false, res: apiError("Admin allowlist not configured", { status: 500 }) };
    }
  }

  if (opts?.requireAuthSecret) {
    const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "";
    if (!secret.trim()) {
      return { ok: false, res: apiError("Missing NEXTAUTH_SECRET", { status: 500 }) };
    }
  }

  const ok = await isSiteAdminAuthorized(req);
  if (!ok) {
    return { ok: false, res: apiError("Unauthorized", { status: 401 }) };
  }
  return { ok: true };
}

export async function withSiteAdmin(
  req: NextRequest,
  run: SiteAdminHandler,
  opts?: RequireSiteAdminOptions,
): Promise<Response> {
  const auth = await requireSiteAdmin(req, opts);
  if (!auth.ok) return auth.res;
  try {
    return await run();
  } catch (e: unknown) {
    return apiErrorFromUnknown(e);
  }
}

export function fromParsedCommand<T>(parsed: ParseResult<T>): SiteAdminGuardResult<T> {
  if (!parsed.ok) {
    return { ok: false, res: apiError(parsed.error, { status: parsed.status }) };
  }
  return { ok: true, value: parsed.value };
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
  return apiError(message, { status: 400 });
}
