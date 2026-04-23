import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

import { normalizeGithubUser, parseGithubUserCsv } from "@/lib/shared/github-users";

export function parseAllowedAdminUsers(): Set<string> {
  const raw = process.env.SITE_ADMIN_GITHUB_USERS || "";
  return new Set(parseGithubUserCsv(raw));
}

export function parseAllowedAdminEmails(): Set<string> {
  const raw = process.env.SITE_ADMIN_EMAILS || "";
  const out = new Set<string>();
  for (const part of raw.split(/[,\n]/)) {
    const normalized = part.trim().toLowerCase();
    if (normalized && normalized.includes("@")) out.add(normalized);
  }
  return out;
}

export function parseAllowedServiceTokens(): Set<string> {
  // Each entry is a Cloudflare Access service-token `common_name`
  // (lowercased). CF injects this into the JWT as `common_name` when the
  // CF-Access-Client-Id / Client-Secret headers validate.
  const raw = process.env.SITE_ADMIN_SERVICE_TOKENS || "";
  const out = new Set<string>();
  for (const part of raw.split(/[,\n]/)) {
    const normalized = part.trim().toLowerCase();
    if (normalized) out.add(normalized);
  }
  return out;
}

export type SiteAdminAuthMode = "legacy" | "cf-access" | "both";

export function parseSiteAdminAuthMode(
  env: NodeJS.ProcessEnv = process.env,
): SiteAdminAuthMode {
  const raw = String(env.SITE_ADMIN_AUTH_MODE || "").trim().toLowerCase();
  if (raw === "cf-access" || raw === "cf" || raw === "access") return "cf-access";
  if (raw === "legacy" || raw === "nextauth") return "legacy";
  return "both";
}

export async function getSiteAdminGithubLogin(req: NextRequest): Promise<string | null> {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "";
  if (!secret) return null;
  const token = await getToken({ req, secret }).catch(() => null);
  const login = normalizeGithubUser((token as { login?: unknown } | null)?.login ?? "");
  return login || null;
}

export async function isSiteAdminAuthorized(req: NextRequest): Promise<boolean> {
  // NOTE: middleware (Edge runtime) imports this module. We intentionally
  // do NOT call the Cloudflare Access verifier here — it relies on
  // node:crypto and runs only inside the Node-runtime API routes via
  // `requireSiteAdminContext` in `lib/server/site-admin-api.ts`. Middleware
  // only blocks the browser UI routes (`/site-admin/*`), which are fine to
  // gate behind the legacy NextAuth cookie; the CF Access verification for
  // actual admin API calls happens in the API route guard.
  const allow = parseAllowedAdminUsers();
  if (!allow.size) return false;
  const login = await getSiteAdminGithubLogin(req);
  if (!login) return false;
  return allow.has(login);
}
