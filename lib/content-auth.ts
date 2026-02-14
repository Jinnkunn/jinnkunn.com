import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

import siteConfig from "@/content/generated/site-config.json";
import { normalizeGithubUserList, parseGithubUserCsv } from "@/lib/shared/github-users";
import { isSiteAdminAuthorized } from "@/lib/site-admin-auth";

function isObject(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

export function parseAllowedContentUsers(): Set<string> {
  // 1) Notion-controlled allowlist (compiled at deploy time).
  let fromConfig: string[] = [];
  try {
    const cfg = siteConfig as unknown;
    const security = isObject(cfg) ? cfg.security : null;
    const users =
      security && isObject(security) ? (security.contentGithubUsers as unknown) : null;
    fromConfig = normalizeGithubUserList(users);
  } catch {
    // ignore
  }

  // 2) Optional environment override (emergency break-glass).
  const env = parseGithubUserCsv((process.env.CONTENT_GITHUB_USERS || "").trim());

  return new Set([...fromConfig, ...env]);
}

export async function isContentGithubAuthorized(req: NextRequest): Promise<boolean> {
  // Site admins can always access protected content.
  if (await isSiteAdminAuthorized(req)) return true;

  const allow = parseAllowedContentUsers();
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
