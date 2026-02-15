import "server-only";

import type { NextRequest } from "next/server";

import { isSiteAdminAuthorized, parseAllowedAdminUsers } from "@/lib/site-admin-auth";
import type { ParseResult } from "@/lib/site-admin/request-types";
import { parseSiteAdminJsonCommand } from "@/lib/server/site-admin-request";
import { noStoreFail, noStoreFailFromUnknown, noStoreOk } from "@/lib/server/api-response";

type RequireSiteAdminOptions = {
  requireAllowlist?: boolean;
  requireAuthSecret?: boolean;
};

type SiteAdminHandler = () => Promise<Response>;
type ApiErrorResponse = ReturnType<typeof apiError>;
export type SiteAdminGuardResult<T> =
  | { ok: true; value: T }
  | { ok: false; res: ApiErrorResponse };
export type SiteAdminOkPayload<T extends { ok: boolean }> = Omit<T, "ok">;

export type RequireSiteAdminResult =
  | { ok: true }
  | { ok: false; res: ReturnType<typeof apiError> };

export function apiOk<T extends Record<string, unknown> = Record<string, never>>(
  payload?: T,
  init?: { status?: number },
) {
  return noStoreOk(payload, init);
}

export function apiPayloadOk<T extends { ok: boolean }>(
  payload: SiteAdminOkPayload<T>,
  init?: { status?: number },
) {
  return apiOk(payload as Record<string, unknown>, init);
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
  return apiError(message, { status: 400 });
}
