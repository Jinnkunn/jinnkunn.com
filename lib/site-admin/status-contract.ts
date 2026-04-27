import type { SiteAdminStat, SiteAdminStatusPayload, SiteAdminStatusResult } from "./api-types";

import { isRecord } from "../client/api-guards.ts";
import {
  parseApiContract,
  toBooleanOrNull,
  toNumberOrNull,
  toStringValue,
} from "./contract-helpers.ts";

export function isSiteAdminStatusOk(v: SiteAdminStatusResult): v is SiteAdminStatusPayload {
  return v.ok;
}

function parseStat(value: unknown): SiteAdminStat | null {
  if (!isRecord(value)) return null;
  const exists = toBooleanOrNull(value.exists);
  if (exists === null) return null;
  const mtimeMs = toNumberOrNull(value.mtimeMs);
  const size = toNumberOrNull(value.size);
  const count = toNumberOrNull(value.count);
  return {
    exists,
    ...(mtimeMs !== null ? { mtimeMs } : {}),
    ...(size !== null ? { size } : {}),
    ...(count !== null ? { count } : {}),
  };
}

function parseSyncMeta(value: unknown): SiteAdminStatusPayload["content"]["syncMeta"] | null {
  if (value === null) return null;
  if (!isRecord(value)) return null;
  const syncedAt = toStringValue(value.syncedAt).trim();
  if (!syncedAt) return null;

  const out: NonNullable<SiteAdminStatusPayload["content"]["syncMeta"]> = { syncedAt };
  const maybeStringKeys = [
    "notionVersion",
    "adminPageId",
    "rootPageId",
    "homePageId",
    "homeTitle",
  ] as const;
  const maybeNumberKeys = [
    "pages",
    "routes",
    "routeOverrides",
    "protectedRules",
  ] as const;

  for (const key of maybeStringKeys) {
    const s = toStringValue(value[key]).trim();
    if (s) out[key] = s;
  }
  for (const key of maybeNumberKeys) {
    const n = toNumberOrNull(value[key]);
    if (n !== null) out[key] = n;
  }
  return out;
}

function parseNotionPage(
  value: unknown,
): SiteAdminStatusPayload["notion"]["adminPage"] | SiteAdminStatusPayload["notion"]["rootPage"] {
  if (value === null) return null;
  if (!isRecord(value)) return null;
  const id = toStringValue(value.id).trim();
  const lastEdited = toStringValue(value.lastEdited).trim();
  const title = toStringValue(value.title).trim();
  if (!id || !lastEdited || !title) return null;
  return { id, lastEdited, title };
}

function parseFreshness(
  value: unknown,
): SiteAdminStatusPayload["freshness"] | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const stale = value.stale === null ? null : toBooleanOrNull(value.stale);
  const syncMs = value.syncMs === null ? null : toNumberOrNull(value.syncMs);
  const notionEditedMs =
    value.notionEditedMs === null ? null : toNumberOrNull(value.notionEditedMs);
  const generatedLatestMs =
    value.generatedLatestMs === null ? null : toNumberOrNull(value.generatedLatestMs);
  if (stale === null && value.stale !== null) return null;
  if (syncMs === null && value.syncMs !== null) return null;
  if (notionEditedMs === null && value.notionEditedMs !== null) return null;
  if (generatedLatestMs === null && value.generatedLatestMs !== null) return null;
  return { stale, syncMs, notionEditedMs, generatedLatestMs };
}

function parseStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    out.push(item);
  }
  return out;
}

function parseDiagnostics(
  value: unknown,
): SiteAdminStatusPayload["diagnostics"] | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const total = toNumberOrNull(value.total);
  const warnCount = toNumberOrNull(value.warnCount);
  const errorCount = toNumberOrNull(value.errorCount);
  if (total === null || warnCount === null || errorCount === null) return null;
  const oldestAt = value.oldestAt === null ? null : toStringValue(value.oldestAt).trim() || null;
  const newestAt = value.newestAt === null ? null : toStringValue(value.newestAt).trim() || null;
  if (!Array.isArray(value.recent)) return null;
  const recent: NonNullable<SiteAdminStatusPayload["diagnostics"]>["recent"] = [];
  for (const item of value.recent) {
    if (!isRecord(item)) return null;
    const at = toStringValue(item.at).trim();
    const severityRaw = toStringValue(item.severity).trim();
    const severity =
      severityRaw === "warn" || severityRaw === "error" ? severityRaw : null;
    const source = toStringValue(item.source).trim();
    const message = toStringValue(item.message);
    if (!at || !severity || !source) return null;
    const detail = toStringValue(item.detail).trim();
    recent.push({
      at,
      severity,
      source,
      message,
      ...(detail ? { detail } : {}),
    });
  }
  return {
    total,
    warnCount,
    errorCount,
    oldestAt,
    newestAt,
    recent,
  };
}

function parsePreflight(
  value: unknown,
): SiteAdminStatusPayload["preflight"] | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  if (!isRecord(value.generatedFiles)) return null;
  if (!isRecord(value.routeOverrides)) return null;
  if (!isRecord(value.navigation)) return null;
  if (!isRecord(value.notionBlocks)) return null;

  const generatedOk = toBooleanOrNull(value.generatedFiles.ok);
  const generatedExpected = toNumberOrNull(value.generatedFiles.expected);
  const generatedMissing = parseStringList(value.generatedFiles.missingRoutes);
  if (generatedOk === null || generatedExpected === null || generatedMissing === null) return null;

  const overridesOk = toBooleanOrNull(value.routeOverrides.ok);
  const orphanPageIds = parseStringList(value.routeOverrides.orphanPageIds);
  const duplicatePaths = parseStringList(value.routeOverrides.duplicatePaths);
  if (overridesOk === null || orphanPageIds === null || duplicatePaths === null) return null;

  const navigationOk = toBooleanOrNull(value.navigation.ok);
  const invalidInternalHrefs = parseStringList(value.navigation.invalidInternalHrefs);
  if (navigationOk === null || invalidInternalHrefs === null) return null;

  const notionBlocksOk = toBooleanOrNull(value.notionBlocks.ok);
  const unsupportedBlockCount = toNumberOrNull(value.notionBlocks.unsupportedBlockCount);
  const pagesWithUnsupported = toNumberOrNull(value.notionBlocks.pagesWithUnsupported);
  const sampleRoutes = parseStringList(value.notionBlocks.sampleRoutes);
  if (
    notionBlocksOk === null ||
    unsupportedBlockCount === null ||
    pagesWithUnsupported === null ||
    sampleRoutes === null
  ) {
    return null;
  }

  return {
    generatedFiles: {
      ok: generatedOk,
      expected: generatedExpected,
      missingRoutes: generatedMissing,
    },
    routeOverrides: {
      ok: overridesOk,
      orphanPageIds,
      duplicatePaths,
    },
    navigation: {
      ok: navigationOk,
      invalidInternalHrefs,
    },
    notionBlocks: {
      ok: notionBlocksOk,
      unsupportedBlockCount,
      pagesWithUnsupported,
      sampleRoutes,
    },
  };
}

function parseNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const out = toStringValue(value).trim();
  return out || null;
}

function parseSource(
  value: unknown,
): SiteAdminStatusPayload["source"] | null {
  if (!isRecord(value)) return null;
  const storeKindRaw = toStringValue(value.storeKind).trim().toLowerCase();
  const storeKind =
    storeKindRaw === "github" ? "github" : storeKindRaw === "local" ? "local" : "";
  if (!storeKind) return null;
  const pendingDeploy =
    value.pendingDeploy === null ? null : toBooleanOrNull(value.pendingDeploy);
  if (pendingDeploy === null && value.pendingDeploy !== null) return null;
  const out: SiteAdminStatusPayload["source"] = {
    storeKind,
    repo: parseNullableString(value.repo),
    branch: parseNullableString(value.branch),
    headSha: parseNullableString(value.headSha),
    headCommitTime: parseNullableString(value.headCommitTime),
    pendingDeploy,
  };
  if ("pendingDeployReason" in value) {
    const pendingDeployReason = parseNullableString(value.pendingDeployReason);
    if (pendingDeployReason !== null) {
      out.pendingDeployReason = pendingDeployReason;
    }
  }
  if ("codeSha" in value) out.codeSha = parseNullableString(value.codeSha);
  if ("contentSha" in value) out.contentSha = parseNullableString(value.contentSha);
  if ("contentBranch" in value) {
    out.contentBranch = parseNullableString(value.contentBranch);
  }
  if ("deployableVersionReady" in value) {
    const ready =
      value.deployableVersionReady === null
        ? null
        : toBooleanOrNull(value.deployableVersionReady);
    if (ready === null && value.deployableVersionReady !== null) return null;
    out.deployableVersionReady = ready;
  }
  if ("deployableVersionReason" in value) {
    out.deployableVersionReason = parseNullableString(value.deployableVersionReason);
  }
  if ("deployableVersionId" in value) {
    out.deployableVersionId = parseNullableString(value.deployableVersionId);
  }
  const error = toStringValue(value.error).trim();
  if (error) out.error = error;
  return out;
}

function parseSiteAdminStatusPayload(value: unknown): SiteAdminStatusPayload | null {
  if (!isRecord(value)) return null;
  if (!isRecord(value.env) || !isRecord(value.build) || !isRecord(value.content)) return null;
  if (!isRecord(value.files) || !isRecord(value.notion) || !isRecord(value.source)) return null;

  const runtimeProviderRaw = toStringValue(value.env.runtimeProvider).trim().toLowerCase();
  const runtimeProviderParsed =
    runtimeProviderRaw === "local" ||
    runtimeProviderRaw === "vercel" ||
    runtimeProviderRaw === "cloudflare" ||
    runtimeProviderRaw === "unknown"
      ? runtimeProviderRaw
      : "";
  const runtimeProvider: SiteAdminStatusPayload["env"]["runtimeProvider"] =
    runtimeProviderParsed ||
    (toBooleanOrNull(value.env.isVercel) === true ? "vercel" : "local");

  const hasDeployTarget =
    value.env.hasDeployTarget === undefined
      ? toBooleanOrNull(value.env.hasDeployHookUrl)
      : toBooleanOrNull(value.env.hasDeployTarget);

  const env = {
    runtimeProvider,
    runtimeRegion:
      toStringValue(value.env.runtimeRegion) || toStringValue(value.env.vercelRegion),
    hasDeployTarget,
    nodeEnv: toStringValue(value.env.nodeEnv),
    isVercel: toBooleanOrNull(value.env.isVercel),
    vercelRegion: toStringValue(value.env.vercelRegion),
    hasNotionToken: toBooleanOrNull(value.env.hasNotionToken),
    hasNotionAdminPageId: toBooleanOrNull(value.env.hasNotionAdminPageId),
    notionVersion: toStringValue(value.env.notionVersion),
    hasDeployHookUrl:
      value.env.hasDeployHookUrl === undefined
        ? hasDeployTarget
        : toBooleanOrNull(value.env.hasDeployHookUrl),
    hasNextAuthSecret: toBooleanOrNull(value.env.hasNextAuthSecret),
    hasFlagsSecret: toBooleanOrNull(value.env.hasFlagsSecret),
    githubAllowlistCount: toNumberOrNull(value.env.githubAllowlistCount),
    contentGithubAllowlistCount: toNumberOrNull(value.env.contentGithubAllowlistCount),
  };
  if (
    env.hasDeployTarget === null ||
    env.isVercel === null ||
    env.hasNotionToken === null ||
    env.hasNotionAdminPageId === null ||
    env.hasDeployHookUrl === null ||
    env.hasNextAuthSecret === null ||
    env.hasFlagsSecret === null ||
    env.githubAllowlistCount === null ||
    env.contentGithubAllowlistCount === null
  ) {
    return null;
  }

  const buildProviderRaw = toStringValue(value.build.provider).trim().toLowerCase();
  const buildProvider: SiteAdminStatusPayload["build"]["provider"] =
    buildProviderRaw === "local" ||
    buildProviderRaw === "vercel" ||
    buildProviderRaw === "cloudflare" ||
    buildProviderRaw === "unknown"
      ? buildProviderRaw
      : env.runtimeProvider;

  const build = {
    provider: buildProvider,
    commitSha: toStringValue(value.build.commitSha),
    commitShort: toStringValue(value.build.commitShort),
    branch: toStringValue(value.build.branch),
    commitMessage: toStringValue(value.build.commitMessage),
    deploymentId: toStringValue(value.build.deploymentId),
    deploymentUrl:
      toStringValue(value.build.deploymentUrl) || toStringValue(value.build.vercelUrl),
    vercelUrl: toStringValue(value.build.vercelUrl),
  };

  if (!isRecord(value.content.nav)) return null;
  const navTop = toNumberOrNull(value.content.nav.top);
  const navMore = toNumberOrNull(value.content.nav.more);
  const routesDiscovered = toNumberOrNull(value.content.routesDiscovered);
  const searchIndexItems =
    value.content.searchIndexItems === null ? null : toNumberOrNull(value.content.searchIndexItems);
  const syncMeta = parseSyncMeta(value.content.syncMeta);
  if (navTop === null || navMore === null || routesDiscovered === null) return null;
  if (searchIndexItems === null && value.content.searchIndexItems !== null) return null;
  if (syncMeta === null && value.content.syncMeta !== null) return null;

  const files = {
    siteConfig: parseStat(value.files.siteConfig),
    routesManifest: parseStat(value.files.routesManifest),
    protectedRoutes: parseStat(value.files.protectedRoutes),
    syncMeta: parseStat(value.files.syncMeta),
    searchIndex: parseStat(value.files.searchIndex),
    routesJson: parseStat(value.files.routesJson),
    notionSyncCache: parseStat(value.files.notionSyncCache),
  };
  if (Object.values(files).some((it) => it === null)) return null;
  const siteConfigStat = files.siteConfig as SiteAdminStat;
  const routesManifestStat = files.routesManifest as SiteAdminStat;
  const protectedRoutesStat = files.protectedRoutes as SiteAdminStat;
  const syncMetaStat = files.syncMeta as SiteAdminStat;
  const searchIndexStat = files.searchIndex as SiteAdminStat;
  const routesJsonStat = files.routesJson as SiteAdminStat;
  const notionSyncCacheStat = files.notionSyncCache as SiteAdminStat;

  const adminPage = parseNotionPage(value.notion.adminPage);
  const rootPage = parseNotionPage(value.notion.rootPage);
  if (adminPage === null && value.notion.adminPage !== null) return null;
  if (rootPage === null && value.notion.rootPage !== null) return null;
  const source = parseSource(value.source);
  if (!source) return null;

  const freshness = parseFreshness(value.freshness);
  if (freshness === null) return null;
  const preflight = parsePreflight(value.preflight);
  if (preflight === null) return null;
  const diagnostics = parseDiagnostics(value.diagnostics);
  if (diagnostics === null) return null;

  return {
    ok: true,
    env: {
      nodeEnv: env.nodeEnv,
      runtimeProvider: env.runtimeProvider,
      runtimeRegion: env.runtimeRegion,
      hasDeployTarget: env.hasDeployTarget,
      isVercel: env.isVercel,
      vercelRegion: env.vercelRegion,
      hasNotionToken: env.hasNotionToken,
      hasNotionAdminPageId: env.hasNotionAdminPageId,
      notionVersion: env.notionVersion,
      hasDeployHookUrl: env.hasDeployHookUrl,
      hasNextAuthSecret: env.hasNextAuthSecret,
      hasFlagsSecret: env.hasFlagsSecret,
      githubAllowlistCount: env.githubAllowlistCount,
      contentGithubAllowlistCount: env.contentGithubAllowlistCount,
    },
    build,
    content: {
      siteName: toStringValue(value.content.siteName),
      nav: {
        top: navTop,
        more: navMore,
      },
      routesDiscovered,
      searchIndexItems,
      syncMeta,
    },
    files: {
      siteConfig: siteConfigStat,
      routesManifest: routesManifestStat,
      protectedRoutes: protectedRoutesStat,
      syncMeta: syncMetaStat,
      searchIndex: searchIndexStat,
      routesJson: routesJsonStat,
      notionSyncCache: notionSyncCacheStat,
    },
    notion: {
      adminPage,
      rootPage,
    },
    source,
    ...(preflight !== undefined ? { preflight } : {}),
    ...(freshness !== undefined ? { freshness } : {}),
    ...(diagnostics !== undefined ? { diagnostics } : {}),
  };
}

export function parseSiteAdminStatusResult(x: unknown): SiteAdminStatusResult | null {
  return parseApiContract<SiteAdminStatusResult>(x, parseSiteAdminStatusPayload);
}
