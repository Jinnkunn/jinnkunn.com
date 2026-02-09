import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export function parseAllowedAdminUsers(): Set<string> {
  const raw = (process.env.SITE_ADMIN_GITHUB_USERS || "").trim();
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^@/, "").toLowerCase());
  return new Set(items);
}

export async function isSiteAdminAuthorized(req: NextRequest): Promise<boolean> {
  const allow = parseAllowedAdminUsers();
  if (!allow.size) return false;
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "";
  if (!secret) return false;

  const token = await getToken({ req, secret }).catch(() => null);
  const login = String((token as { login?: unknown } | null)?.login ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  if (!login) return false;
  return allow.has(login);
}

