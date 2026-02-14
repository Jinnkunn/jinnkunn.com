import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

import { normalizeGithubUser, parseGithubUserCsv } from "@/lib/shared/github-users";

export function parseAllowedAdminUsers(): Set<string> {
  const raw = process.env.SITE_ADMIN_GITHUB_USERS || "";
  return new Set(parseGithubUserCsv(raw));
}

export async function isSiteAdminAuthorized(req: NextRequest): Promise<boolean> {
  const allow = parseAllowedAdminUsers();
  if (!allow.size) return false;
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "";
  if (!secret) return false;

  const token = await getToken({ req, secret }).catch(() => null);
  const login = normalizeGithubUser((token as { login?: unknown } | null)?.login ?? "");
  if (!login) return false;
  return allow.has(login);
}
