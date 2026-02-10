import path from "node:path";
import type { NextRequest } from "next/server";

import { isSiteAdminAuthorized, parseAllowedAdminUsers } from "@/lib/site-admin-auth";
import { parseAllowedContentUsers } from "@/lib/content-auth";
import { notionRequest } from "@/lib/notion/api.mjs";
import { getRoutesManifest } from "@/lib/routes-manifest";
import { getSearchIndex } from "@/lib/search-index";
import { getGeneratedContentDir, getNotionSyncCacheDir } from "@/lib/server/content-files";
import { safeDir, safeStat } from "@/lib/server/fs-stats";
import { jsonNoStore } from "@/lib/server/validate";
import { dashify32 } from "@/lib/shared/route-utils.mjs";
import { getSiteConfig } from "@/lib/site-config";
import { getSyncMeta } from "@/lib/sync-meta";

export const runtime = "nodejs";

const json = jsonNoStore;

async function requireAdmin(req: NextRequest) {
  const ok = await isSiteAdminAuthorized(req);
  if (!ok) {
    return { ok: false as const, res: json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  }
  return { ok: true as const };
}

function pickCommitSha(): string {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.CF_PAGES_COMMIT_SHA ||
    ""
  ).trim();
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

function parseIsoMs(iso: string): number {
  const t = Date.parse(String(iso || "").trim());
  return Number.isFinite(t) ? t : NaN;
}

function maxFinite(nums: number[]): number {
  let best = NaN;
  for (const n of nums) {
    if (!Number.isFinite(n)) continue;
    if (!Number.isFinite(best) || n > best) best = n;
  }
  return best;
}

async function fetchNotionPageMeta(
  pageId32: string,
): Promise<{ id: string; lastEdited: string; title: string } | null> {
  const token = (process.env.NOTION_TOKEN || "").trim();
  if (!token) return null;
  const dashed = dashify32(pageId32);
  if (!dashed) return null;
  const data = (await notionRequest(`pages/${dashed}`, { maxRetries: 2 }).catch(() => null)) as unknown;
  if (!isRecord(data)) return null;

  const lastEdited = String(data.last_edited_time || "").trim();

  let title = "";
  const props = isRecord(data.properties) ? data.properties : null;
  if (props) {
    for (const v0 of Object.values(props)) {
      if (!isRecord(v0)) continue;
      if (String(v0.type || "") !== "title") continue;
      const rt0 = v0.title;
      const rt = Array.isArray(rt0) ? rt0 : [];
      title = rt
        .map((x) => (isRecord(x) ? String(x.plain_text || "") : ""))
        .join("")
        .trim();
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

  const generatedDir = getGeneratedContentDir();

  const files = {
    siteConfig: safeStat(path.join(generatedDir, "site-config.json")),
    routesManifest: safeStat(path.join(generatedDir, "routes-manifest.json")),
    protectedRoutes: safeStat(path.join(generatedDir, "protected-routes.json")),
    syncMeta: safeStat(path.join(generatedDir, "sync-meta.json")),
    searchIndex: safeStat(path.join(generatedDir, "search-index.json")),
    routesJson: safeStat(path.join(generatedDir, "routes.json")),
    notionSyncCache: safeDir(getNotionSyncCacheDir()),
  };
  const searchIndexItems = files.searchIndex.exists ? getSearchIndex().length : null;

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

  const generatedLatestMs = maxFinite([
    files.siteConfig.mtimeMs ?? NaN,
    files.routesManifest.mtimeMs ?? NaN,
    files.protectedRoutes.mtimeMs ?? NaN,
    files.syncMeta.mtimeMs ?? NaN,
    files.searchIndex.mtimeMs ?? NaN,
    files.routesJson.mtimeMs ?? NaN,
  ]);

  const syncedAtMs = syncMeta?.syncedAt ? parseIsoMs(syncMeta.syncedAt) : NaN;
  const notionLatestEditedMs = maxFinite([
    notion.adminPage?.lastEdited ? parseIsoMs(notion.adminPage.lastEdited) : NaN,
    notion.rootPage?.lastEdited ? parseIsoMs(notion.rootPage.lastEdited) : NaN,
  ]);

  const effectiveSyncMs = Number.isFinite(syncedAtMs) ? syncedAtMs : generatedLatestMs;
  const stale =
    Number.isFinite(notionLatestEditedMs) && Number.isFinite(effectiveSyncMs)
      ? notionLatestEditedMs > effectiveSyncMs + 3_000
      : null;

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
      searchIndexItems,
      syncMeta,
    },
    notion,
    freshness: {
      stale,
      syncMs: Number.isFinite(effectiveSyncMs) ? effectiveSyncMs : null,
      notionEditedMs: Number.isFinite(notionLatestEditedMs) ? notionLatestEditedMs : null,
      generatedLatestMs: Number.isFinite(generatedLatestMs) ? generatedLatestMs : null,
    },
    files,
  });
}
