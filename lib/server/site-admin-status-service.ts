import "server-only";

import fs from "node:fs";
import path from "node:path";

import { getRoutesManifest } from "@/lib/routes-manifest";
import { getSearchIndex } from "@/lib/search-index";
import {
  getGeneratedContentDir,
  getNotionSyncCacheDir,
  listRawHtmlFiles,
} from "@/lib/server/content-files";
import {
  hasCloudflareApiDeployConfig,
  resolveCloudflareWorkerName,
} from "./cloudflare-deploy-env.ts";
import {
  describeDeployMetadataMismatch,
  parseDeployMetadataMessage,
  pickRuntimeCodeSha,
  type DeployVersionMetadata,
} from "./deploy-metadata.ts";
import { safeDir, safeStat } from "@/lib/server/fs-stats";
import { getSiteAdminSourceStore } from "@/lib/server/site-admin-source-store";
import type { SiteAdminStatusPayload } from "@/lib/site-admin/api-types";
import { parseAllowedContentUsers } from "@/lib/content-auth";
import { parseAllowedAdminUsers } from "@/lib/site-admin-auth";
import { compactId, normalizeRoutePath } from "@/lib/shared/route-utils";
import { getSiteConfig } from "@/lib/site-config";
import { getSyncMeta } from "@/lib/sync-meta";
import { readErrorLogSummary } from "@/lib/server/error-log";

export type SiteAdminStatusResponsePayload = Omit<SiteAdminStatusPayload, "ok">;
const REPRODUCIBLE_BUILD_EPOCH_MAX_MS = Date.UTC(2019, 0, 1);
const PREFLIGHT_SAMPLE_MAX = 8;

function pickCommitSha(): string {
  return (
    process.env.ACTIVE_DEPLOY_SOURCE_SHA ||
    process.env.DEPLOYED_SOURCE_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.CF_COMMIT_SHA ||
    process.env.CF_PAGES_COMMIT_SHA ||
    ""
  ).trim();
}

function pickRuntimeProvider(): SiteAdminStatusPayload["env"]["runtimeProvider"] {
  if (process.env.CF_PAGES || process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID) {
    return "cloudflare";
  }
  if (process.env.VERCEL) return "vercel";
  if (process.env.NODE_ENV) return "local";
  return "unknown";
}

function pickRuntimeRegion(): string {
  return (
    process.env.CF_REGION ||
    process.env.CLOUDFLARE_REGION ||
    process.env.VERCEL_REGION ||
    ""
  ).trim();
}

function pickBuildBranch(): string {
  return (
    process.env.CF_PAGES_BRANCH ||
    process.env.VERCEL_GIT_COMMIT_REF ||
    process.env.GITHUB_REF_NAME ||
    ""
  ).trim();
}

function pickBuildCommitMessage(): string {
  return (
    process.env.CF_PAGES_COMMIT_MESSAGE ||
    process.env.VERCEL_GIT_COMMIT_MESSAGE ||
    process.env.GITHUB_COMMIT_MESSAGE ||
    ""
  ).trim();
}

function pickDeploymentId(): string {
  return (
    process.env.CLOUDFLARE_DEPLOYMENT_ID ||
    process.env.CF_DEPLOYMENT_ID ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    ""
  ).trim();
}

function pickDeploymentUrl(): string {
  const raw =
    process.env.CLOUDFLARE_DEPLOYMENT_URL ||
    process.env.CF_PAGES_URL ||
    process.env.VERCEL_URL ||
    "";
  const value = String(raw || "").trim();
  if (!value) return "";
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function hasDeployTargetConfigured(): boolean {
  if (String(process.env.DEPLOY_HOOK_URL || "").trim()) return true;
  if (hasCloudflareApiDeployConfig(process.env)) {
    return true;
  }
  return false;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readCloudflareStatusConfig(): {
  accountId: string;
  apiToken: string;
  workerName: string;
} | null {
  const accountId = asString(process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID);
  const apiToken = asString(process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN);
  const workerName = resolveCloudflareWorkerName(process.env);
  if (!accountId || !apiToken || !workerName) return null;
  return { accountId, apiToken, workerName };
}

async function fetchCloudflareActiveDeploymentMetadata(): Promise<DeployVersionMetadata | null> {
  const cfg = readCloudflareStatusConfig();
  if (!cfg) return null;

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
      cfg.accountId,
    )}/workers/scripts/${encodeURIComponent(cfg.workerName)}/deployments`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cfg.apiToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    },
  ).catch(() => null);
  if (!(res instanceof Response) || !res.ok) return null;

  const raw = (await res.json().catch(() => null)) as unknown;
  const payload = asRecord(raw);
  if (payload.success !== true) return null;

  const result = asRecord(payload.result);
  const deployments = Array.isArray(result.deployments)
    ? result.deployments
    : Array.isArray(result.items)
      ? result.items
      : Array.isArray(payload.result)
        ? (payload.result as unknown[])
        : [];
  if (deployments.length === 0) return null;

  const latest = [...deployments]
    .map((item) => asRecord(item))
    .sort((a, b) => {
      const ta = Date.parse(asString(a.created_on));
      const tb = Date.parse(asString(b.created_on));
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return tb - ta;
      return asString(b.id).localeCompare(asString(a.id));
    })[0];
  if (!latest) return null;

  const annotations = asRecord(latest.annotations);
  return parseDeployMetadataMessage(annotations["workers/message"]);
}

async function fetchCloudflareLatestVersionMetadata(): Promise<
  (DeployVersionMetadata & { versionId: string | null }) | null
> {
  const cfg = readCloudflareStatusConfig();
  if (!cfg) return null;

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
      cfg.accountId,
    )}/workers/scripts/${encodeURIComponent(cfg.workerName)}/versions`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cfg.apiToken}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    },
  ).catch(() => null);
  if (!(res instanceof Response) || !res.ok) return null;

  const raw = (await res.json().catch(() => null)) as unknown;
  const payload = asRecord(raw);
  if (payload.success !== true) return null;
  const result = asRecord(payload.result);
  const items = Array.isArray(result.items)
    ? result.items
    : Array.isArray(payload.result)
      ? (payload.result as unknown[])
      : [];
  const first = asRecord(items[0]);
  const versionId = asString(first.id) || null;
  if (!versionId) return null;
  const annotations = asRecord(first.annotations);
  return {
    ...parseDeployMetadataMessage(annotations["workers/message"]),
    versionId,
  };
}

function derivePendingDeployReason(input: {
  runtimeProvider: SiteAdminStatusPayload["env"]["runtimeProvider"];
  headSha: string | null;
  deployedSourceSha: string | null;
  deployedCommitSha: string | null;
}): string | null {
  if (!input.headSha) return "SOURCE_HEAD_UNAVAILABLE";
  if (input.deployedSourceSha || input.deployedCommitSha) return null;
  if (input.runtimeProvider === "cloudflare") return "ACTIVE_DEPLOYMENT_SOURCE_SHA_UNAVAILABLE";
  return "ACTIVE_DEPLOYMENT_SHA_UNAVAILABLE";
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

function routePathToRawRel(routePath: string): string {
  const normalized = normalizeRoutePath(routePath);
  if (!normalized || normalized === "/") return "index";
  return normalized.replace(/^\/+/, "");
}

function rawRelToRoutePath(relPath: string): string {
  const rel = String(relPath || "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!rel || rel === "index") return "/";
  return `/${rel}`;
}

function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

function buildPreflight(input: {
  manifest: ReturnType<typeof getRoutesManifest>;
  site: ReturnType<typeof getSiteConfig>;
}): NonNullable<SiteAdminStatusResponsePayload["preflight"]> {
  const { manifest, site } = input;

  const manifestRouteSet = new Set<string>();
  const manifestPageIdSet = new Set<string>();
  for (const row of manifest) {
    const route = normalizeRoutePath(row.routePath);
    if (route) manifestRouteSet.add(route);
    const id = compactId(row.id);
    if (id) manifestPageIdSet.add(id);
  }

  const rawFiles = listRawHtmlFiles();
  const rawRelSet = new Set(rawFiles.map((it) => String(it.relPath || "").trim()).filter(Boolean));
  const missingRoutes = Array.from(manifestRouteSet)
    .filter((route) => !rawRelSet.has(routePathToRawRel(route)))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 100);

  const routeOverrides = site?.content?.routeOverrides && typeof site.content.routeOverrides === "object"
    ? site.content.routeOverrides
    : {};
  const orphanPageIds: string[] = [];
  const pathToOverrideIds = new Map<string, string[]>();
  for (const [rawPageId, rawRoutePath] of Object.entries(routeOverrides)) {
    const pageId = compactId(rawPageId) || String(rawPageId || "").trim();
    if (!pageId) continue;
    if (!manifestPageIdSet.has(pageId)) orphanPageIds.push(pageId);
    const routePath = normalizeRoutePath(String(rawRoutePath || ""));
    if (!routePath) continue;
    const ids = pathToOverrideIds.get(routePath) || [];
    ids.push(pageId);
    pathToOverrideIds.set(routePath, ids);
  }
  const duplicatePaths = Array.from(pathToOverrideIds.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([path]) => path)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 100);

  const invalidInternalHrefs: string[] = [];
  const allowedInternalRoutes = new Set<string>([
    ...manifestRouteSet,
    "/blog",
    "/sitemap",
    "/site-admin",
  ]);
  const navItems = [
    ...(Array.isArray(site?.nav?.top) ? site.nav.top : []),
    ...(Array.isArray(site?.nav?.more) ? site.nav.more : []),
  ];
  for (const item of navItems) {
    const href = String(item?.href || "").trim();
    if (!href || href.startsWith("#") || isExternalHref(href)) continue;
    const normalized = normalizeRoutePath(href);
    if (!normalized || !allowedInternalRoutes.has(normalized)) {
      const label = String(item?.label || "").trim();
      invalidInternalHrefs.push(label ? `${label}: ${href}` : href);
    }
  }

  let unsupportedBlockCount = 0;
  let pagesWithUnsupported = 0;
  const sampleRoutes: string[] = [];
  for (const raw of rawFiles) {
    let html = "";
    try {
      html = fs.readFileSync(raw.filePath, "utf8");
    } catch {
      continue;
    }
    const hits = html.match(/\bnotion-unsupported\b/g);
    if (!hits || hits.length === 0) continue;
    unsupportedBlockCount += hits.length;
    pagesWithUnsupported += 1;
    if (sampleRoutes.length < PREFLIGHT_SAMPLE_MAX) {
      sampleRoutes.push(rawRelToRoutePath(raw.relPath));
    }
  }

  return {
    generatedFiles: {
      ok: missingRoutes.length === 0,
      expected: manifestRouteSet.size,
      missingRoutes,
    },
    routeOverrides: {
      ok: orphanPageIds.length === 0 && duplicatePaths.length === 0,
      orphanPageIds: orphanPageIds.sort((a, b) => a.localeCompare(b)).slice(0, 100),
      duplicatePaths,
    },
    navigation: {
      ok: invalidInternalHrefs.length === 0,
      invalidInternalHrefs: invalidInternalHrefs.slice(0, 100),
    },
    notionBlocks: {
      ok: unsupportedBlockCount === 0,
      unsupportedBlockCount,
      pagesWithUnsupported,
      sampleRoutes,
    },
  };
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
  const deployedCommitSha = commitSha ? commitSha.toLowerCase() : null;

  const notion: SiteAdminStatusResponsePayload["notion"] = {
    adminPage: null,
    rootPage: null,
  };

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
  const preflight = buildPreflight({ manifest, site });
  let source: SiteAdminStatusResponsePayload["source"] = {
    storeKind: "local",
    repo: null,
    branch: null,
    headSha: null,
    headCommitTime: null,
    pendingDeploy: null,
  };

  try {
    const sourceState = await getSiteAdminSourceStore().getSourceState();
    const headSha = sourceState.headSha ? sourceState.headSha.toLowerCase() : null;
    const runtimeProvider = pickRuntimeProvider();
    const activeDeployment =
      runtimeProvider === "cloudflare"
        ? await fetchCloudflareActiveDeploymentMetadata().catch(() => null)
        : null;
    const deployedSourceSha = activeDeployment?.contentSha || activeDeployment?.sourceSha || null;
    const codeSha = pickRuntimeCodeSha();
    const latestVersion =
      runtimeProvider === "cloudflare"
        ? await fetchCloudflareLatestVersionMetadata().catch(() => null)
        : null;
    const deployableVersionMismatch = latestVersion
      ? describeDeployMetadataMismatch({
          actual: latestVersion,
          expected: {
            codeSha,
            contentSha: headSha,
            contentBranch: sourceState.branch ?? null,
          },
        })
      : null;
    const deployableVersionReady =
      runtimeProvider === "cloudflare"
        ? latestVersion
          ? deployableVersionMismatch
            ? false
            : true
          : null
        : null;
    const deployableVersionReason =
      runtimeProvider !== "cloudflare"
        ? null
        : latestVersion
          ? deployableVersionMismatch
            ? `DEPLOY_VERSION_STALE: ${deployableVersionMismatch}`
            : null
          : "LATEST_WORKER_VERSION_UNAVAILABLE";
    const pendingDeploy =
      headSha && deployedSourceSha
        ? headSha !== deployedSourceSha
        : headSha && deployedCommitSha
          ? headSha !== deployedCommitSha
        : null;
    const pendingDeployReason =
      pendingDeploy === null
        ? derivePendingDeployReason({
            runtimeProvider,
            headSha,
            deployedSourceSha,
            deployedCommitSha,
          })
        : null;
    source = {
      storeKind: sourceState.storeKind,
      repo: sourceState.repo,
      branch: sourceState.branch,
      headSha: sourceState.headSha,
      headCommitTime: sourceState.headCommitTime,
      pendingDeploy,
      codeSha,
      contentSha: headSha,
      contentBranch: sourceState.branch ?? null,
      deployableVersionReady,
      ...(deployableVersionReason ? { deployableVersionReason } : {}),
      ...(latestVersion?.versionId ? { deployableVersionId: latestVersion.versionId } : {}),
      ...(pendingDeployReason ? { pendingDeployReason } : {}),
    };
  } catch (err: unknown) {
    const configuredKind =
      String(process.env.SITE_ADMIN_STORAGE || "local").trim().toLowerCase() === "github"
        ? "github"
        : "local";
    source = {
      storeKind: configuredKind,
      repo: null,
      branch: null,
      headSha: null,
      headCommitTime: null,
      pendingDeploy: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    env: {
      nodeEnv: process.env.NODE_ENV || "",
      runtimeProvider: pickRuntimeProvider(),
      runtimeRegion: pickRuntimeRegion(),
      hasDeployTarget: hasDeployTargetConfigured(),
      isVercel: Boolean(process.env.VERCEL),
      vercelRegion: process.env.VERCEL_REGION || "",
      hasNotionToken: false,
      hasNotionAdminPageId: false,
      notionVersion: "",
      hasDeployHookUrl: Boolean((process.env.DEPLOY_HOOK_URL || "").trim()),
      hasNextAuthSecret: Boolean((process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "").trim()),
      hasFlagsSecret: true,
      githubAllowlistCount: allow.size,
      contentGithubAllowlistCount: allowContent.size,
    },
    build: {
      provider: pickRuntimeProvider(),
      commitSha,
      commitShort: commitSha ? commitSha.slice(0, 7) : "",
      branch: pickBuildBranch(),
      commitMessage: pickBuildCommitMessage(),
      deploymentId: pickDeploymentId(),
      deploymentUrl: pickDeploymentUrl(),
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
    source,
    preflight,
    freshness: {
      stale,
      syncMs: Number.isFinite(effectiveSyncMs) ? effectiveSyncMs : null,
      notionEditedMs: Number.isFinite(notionLatestEditedMs) ? notionLatestEditedMs : null,
      generatedLatestMs: Number.isFinite(generatedLatestMs) ? generatedLatestMs : null,
    },
    diagnostics: readErrorLogSummary(10),
    files,
  };
}
