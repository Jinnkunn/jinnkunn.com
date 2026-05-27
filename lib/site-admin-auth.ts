import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

import { normalizeGithubUser, parseGithubUserCsv } from "@/lib/shared/github-users";

export type SiteAdminSessionIdentity = {
  actor: string;
  login: string;
  email: string;
  subject: string;
};

export function normalizeAdminEmail(value: unknown): string {
  const raw = String(value || "").trim().toLowerCase();
  return raw && raw.includes("@") ? raw : "";
}

function normalizeAdminSubject(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function parseAllowedAdminUsers(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.SITE_ADMIN_GITHUB_USERS || "";
  return new Set(parseGithubUserCsv(raw));
}

export function parseAllowedAdminEmails(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.SITE_ADMIN_EMAILS || "";
  const out = new Set<string>();
  for (const part of raw.split(/[,\n]/)) {
    const normalized = normalizeAdminEmail(part);
    if (normalized) out.add(normalized);
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

export function hasAdminAllowlist(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseAllowedAdminUsers(env).size > 0 || parseAllowedAdminEmails(env).size > 0;
}

export function isAllowedAdminActor(
  value: unknown,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const login = normalizeGithubUser(value);
  const email = normalizeAdminEmail(value);
  const allowedUsers = parseAllowedAdminUsers(env);
  const allowedEmails = parseAllowedAdminEmails(env);
  return Boolean((login && allowedUsers.has(login)) || (email && allowedEmails.has(email)));
}

export function isAllowedAdminSessionIdentity(
  identity: SiteAdminSessionIdentity | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!identity) return false;
  const allowedUsers = parseAllowedAdminUsers(env);
  const allowedEmails = parseAllowedAdminEmails(env);
  return Boolean(
    (identity.login && allowedUsers.has(identity.login)) ||
      (identity.email && allowedEmails.has(identity.email)),
  );
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

export async function getSiteAdminSessionIdentity(
  req: NextRequest,
): Promise<SiteAdminSessionIdentity | null> {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "";
  if (!secret) return null;
  const token = await getToken({ req, secret }).catch(() => null);
  if (!token || typeof token !== "object") return null;
  const record = token as Record<string, unknown>;
  const login = normalizeGithubUser(record.login);
  const email = normalizeAdminEmail(record.email);
  const subject = normalizeAdminSubject(record.authSubject || record.sub);
  const actor = email || login || subject;
  return actor ? { actor, login, email, subject } : null;
}

export async function isSiteAdminAuthorized(req: NextRequest): Promise<boolean> {
  // NOTE: middleware (Edge runtime) imports this module. We intentionally
  // do NOT call the Cloudflare Access verifier here — it relies on
  // node:crypto and runs only inside the Node-runtime API routes via
  // `requireSiteAdminContext` in `lib/server/site-admin-api.ts`. Middleware
  // only blocks the browser UI routes (`/site-admin/*`), which are fine to
  // gate behind the legacy NextAuth cookie; the CF Access verification for
  // actual admin API calls happens in the API route guard.
  if (!hasAdminAllowlist()) return false;
  const identity = await getSiteAdminSessionIdentity(req);
  return isAllowedAdminSessionIdentity(identity);
}
