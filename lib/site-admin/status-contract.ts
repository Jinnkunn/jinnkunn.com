import type { SiteAdminStat, SiteAdminStatusPayload, SiteAdminStatusResult } from "./api-types";

import {
  asApiAck,
  isRecord,
  readApiErrorCode,
  readApiErrorMessage,
  unwrapApiData,
} from "../client/api-guards.ts";
import {
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

function parseSiteAdminStatusPayload(value: unknown): SiteAdminStatusPayload | null {
  if (!isRecord(value)) return null;
  if (!isRecord(value.env) || !isRecord(value.build) || !isRecord(value.content)) return null;
  if (!isRecord(value.files) || !isRecord(value.notion)) return null;

  const env = {
    nodeEnv: toStringValue(value.env.nodeEnv),
    isVercel: toBooleanOrNull(value.env.isVercel),
    vercelRegion: toStringValue(value.env.vercelRegion),
    hasNotionToken: toBooleanOrNull(value.env.hasNotionToken),
    hasNotionAdminPageId: toBooleanOrNull(value.env.hasNotionAdminPageId),
    notionVersion: toStringValue(value.env.notionVersion),
    hasDeployHookUrl: toBooleanOrNull(value.env.hasDeployHookUrl),
    hasNextAuthSecret: toBooleanOrNull(value.env.hasNextAuthSecret),
    hasFlagsSecret: toBooleanOrNull(value.env.hasFlagsSecret),
    githubAllowlistCount: toNumberOrNull(value.env.githubAllowlistCount),
    contentGithubAllowlistCount: toNumberOrNull(value.env.contentGithubAllowlistCount),
  };
  if (
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

  const build = {
    commitSha: toStringValue(value.build.commitSha),
    commitShort: toStringValue(value.build.commitShort),
    branch: toStringValue(value.build.branch),
    commitMessage: toStringValue(value.build.commitMessage),
    deploymentId: toStringValue(value.build.deploymentId),
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

  const freshness = parseFreshness(value.freshness);
  if (freshness === null) return null;
  const preflight = parsePreflight(value.preflight);
  if (preflight === null) return null;

  return {
    ok: true,
    env: {
      nodeEnv: env.nodeEnv,
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
    ...(preflight !== undefined ? { preflight } : {}),
    ...(freshness !== undefined ? { freshness } : {}),
  };
}

export function parseSiteAdminStatusResult(x: unknown): SiteAdminStatusResult | null {
  const ack = asApiAck(x);
  if (!ack) return null;
  if (!ack.ok) {
    return {
      ok: false,
      error: readApiErrorMessage(x) || ack.error || "Request failed",
      code: readApiErrorCode(x) || ack.code || "REQUEST_FAILED",
    };
  }
  const payload = unwrapApiData(x);
  return parseSiteAdminStatusPayload(payload);
}
