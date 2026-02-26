import "server-only";

import path from "node:path";

import { notionRequest } from "@/lib/notion/api";
import { parseNotionPageMeta } from "@/lib/notion/adapters";
import { readTrimmedString } from "@/lib/notion/coerce";
import { getRoutesManifest } from "@/lib/routes-manifest";
import { getSearchIndex } from "@/lib/search-index";
import { getGeneratedContentDir, getNotionSyncCacheDir } from "@/lib/server/content-files";
import { safeDir, safeStat } from "@/lib/server/fs-stats";
import type { SiteAdminStatusPayload } from "@/lib/site-admin/api-types";
import { parseAllowedContentUsers } from "@/lib/content-auth";
import { parseAllowedAdminUsers } from "@/lib/site-admin-auth";
import { dashify32 } from "@/lib/shared/route-utils";
import { getSiteConfig } from "@/lib/site-config";
import { getSyncMeta } from "@/lib/sync-meta";
import type { NotionPageMeta } from "@/lib/notion/types";

export type SiteAdminStatusResponsePayload = Omit<SiteAdminStatusPayload, "ok">;
const REPRODUCIBLE_BUILD_EPOCH_MAX_MS = Date.UTC(2019, 0, 1);

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

function hasEffectiveFlagsSecret(): boolean {
  const explicit = String(process.env.FLAGS_SECRET || "").trim();
  if (explicit) return true;
  const fallback = String(process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "").trim();
  return Boolean(fallback);
}

async function fetchNotionPageMeta(pageId32: string): Promise<NotionPageMeta | null> {
  const token = (process.env.NOTION_TOKEN || "").trim();
  if (!token) return null;
  const dashed = dashify32(pageId32);
  if (!dashed) return null;
  const data = await notionRequest<unknown>(`pages/${dashed}`, { maxRetries: 2 }).catch(() => null);
  const parsed = parseNotionPageMeta(data, { fallbackId: pageId32, fallbackTitle: "Untitled" });
  if (!parsed) return null;
  return {
    id: readTrimmedString(pageId32) || parsed.id,
    title: parsed.title,
    lastEdited: parsed.lastEdited,
  };
}

function normalizeGeneratedFileMtime(
  stat: SiteAdminStatusPayload["files"]["siteConfig"],
  syncedAtMs: number,
): SiteAdminStatusPayload["files"]["siteConfig"] {
  if (!stat.exists || !Number.isFinite(syncedAtMs)) return stat;
  const mtimeMs = Number.isFinite(stat.mtimeMs ?? NaN) ? (stat.mtimeMs as number) : NaN;
  // In some production builds, file mtimes are deterministic (e.g., 2018 epoch).
  // Treat those as non-informative and use sync time for status UI/comparison.
  if (!Number.isFinite(mtimeMs) || mtimeMs < REPRODUCIBLE_BUILD_EPOCH_MAX_MS) {
    return { ...stat, mtimeMs: syncedAtMs };
  }
  return stat;
}

export async function buildSiteAdminStatusPayload(): Promise<SiteAdminStatusResponsePayload> {
  const allow = parseAllowedAdminUsers();
  const allowContent = parseAllowedContentUsers();

  const syncMeta = getSyncMeta();
  const site = getSiteConfig();
  const manifest = getRoutesManifest();
  const generatedDir = getGeneratedContentDir();

  const baseFiles = {
    siteConfig: safeStat(path.join(generatedDir, "site-config.json")),
    routesManifest: safeStat(path.join(generatedDir, "routes-manifest.json")),
    protectedRoutes: safeStat(path.join(generatedDir, "protected-routes.json")),
    syncMeta: safeStat(path.join(generatedDir, "sync-meta.json")),
    searchIndex: safeStat(path.join(generatedDir, "search-index.json")),
    routesJson: safeStat(path.join(generatedDir, "routes.json")),
    notionSyncCache: safeDir(getNotionSyncCacheDir()),
  };
  const syncedAtMs = syncMeta?.syncedAt ? parseIsoMs(syncMeta.syncedAt) : NaN;

  const files = {
    ...baseFiles,
    siteConfig: normalizeGeneratedFileMtime(baseFiles.siteConfig, syncedAtMs),
    routesManifest: normalizeGeneratedFileMtime(baseFiles.routesManifest, syncedAtMs),
    protectedRoutes: normalizeGeneratedFileMtime(baseFiles.protectedRoutes, syncedAtMs),
    syncMeta: normalizeGeneratedFileMtime(baseFiles.syncMeta, syncedAtMs),
    searchIndex: normalizeGeneratedFileMtime(baseFiles.searchIndex, syncedAtMs),
    routesJson: normalizeGeneratedFileMtime(baseFiles.routesJson, syncedAtMs),
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

  const notionLatestEditedMs = maxFinite([
    notion.adminPage?.lastEdited ? parseIsoMs(notion.adminPage.lastEdited) : NaN,
    notion.rootPage?.lastEdited ? parseIsoMs(notion.rootPage.lastEdited) : NaN,
  ]);

  const effectiveSyncMs = Number.isFinite(syncedAtMs) ? syncedAtMs : generatedLatestMs;
  const stale =
    Number.isFinite(notionLatestEditedMs) && Number.isFinite(effectiveSyncMs)
      ? notionLatestEditedMs > effectiveSyncMs + 3_000
      : null;

  return {
    env: {
      nodeEnv: process.env.NODE_ENV || "",
      isVercel: Boolean(process.env.VERCEL),
      vercelRegion: process.env.VERCEL_REGION || "",
      hasNotionToken: Boolean(process.env.NOTION_TOKEN?.trim()),
      hasNotionAdminPageId: Boolean(process.env.NOTION_SITE_ADMIN_PAGE_ID?.trim()),
      notionVersion: process.env.NOTION_VERSION || "2022-06-28",
      hasDeployHookUrl: Boolean(process.env.VERCEL_DEPLOY_HOOK_URL?.trim()),
      hasNextAuthSecret: Boolean((process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "").trim()),
      hasFlagsSecret: hasEffectiveFlagsSecret(),
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
}
