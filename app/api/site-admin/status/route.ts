import fs from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";

import { isSiteAdminAuthorized, parseAllowedAdminUsers } from "@/lib/site-admin-auth";
import { parseAllowedContentUsers } from "@/lib/content-auth";
import { getRoutesManifest } from "@/lib/routes-manifest";
import { getSiteConfig } from "@/lib/site-config";
import { getSyncMeta } from "@/lib/sync-meta";

export const runtime = "nodejs";

function json(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: { "cache-control": "no-store" },
  });
}

async function requireAdmin(req: NextRequest) {
  const ok = await isSiteAdminAuthorized(req);
  if (!ok) {
    return { ok: false as const, res: json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  }
  return { ok: true as const };
}

function safeStat(filePath: string): { exists: boolean; mtimeMs?: number; size?: number } {
  try {
    const st = fs.statSync(filePath);
    return { exists: st.isFile(), mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return { exists: false };
  }
}

function pickCommitSha(): string {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.CF_PAGES_COMMIT_SHA ||
    ""
  ).trim();
}

function safeDir(filePath: string): { exists: boolean; mtimeMs?: number; size?: number; count?: number } {
  try {
    const st = fs.statSync(filePath);
    if (!st.isDirectory()) return { exists: false };
    const items = fs.readdirSync(filePath);
    return { exists: true, mtimeMs: st.mtimeMs, size: st.size, count: items.length };
  } catch {
    return { exists: false };
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const allow = parseAllowedAdminUsers();
  const allowContent = parseAllowedContentUsers();

  const syncMeta = getSyncMeta();
  const site = getSiteConfig();
  const manifest = getRoutesManifest();

  const root = process.cwd();
  const generatedDir = path.join(root, "content", "generated");

  const files = {
    siteConfig: safeStat(path.join(generatedDir, "site-config.json")),
    routesManifest: safeStat(path.join(generatedDir, "routes-manifest.json")),
    protectedRoutes: safeStat(path.join(generatedDir, "protected-routes.json")),
    syncMeta: safeStat(path.join(generatedDir, "sync-meta.json")),
    searchIndex: safeStat(path.join(generatedDir, "search-index.json")),
    routesJson: safeStat(path.join(generatedDir, "routes.json")),
    notionSyncCache: safeDir(path.join(root, ".next", "cache", "notion-sync")),
  };

  const commitSha = pickCommitSha();

  return json({
    ok: true,
    env: {
      nodeEnv: process.env.NODE_ENV || "",
      isVercel: Boolean(process.env.VERCEL),
      vercelRegion: process.env.VERCEL_REGION || "",
      hasNotionToken: Boolean(process.env.NOTION_TOKEN?.trim()),
      hasNotionAdminPageId: Boolean(process.env.NOTION_SITE_ADMIN_PAGE_ID?.trim()),
      notionVersion: process.env.NOTION_VERSION || "2022-06-28",
      hasDeployHookUrl: Boolean(process.env.VERCEL_DEPLOY_HOOK_URL?.trim()),
      hasNextAuthSecret: Boolean((process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "").trim()),
      githubAllowlistCount: allow.size,
      contentGithubAllowlistCount: allowContent.size,
    },
    build: {
      commitSha,
      commitShort: commitSha ? commitSha.slice(0, 7) : "",
      branch: (process.env.VERCEL_GIT_COMMIT_REF || process.env.GITHUB_REF_NAME || "").trim(),
      commitMessage: (process.env.VERCEL_GIT_COMMIT_MESSAGE || "").trim(),
      deploymentId: (process.env.VERCEL_DEPLOYMENT_ID || "").trim(),
      vercelUrl: (process.env.VERCEL_URL || "").trim(),
    },
    content: {
      siteName: site.siteName,
      nav: {
        top: site.nav.top.length,
        more: site.nav.more.length,
      },
      routesDiscovered: manifest.length,
      syncMeta,
    },
    files,
  });
}
