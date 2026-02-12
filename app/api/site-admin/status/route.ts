import path from "node:path";
import type { NextRequest } from "next/server";

import { parseAllowedAdminUsers } from "@/lib/site-admin-auth";
import { parseAllowedContentUsers } from "@/lib/content-auth";
import { notionRequest } from "@/lib/notion/api";
import { asRecordArray, isRecord, readTrimmedString } from "@/lib/notion/coerce";
import { getRoutesManifest } from "@/lib/routes-manifest";
import { getSearchIndex } from "@/lib/search-index";
import { apiErrorFromUnknown, apiOk, requireSiteAdmin } from "@/lib/server/site-admin-api";
import { getGeneratedContentDir, getNotionSyncCacheDir } from "@/lib/server/content-files";
import { safeDir, safeStat } from "@/lib/server/fs-stats";
import type { SiteAdminStatusPayload } from "@/lib/site-admin/api-types";
import { dashify32 } from "@/lib/shared/route-utils";
import { getSiteConfig } from "@/lib/site-config";
import { getSyncMeta } from "@/lib/sync-meta";

export const runtime = "nodejs";

type NotionPageMeta = {
  id: string;
  lastEdited: string;
  title: string;
};
type SiteAdminStatusResponsePayload = Omit<SiteAdminStatusPayload, "ok">;

function pickCommitSha(): string {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.CF_PAGES_COMMIT_SHA ||
    ""
  ).trim();
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

function extractPageTitleFromNotionProperties(properties: unknown): string {
  if (!isRecord(properties)) return "";
  for (const prop of Object.values(properties)) {
    if (!isRecord(prop)) continue;
    if (readTrimmedString(prop.type) !== "title") continue;
    const title = asRecordArray(prop.title)
      .map((x) => readTrimmedString(x.plain_text))
      .join("")
      .trim();
    if (title) return title;
  }
  return "";
}

async function fetchNotionPageMeta(pageId32: string): Promise<NotionPageMeta | null> {
  const token = (process.env.NOTION_TOKEN || "").trim();
  if (!token) return null;
  const dashed = dashify32(pageId32);
  if (!dashed) return null;
  const data = await notionRequest<unknown>(`pages/${dashed}`, { maxRetries: 2 }).catch(() => null);
  if (!isRecord(data)) return null;

  const lastEdited = readTrimmedString(data.last_edited_time);
  const title = extractPageTitleFromNotionProperties(data.properties);

  return { id: pageId32, lastEdited, title: title || "Untitled" };
}

export async function GET(req: NextRequest) {
  const auth = await requireSiteAdmin(req);
  if (!auth.ok) return auth.res;

  try {
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

    const notion: SiteAdminStatusResponsePayload["notion"] = {
      adminPage: null,
      rootPage: null,
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

    const payload: SiteAdminStatusResponsePayload = {
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
    };

    return apiOk(payload);
  } catch (e: unknown) {
    return apiErrorFromUnknown(e);
  }
}
