import "server-only";

import type { NextRequest } from "next/server";

import { isSiteAdminAuthorized, parseAllowedAdminUsers } from "@/lib/site-admin-auth";
import { noStoreFail, noStoreFailFromUnknown, noStoreOk } from "@/lib/server/api-response";

type RequireSiteAdminOptions = {
  requireAllowlist?: boolean;
  requireAuthSecret?: boolean;
};

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
