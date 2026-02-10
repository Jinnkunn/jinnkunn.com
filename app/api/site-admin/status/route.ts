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

function dashify32(id32: string): string {
  const s = String(id32 || "").replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(s)) return "";
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

async function fetchNotionPageMeta(
  pageId32: string,
): Promise<{ id: string; lastEdited: string; title: string } | null> {
  const token = (process.env.NOTION_TOKEN || "").trim();
  if (!token) return null;
  const dashed = dashify32(pageId32);
  if (!dashed) return null;

  const res = await fetch(`https://api.notion.com/v1/pages/${dashed}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": process.env.NOTION_VERSION || "2022-06-28",
    },
    cache: "no-store",
  });
  if (!res.ok) return null;

  const data = (await res.json().catch(() => null)) as any;
  if (!data) return null;

  const lastEdited = String(data?.last_edited_time || "").trim();

  let title = "";
  const props = data?.properties && typeof data.properties === "object" ? data.properties : null;
  if (props) {
    for (const v of Object.values(props)) {
      if (!v || typeof v !== "object") continue;
      if ((v as any).type !== "title") continue;
      const rt = Array.isArray((v as any).title) ? (v as any).title : [];
      title = rt.map((x: any) => x?.plain_text ?? "").join("").trim();
      break;
    }
  }

  return { id: pageId32, lastEdited, title: title || "Untitled" };
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

  const notion = {
    adminPage: null as null | { id: string; lastEdited: string; title: string },
    rootPage: null as null | { id: string; lastEdited: string; title: string },
  };

  // Best-effort: show Notion edit timestamps so admins can tell if the deploy is stale.
  try {
    const adminId = String(process.env.NOTION_SITE_ADMIN_PAGE_ID || "").trim();
    if (adminId) notion.adminPage = await fetchNotionPageMeta(adminId);
  } catch {
    // ignore
  }
  try {
    const rootId = String(syncMeta?.rootPageId || "").trim();
    if (rootId) notion.rootPage = await fetchNotionPageMeta(rootId);
  } catch {
    // ignore
  }

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
    notion,
    files,
  });
}
