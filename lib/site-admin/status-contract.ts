import type { SiteAdminStat, SiteAdminStatusPayload, SiteAdminStatusResult } from "./api-types";

type ApiAck = { ok: true } | { ok: false; error: string };

export function isSiteAdminStatusOk(v: SiteAdminStatusResult): v is SiteAdminStatusPayload {
  return v.ok;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readApiErrorMessage(value: unknown): string {
  if (!isRecord(value)) return "";
  const error = value.error;
  return typeof error === "string" && error.trim() ? error : "";
}

function asApiAck(value: unknown, fallbackError = "Request failed"): ApiAck | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") return null;
  if (value.ok) return { ok: true };
  return { ok: false, error: readApiErrorMessage(value) || fallbackError };
}

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function toBooleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function parseStat(value: unknown): SiteAdminStat | null {
  if (!isRecord(value)) return null;
  const exists = toBooleanValue(value.exists);
  if (exists === null) return null;
  const mtimeMs = toNumberValue(value.mtimeMs);
  const size = toNumberValue(value.size);
  const count = toNumberValue(value.count);
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
    const n = toNumberValue(value[key]);
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
  const stale = value.stale === null ? null : toBooleanValue(value.stale);
  const syncMs = value.syncMs === null ? null : toNumberValue(value.syncMs);
  const notionEditedMs =
    value.notionEditedMs === null ? null : toNumberValue(value.notionEditedMs);
  const generatedLatestMs =
    value.generatedLatestMs === null ? null : toNumberValue(value.generatedLatestMs);
  if (stale === null && value.stale !== null) return null;
  if (syncMs === null && value.syncMs !== null) return null;
  if (notionEditedMs === null && value.notionEditedMs !== null) return null;
  if (generatedLatestMs === null && value.generatedLatestMs !== null) return null;
  return { stale, syncMs, notionEditedMs, generatedLatestMs };
}

function parseSiteAdminStatusPayload(value: unknown): SiteAdminStatusPayload | null {
  if (!isRecord(value) || value.ok !== true) return null;
  if (!isRecord(value.env) || !isRecord(value.build) || !isRecord(value.content)) return null;
  if (!isRecord(value.files) || !isRecord(value.notion)) return null;

  const env = {
    nodeEnv: toStringValue(value.env.nodeEnv),
    isVercel: toBooleanValue(value.env.isVercel),
    vercelRegion: toStringValue(value.env.vercelRegion),
    hasNotionToken: toBooleanValue(value.env.hasNotionToken),
    hasNotionAdminPageId: toBooleanValue(value.env.hasNotionAdminPageId),
    notionVersion: toStringValue(value.env.notionVersion),
    hasDeployHookUrl: toBooleanValue(value.env.hasDeployHookUrl),
    hasNextAuthSecret: toBooleanValue(value.env.hasNextAuthSecret),
    githubAllowlistCount: toNumberValue(value.env.githubAllowlistCount),
    contentGithubAllowlistCount: toNumberValue(value.env.contentGithubAllowlistCount),
  };
  if (
    env.isVercel === null ||
    env.hasNotionToken === null ||
    env.hasNotionAdminPageId === null ||
    env.hasDeployHookUrl === null ||
    env.hasNextAuthSecret === null ||
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
  const navTop = toNumberValue(value.content.nav.top);
  const navMore = toNumberValue(value.content.nav.more);
  const routesDiscovered = toNumberValue(value.content.routesDiscovered);
  const searchIndexItems =
    value.content.searchIndexItems === null ? null : toNumberValue(value.content.searchIndexItems);
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
    ...(freshness !== undefined ? { freshness } : {}),
  };
}

export function parseSiteAdminStatusResult(x: unknown): SiteAdminStatusResult | null {
  const ack = asApiAck(x);
  if (!ack) return null;
  if (!ack.ok) return { ok: false, error: readApiErrorMessage(ack) || "Request failed" };
  return parseSiteAdminStatusPayload(x);
}
