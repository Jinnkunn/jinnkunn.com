import crypto from "node:crypto";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { createD1Executor, type D1DatabaseLike } from "./d1-executor.ts";
import { localContentOverridesEnabled } from "./local-content-overrides.ts";
import { getCurrentSiteAdminActor } from "./site-admin-actor-context.ts";
import {
  createDbFileBackend,
  createFsFileBackend,
  isSiteAdminFileBackendConflictError,
  type SiteAdminFileBackend,
  type SiteAdminFileStat,
} from "./site-admin-file-backend.ts";

import type {
  SiteAdminProtectedRoute,
  SiteAdminRouteOverride,
} from "../site-admin/api-types.ts";
import type { NavItemRow, SiteSettings } from "../site-admin/types.ts";
import {
  normalizeProtectedAccessMode,
  type ProtectedAccessMode,
} from "../shared/access.ts";
import { parseDepthNumber } from "../shared/depth.ts";
import { DEFAULT_SITE_CONFIG } from "../shared/default-site-config.ts";
import { normalizeGoogleAnalyticsId } from "../shared/google-analytics.ts";
import { parseGithubUserCsv } from "../shared/github-users.ts";
import { compactId, normalizeRoutePath } from "../shared/route-utils.ts";
import { normalizeSeoPageOverrides } from "../shared/seo-page-overrides.ts";
import { parseSitemapExcludeEntries } from "../shared/sitemap-excludes.ts";
import {
  normalizeSitemapAutoExclude,
  parseSitemapSectionList,
} from "../shared/sitemap-policy.ts";

const SITE_CONFIG_REL_PATH = "site-config.json";
const PROTECTED_ROUTES_REL_PATH = "protected-routes.json";
const CONTENT_LOCAL_DIR = "content/local";
const ROUTES_MANIFEST_REL_PATH = "routes-manifest.json";
const CONTENT_FILESYSTEM_DIR = "content/filesystem";
const CONTENT_GENERATED_DIR = "content/generated";

const SITE_SETTINGS_ROW_ID = "00000000000000000000000000000001";
const SOURCE_ADMIN_PAGE_ID = "filesystem-admin";
const SOURCE_OVERRIDES_DB_ID = "filesystem-overrides";
const SOURCE_PROTECTED_DB_ID = "filesystem-protected";

type JsonRecord = Record<string, unknown>;

type RawSourceSnapshot = {
  siteConfig: JsonRecord;
  protectedRoutes: StoredProtectedRoute[];
  routesManifest: unknown[];
  version: SiteAdminSourceVersion;
  branchHeadSha?: string;
  branchHeadCommitTime?: string | null;
};

type StoredProtectedRoute = {
  id: string;
  auth: ProtectedAccessMode;
  key: "pageId" | "path";
  pageId: string;
  path: string;
  mode: "exact" | "prefix";
  token: string;
};

export type SiteAdminSourceVersion = {
  siteConfigSha: string;
  protectedRoutesSha: string;
  branchSha: string;
};

export type SiteAdminConfigSourceVersion = Pick<
  SiteAdminSourceVersion,
  "siteConfigSha" | "branchSha"
>;

export type SiteAdminRoutesSourceVersion = SiteAdminSourceVersion;

export type SiteAdminConfigSnapshot = {
  settings: SiteSettings;
  nav: NavItemRow[];
  sourceVersion: SiteAdminConfigSourceVersion;
};

export type SiteAdminRoutesSnapshot = {
  adminPageId: string;
  databases: {
    overridesDbId: string;
    protectedDbId: string;
  };
  overrides: SiteAdminRouteOverride[];
  protectedRoutes: SiteAdminProtectedRoute[];
  sourceVersion: SiteAdminRoutesSourceVersion;
};

export type SiteAdminSourceState = {
  storeKind: "local" | "db";
  repo: string | null;
  branch: string | null;
  headSha: string | null;
  headCommitTime: string | null;
};

export type SiteAdminFileHistoryEntry = {
  commitSha: string;
  commitShort: string;
  committedAt: string | null;
  authorName: string;
  message: string;
};

export class SiteAdminSourceConflictError extends Error {
  readonly code = "SOURCE_CONFLICT";
  readonly expectedSha: string;
  readonly currentSha: string;

  constructor(input: {
    expectedSha: string;
    currentSha: string;
    message?: string;
  }) {
    super(input.message || "SOURCE_CONFLICT: source changed, reload latest and try again.");
    this.name = "SiteAdminSourceConflictError";
    this.expectedSha = input.expectedSha;
    this.currentSha = input.currentSha;
  }
}

export function isSiteAdminSourceConflictError(
  err: unknown,
): err is SiteAdminSourceConflictError {
  return err instanceof SiteAdminSourceConflictError;
}

export class SiteAdminSourceWriteError extends Error {
  readonly code = "SOURCE_WRITE_FAILED";
  readonly status = 502;

  constructor(message: string) {
    super(message);
    this.name = "SiteAdminSourceWriteError";
  }
}

export function isSiteAdminSourceWriteError(
  err: unknown,
): err is SiteAdminSourceWriteError {
  return err instanceof SiteAdminSourceWriteError;
}

export interface SiteAdminSourceStore {
  readonly kind: "local" | "db";
  /** Lightweight existence + size + mtime probe for a repo-relative file.
   * Used by the Status panel to render the GENERATED FILES card without
   * pulling full bodies. */
  statFile(repoRel: string): Promise<SiteAdminFileStat>;
  loadConfig(): Promise<SiteAdminConfigSnapshot>;
  updateSettings(input: {
    rowId: string;
    patch: Partial<Omit<SiteSettings, "rowId">>;
    expectedSiteConfigSha: string;
    allowStaleSiteConfigSha?: boolean;
  }): Promise<SiteAdminConfigSourceVersion>;
  updateNavRow(input: {
    rowId: string;
    patch: Partial<Omit<NavItemRow, "rowId">>;
    expectedSiteConfigSha: string;
  }): Promise<SiteAdminConfigSourceVersion>;
  createNavRow(input: {
    row: Omit<NavItemRow, "rowId">;
    expectedSiteConfigSha: string;
  }): Promise<{ created: NavItemRow; sourceVersion: SiteAdminConfigSourceVersion }>;
  /** Read a UTF-8 file at the repo-root-relative path. Returns null when
   * the file doesn't exist. Used for new structured-data features (e.g.
   * publications.json) that don't fit the SiteSettings / NavRows / Routes
   * schemas baked into the methods above. */
  readTextFile(relPath: string): Promise<{ content: string; sha: string } | null>;
  listTextFileHistory(
    relPath: string,
    limit?: number,
  ): Promise<SiteAdminFileHistoryEntry[]>;
  readTextFileAtCommit(
    relPath: string,
    commitSha: string,
  ): Promise<{ content: string; sha: string; commitSha: string } | null>;
  /** Write a UTF-8 file at the repo-root-relative path, creating the
   * commit on the configured branch. `expectedSha` (if provided) is
   * checked before write and a SOURCE_CONFLICT is raised on mismatch. */
  writeTextFile(input: {
    relPath: string;
    content: string;
    expectedSha?: string;
    message?: string;
  }): Promise<{ fileSha: string; commitSha: string }>;
  loadRoutes(): Promise<SiteAdminRoutesSnapshot>;
  updateOverride(input: {
    pageId: string;
    routePath: string;
    expectedSiteConfigSha: string;
  }): Promise<SiteAdminRoutesSourceVersion>;
  updateProtected(input: {
    pageId: string;
    path: string;
    mode: "exact" | "prefix";
    auth: ProtectedAccessMode;
    password: string;
    delete?: boolean;
    expectedProtectedRoutesSha: string;
  }): Promise<SiteAdminRoutesSourceVersion>;
  getSourceState(): Promise<SiteAdminSourceState>;
}

let __siteAdminSourceStore: SiteAdminSourceStore | null = null;

function isD1Like(value: unknown): value is D1DatabaseLike {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { prepare?: unknown }).prepare === "function"
  );
}

function tryCreateDbBackend(): SiteAdminFileBackend | null {
  // getCloudflareContext throws outside a request lifecycle (build, scripts,
  // tests). Fall back to fs in those cases — same forgiving behavior the
  // content-store-resolver uses, and matches what the existing local store
  // does when content/filesystem/* is on disk.
  try {
    const { env } = getCloudflareContext();
    const binding = (env as Record<string, unknown>).SITE_ADMIN_DB;
    if (!isD1Like(binding)) return null;
    return createDbFileBackend({
      executor: createD1Executor(binding),
      getActor: getCurrentSiteAdminActor,
    });
  } catch {
    return null;
  }
}

export function getSiteAdminSourceStore(): SiteAdminSourceStore {
  if (__siteAdminSourceStore) return __siteAdminSourceStore;
  const kind = String(process.env.SITE_ADMIN_STORAGE || "local")
    .trim()
    .toLowerCase();
  if (kind === "db") {
    const dbBackend = tryCreateDbBackend();
    if (dbBackend) {
      __siteAdminSourceStore = createLocalSiteAdminSourceStore({
        backend: dbBackend,
      });
      return __siteAdminSourceStore;
    }
    // No CF binding (build time, scripts, tests) → fall through to fs so
    // build-time route handlers can still execute against the disk content
    // that prebuild dumped from D1. Don't cache so a later request-time
    // call can re-attempt and pick up the binding.
    return createLocalSiteAdminSourceStore();
  }
  if (kind === "local" || !kind) {
    __siteAdminSourceStore = createLocalSiteAdminSourceStore();
    return __siteAdminSourceStore;
  }
  throw new Error(`Unsupported SITE_ADMIN_STORAGE: ${kind}`);
}

export function createLocalSiteAdminSourceStore(opts?: {
  rootDir?: string;
  backend?: SiteAdminFileBackend;
}): SiteAdminSourceStore {
  return new LocalSiteAdminSourceStore(
    opts?.rootDir || process.cwd(),
    opts?.backend,
  );
}

class LocalSiteAdminSourceStore implements SiteAdminSourceStore {
  readonly kind: "local" | "db";

  private readonly rootDir: string;
  private readonly backend: SiteAdminFileBackend;

  constructor(rootDir: string, backend?: SiteAdminFileBackend) {
    this.rootDir = rootDir;
    this.backend = backend ?? createFsFileBackend({ rootDir });
    // Surface the backend kind on the store so consumers (status panel,
    // /api responses) reflect the actual storage source. "fs" maps back
    // to "local" — historical callers still expect that label.
    this.kind = this.backend.kind === "db" ? "db" : "local";
  }

  async loadConfig(): Promise<SiteAdminConfigSnapshot> {
    const source = await this.loadSourceSnapshot();
    const settings = mapSiteSettings(source.siteConfig);
    const nav = mapNavRows(source.siteConfig);
    return {
      settings,
      nav,
      sourceVersion: pickConfigVersion(source.version),
    };
  }

  async updateSettings(input: {
    rowId: string;
    patch: Partial<Omit<SiteSettings, "rowId">>;
    expectedSiteConfigSha: string;
    allowStaleSiteConfigSha?: boolean;
  }): Promise<SiteAdminConfigSourceVersion> {
    if (compactId(input.rowId) !== SITE_SETTINGS_ROW_ID) {
      throw new Error("Missing Site Settings row");
    }
    const source = await this.loadSourceSnapshot();
    if (!input.allowStaleSiteConfigSha) {
      assertExpectedSha({
        expected: input.expectedSiteConfigSha,
        actual: source.version.siteConfigSha,
      });
    }

    const nextSiteConfig = applySettingsPatch(source.siteConfig, input.patch);
    await this.writeFilesystemJson(SITE_CONFIG_REL_PATH, nextSiteConfig);

    const refreshed = await this.loadSourceSnapshot();
    return pickConfigVersion(refreshed.version);
  }

  async updateNavRow(input: {
    rowId: string;
    patch: Partial<Omit<NavItemRow, "rowId">>;
    expectedSiteConfigSha: string;
  }): Promise<SiteAdminConfigSourceVersion> {
    const targetRowId = compactId(input.rowId);
    if (!targetRowId) throw new Error("Missing rowId");

    const source = await this.loadSourceSnapshot();
    assertExpectedSha({
      expected: input.expectedSiteConfigSha,
      actual: source.version.siteConfigSha,
    });

    const navRows = mapNavRows(source.siteConfig);
    const idx = navRows.findIndex((it) => it.rowId === targetRowId);
    if (idx < 0) throw new Error("Navigation row not found");

    const prev = navRows[idx];
    navRows[idx] = {
      rowId: prev.rowId,
      label: input.patch.label ?? prev.label,
      href: input.patch.href ?? prev.href,
      group: input.patch.group ?? prev.group,
      order:
        typeof input.patch.order === "number" && Number.isFinite(input.patch.order)
          ? Math.floor(input.patch.order)
          : prev.order,
      enabled:
        typeof input.patch.enabled === "boolean"
          ? input.patch.enabled
          : prev.enabled,
    };

    const nextSiteConfig = writeNavRowsToSiteConfig(source.siteConfig, navRows);
    await this.writeFilesystemJson(SITE_CONFIG_REL_PATH, nextSiteConfig);

    const refreshed = await this.loadSourceSnapshot();
    return pickConfigVersion(refreshed.version);
  }

  async createNavRow(input: {
    row: Omit<NavItemRow, "rowId">;
    expectedSiteConfigSha: string;
  }): Promise<{ created: NavItemRow; sourceVersion: SiteAdminConfigSourceVersion }> {
    const source = await this.loadSourceSnapshot();
    assertExpectedSha({
      expected: input.expectedSiteConfigSha,
      actual: source.version.siteConfigSha,
    });

    const navRows = mapNavRows(source.siteConfig);
    const created: NavItemRow = {
      rowId: randomRowId(),
      label: String(input.row.label || "").trim(),
      href: String(input.row.href || "").trim(),
      group: input.row.group === "top" ? "top" : "more",
      order:
        typeof input.row.order === "number" && Number.isFinite(input.row.order)
          ? Math.floor(input.row.order)
          : 0,
      enabled:
        typeof input.row.enabled === "boolean" ? input.row.enabled : true,
    };
    navRows.push(created);

    const nextSiteConfig = writeNavRowsToSiteConfig(source.siteConfig, navRows);
    await this.writeFilesystemJson(SITE_CONFIG_REL_PATH, nextSiteConfig);

    const refreshed = await this.loadSourceSnapshot();
    return {
      created,
      sourceVersion: pickConfigVersion(refreshed.version),
    };
  }

  async loadRoutes(): Promise<SiteAdminRoutesSnapshot> {
    const source = await this.loadSourceSnapshot();
    return {
      adminPageId: SOURCE_ADMIN_PAGE_ID,
      databases: {
        overridesDbId: SOURCE_OVERRIDES_DB_ID,
        protectedDbId: SOURCE_PROTECTED_DB_ID,
      },
      overrides: mapRouteOverrides(source.siteConfig),
      protectedRoutes: source.protectedRoutes.map((it) => ({
        rowId: it.id,
        pageId: it.pageId,
        path: it.path,
        mode: it.mode,
        auth: it.auth,
        enabled: true,
      })),
      sourceVersion: source.version,
    };
  }

  async updateOverride(input: {
    pageId: string;
    routePath: string;
    expectedSiteConfigSha: string;
  }): Promise<SiteAdminRoutesSourceVersion> {
    const pageId = compactId(input.pageId);
    if (!pageId) throw new Error("Missing pageId");

    const routePath = normalizeRoutePath(input.routePath);
    const source = await this.loadSourceSnapshot();
    assertExpectedSha({
      expected: input.expectedSiteConfigSha,
      actual: source.version.siteConfigSha,
    });

    const nextSiteConfig = upsertRouteOverride(source.siteConfig, {
      pageId,
      routePath,
    });
    await this.writeFilesystemJson(SITE_CONFIG_REL_PATH, nextSiteConfig);

    const refreshed = await this.loadSourceSnapshot();
    return refreshed.version;
  }

  async updateProtected(input: {
    pageId: string;
    path: string;
    mode: "exact" | "prefix";
    auth: ProtectedAccessMode;
    password: string;
    delete?: boolean;
    expectedProtectedRoutesSha: string;
  }): Promise<SiteAdminRoutesSourceVersion> {
    const pageId = compactId(input.pageId);
    const routePath = normalizeRoutePath(input.path);
    if (!routePath) throw new Error("Missing path");
    const mode = input.mode === "prefix" ? "prefix" : "exact";
    const auth = normalizeProtectedAccessMode(input.auth, "password");
    const password = String(input.password || "").trim();

    const source = await this.loadSourceSnapshot();
    assertExpectedSha({
      expected: input.expectedProtectedRoutesSha,
      actual: source.version.protectedRoutesSha,
    });

    const next = upsertProtectedRoute(source.protectedRoutes, {
      pageId,
      path: routePath,
      mode,
      auth,
      password,
      delete: input.delete,
    });
    await this.writeFilesystemJson(PROTECTED_ROUTES_REL_PATH, next);

    const refreshed = await this.loadSourceSnapshot();
    return refreshed.version;
  }

  async getSourceState(): Promise<SiteAdminSourceState> {
    if (this.kind === "db") {
      // D1 has no notion of repo/branch/commit. Returning the SITE_ADMIN_REPO_*
      // env values here would mislead the Status panel into showing a git
      // branch / commit-style identity that doesn't reflect the actual source
      // of truth (the D1 binding). Surface the binding name as the "repo" so
      // operators can see which D1 instance the worker is talking to, and
      // leave the git-shaped fields null so downstream "head sha unavailable"
      // warnings are correctly suppressed (see derivePendingDeployReason).
      const dbName = String(process.env.SITE_ADMIN_DB_NAME || "").trim();
      return {
        storeKind: "db",
        repo: dbName ? `d1:${dbName}` : "d1:SITE_ADMIN_DB",
        branch: null,
        headSha: null,
        headCommitTime: null,
      };
    }
    const branch =
      String(process.env.SITE_ADMIN_REPO_BRANCH || "").trim() ||
      String(process.env.VERCEL_GIT_COMMIT_REF || process.env.GITHUB_REF_NAME || "").trim() ||
      null;
    const headSha =
      String(process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "").trim() ||
      null;
    const owner = String(process.env.SITE_ADMIN_REPO_OWNER || "").trim();
    const repo = String(process.env.SITE_ADMIN_REPO_NAME || "").trim();
    return {
      storeKind: this.kind,
      repo: owner && repo ? `${owner}/${repo}` : null,
      branch,
      headSha,
      headCommitTime: null,
    };
  }

  private async loadSourceSnapshot(): Promise<RawSourceSnapshot> {
    // Run the three reads in parallel — the backend may or may not pipeline
    // them, but it's free correctness either way.
    const [siteConfig, protectedRoutes, routesManifest] = await Promise.all([
      this.readSiteConfig(),
      this.readProtectedRoutes(),
      this.readRoutesManifest(),
    ]);

    const siteConfigSha = jsonSha(siteConfig);
    const protectedRoutesSha = jsonSha(protectedRoutes);
    const routesManifestSha = jsonSha(routesManifest);
    const branchSha = sha1Hex(
      `${siteConfigSha}:${protectedRoutesSha}:${routesManifestSha}`,
    );

    return {
      siteConfig,
      protectedRoutes,
      routesManifest,
      version: {
        siteConfigSha,
        protectedRoutesSha,
        branchSha,
      },
    };
  }

  private async readSiteConfig(): Promise<JsonRecord> {
    const raw = await this.readPreferredJson(
      SITE_CONFIG_REL_PATH,
      structuredClone(DEFAULT_SITE_CONFIG),
    );
    return isRecord(raw) ? raw : structuredClone(DEFAULT_SITE_CONFIG);
  }

  private async readProtectedRoutes(): Promise<StoredProtectedRoute[]> {
    const raw = await this.readPreferredJson(PROTECTED_ROUTES_REL_PATH, []);
    return normalizeStoredProtectedRoutes(raw);
  }

  private async readRoutesManifest(): Promise<unknown[]> {
    const raw = await this.readPreferredJson(ROUTES_MANIFEST_REL_PATH, []);
    return Array.isArray(raw) ? raw : [];
  }

  private async readPreferredJson(relPath: string, fallback: unknown): Promise<unknown> {
    // In local development, content/local lets one-person workspace settings
    // diverge without dirtying tracked content/filesystem files. Production
    // builds ignore it unless explicitly enabled.
    if (localContentOverridesEnabled()) {
      const localResult = await this.backend.readJsonFile(
        `${CONTENT_LOCAL_DIR}/${relPath}`,
      );
      if (localResult !== null && localResult !== undefined) return localResult;
    }

    // Try content/filesystem/X.json first (real data) then fall back to the
    // prebuild stub at content/generated/X.json. Either backend handles the
    // path the same way; for the db backend the generated lookup just
    // returns null (stubs aren't imported into D1).
    const fsResult = await this.backend.readJsonFile(
      `${CONTENT_FILESYSTEM_DIR}/${relPath}`,
    );
    if (fsResult !== null && fsResult !== undefined) return fsResult;
    const generatedResult = await this.backend.readJsonFile(
      `${CONTENT_GENERATED_DIR}/${relPath}`,
    );
    if (generatedResult !== null && generatedResult !== undefined) {
      return generatedResult;
    }
    return structuredClone(fallback);
  }

  private async writeFilesystemJson(relPath: string, value: unknown): Promise<void> {
    const dir = localContentOverridesEnabled() ? CONTENT_LOCAL_DIR : CONTENT_FILESYSTEM_DIR;
    await this.backend.writeJsonFile(`${dir}/${relPath}`, value);
  }

  async statFile(relPath: string): Promise<SiteAdminFileStat> {
    return this.backend.statFile(relPath);
  }

  async readTextFile(relPath: string): Promise<{ content: string; sha: string } | null> {
    return this.backend.readTextFile(relPath);
  }

  async listTextFileHistory(
    relPath: string,
    limit = 12,
  ): Promise<SiteAdminFileHistoryEntry[]> {
    return this.backend.listTextFileHistory(relPath, limit);
  }

  async readTextFileAtCommit(
    relPath: string,
    commitSha: string,
  ): Promise<{ content: string; sha: string; commitSha: string } | null> {
    return this.backend.readTextFileAtCommit(relPath, commitSha);
  }

  async writeTextFile(input: {
    relPath: string;
    content: string;
    expectedSha?: string;
    message?: string;
  }): Promise<{ fileSha: string; commitSha: string }> {
    try {
      return await this.backend.writeTextFile({
        repoRel: input.relPath,
        content: input.content,
        expectedSha: input.expectedSha,
      });
    } catch (err) {
      if (isSiteAdminFileBackendConflictError(err)) {
        // Re-raise as the source-store-level conflict so callers' existing
        // catch sites (which look for SiteAdminSourceConflictError) keep
        // working unchanged.
        throw new SiteAdminSourceConflictError({
          expectedSha: err.expectedSha,
          currentSha: err.currentSha,
        });
      }
      throw err;
    }
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asBoolean(value: unknown, fallback = true): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function stableNavSort(a: NavItemRow, b: NavItemRow): number {
  if (a.group !== b.group) return a.group === "top" ? -1 : 1;
  if (a.order !== b.order) return a.order - b.order;
  return a.label.localeCompare(b.label);
}

function randomRowId(): string {
  return crypto.randomBytes(16).toString("hex");
}

function hashRowId(seed: string): string {
  return sha1Hex(seed).slice(0, 32);
}

function mapSiteSettings(siteConfig: JsonRecord): SiteSettings {
  const seo = asRecord(siteConfig.seo);
  const integrations = asRecord(siteConfig.integrations);
  const security = asRecord(siteConfig.security);
  const content = asRecord(siteConfig.content);
  const autoExclude = normalizeSitemapAutoExclude(content.sitemapAutoExclude);
  const pageOverrides = normalizeSeoPageOverrides(seo.pageOverrides);
  const users = Array.isArray(security.contentGithubUsers)
    ? parseGithubUserCsv((security.contentGithubUsers as unknown[]).join(","))
    : parseGithubUserCsv(security.contentGithubUsers);
  const sitemapExcludes = parseSitemapExcludeEntries(content.sitemapExcludes);

  return {
    rowId: SITE_SETTINGS_ROW_ID,
    siteName: asString(siteConfig.siteName) || DEFAULT_SITE_CONFIG.siteName,
    lang: asString(siteConfig.lang) || DEFAULT_SITE_CONFIG.lang,
    seoTitle: asString(seo.title) || DEFAULT_SITE_CONFIG.seo.title,
    seoDescription:
      asString(seo.description) || DEFAULT_SITE_CONFIG.seo.description,
    favicon: asString(seo.favicon) || DEFAULT_SITE_CONFIG.seo.favicon,
    ogImage: asString(seo.ogImage) || DEFAULT_SITE_CONFIG.seo.ogImage,
    seoPageOverrides:
      Object.keys(pageOverrides).length > 0
        ? JSON.stringify(pageOverrides, null, 2)
        : "",
    googleAnalyticsId: asString(integrations.googleAnalyticsId),
    contentGithubUsers: users.join(", "),
    sitemapExcludes: sitemapExcludes.join("\n"),
    sitemapAutoExcludeEnabled: Boolean(autoExclude.enabled),
    sitemapAutoExcludeSections: autoExclude.excludeSections.join(", "),
    sitemapAutoExcludeDepthPages:
      formatDepth(autoExclude.maxDepthBySection.pages),
    sitemapAutoExcludeDepthBlog:
      formatDepth(autoExclude.maxDepthBySection.blog),
    sitemapAutoExcludeDepthPublications: formatDepth(
      autoExclude.maxDepthBySection.publications,
    ),
    sitemapAutoExcludeDepthTeaching: formatDepth(
      autoExclude.maxDepthBySection.teaching,
    ),
    rootPageId: asString(content.rootPageId),
    homePageId: asString(content.homePageId),
  };
}

function mapNavRows(siteConfig: JsonRecord): NavItemRow[] {
  const nav = asRecord(siteConfig.nav);
  const top = mapNavGroupRows(nav.top, "top");
  const more = mapNavGroupRows(nav.more, "more");
  return [...top, ...more].sort(stableNavSort);
}

function mapNavGroupRows(
  input: unknown,
  group: "top" | "more",
): NavItemRow[] {
  if (!Array.isArray(input)) return [];
  const out: NavItemRow[] = [];
  for (let idx = 0; idx < input.length; idx += 1) {
    const row = input[idx];
    if (!isRecord(row)) continue;
    const label = asString(row.label);
    const href = asString(row.href);
    if (!label || !href) continue;
    const rowId =
      compactId(String(row.rowId || "")) ||
      compactId(String(row.id || "")) ||
      hashRowId(`${group}:${idx}:${label}:${href}`);
    out.push({
      rowId,
      label,
      href,
      group,
      order: asNumber(row.order, idx),
      enabled: asBoolean(row.enabled, true),
    });
  }
  return out;
}

function writeNavRowsToSiteConfig(
  sourceSiteConfig: JsonRecord,
  navRows: NavItemRow[],
): JsonRecord {
  const next = structuredClone(sourceSiteConfig);
  const nav = asRecord(next.nav);
  const toStoredRows = (group: "top" | "more") =>
    navRows
      .filter((it) => it.group === group)
      .sort(stableNavSort)
      .map((it) => ({
        rowId: it.rowId,
        label: it.label,
        href: it.href,
        order: it.order,
        enabled: it.enabled,
      }));
  nav.top = toStoredRows("top");
  nav.more = toStoredRows("more");
  next.nav = nav;
  return next;
}

function applySettingsPatch(
  sourceSiteConfig: JsonRecord,
  patch: Partial<Omit<SiteSettings, "rowId">>,
): JsonRecord {
  const next = structuredClone(sourceSiteConfig);
  const seo = asRecord(next.seo);
  const integrations = asRecord(next.integrations);
  const security = asRecord(next.security);
  const content = asRecord(next.content);
  const autoExclude = normalizeSitemapAutoExclude(content.sitemapAutoExclude);
  const maxDepthBySection = { ...autoExclude.maxDepthBySection };

  if (patch.siteName !== undefined) next.siteName = String(patch.siteName || "").trim();
  if (patch.lang !== undefined) next.lang = String(patch.lang || "").trim() || "en";
  if (patch.seoTitle !== undefined) seo.title = String(patch.seoTitle || "").trim();
  if (patch.seoDescription !== undefined) {
    seo.description = String(patch.seoDescription || "").trim();
  }
  if (patch.favicon !== undefined) seo.favicon = String(patch.favicon || "").trim();
  if (patch.ogImage !== undefined) seo.ogImage = String(patch.ogImage || "").trim();
  if (patch.seoPageOverrides !== undefined) {
    seo.pageOverrides = normalizeSeoPageOverrides(patch.seoPageOverrides);
  }

  if (patch.googleAnalyticsId !== undefined) {
    const googleAnalyticsId = normalizeGoogleAnalyticsId(patch.googleAnalyticsId);
    if (googleAnalyticsId === null) throw new Error("Invalid Google Analytics ID");
    integrations.googleAnalyticsId = googleAnalyticsId;
  }
  if (patch.contentGithubUsers !== undefined) {
    security.contentGithubUsers = parseGithubUserCsv(patch.contentGithubUsers);
  }
  if (patch.sitemapExcludes !== undefined) {
    content.sitemapExcludes = parseSitemapExcludeEntries(patch.sitemapExcludes);
  }
  if (patch.sitemapAutoExcludeEnabled !== undefined) {
    autoExclude.enabled = Boolean(patch.sitemapAutoExcludeEnabled);
  }
  if (patch.sitemapAutoExcludeSections !== undefined) {
    autoExclude.excludeSections = parseSitemapSectionList(
      patch.sitemapAutoExcludeSections,
    );
  }

  setDepthIfDefined(
    patch.sitemapAutoExcludeDepthPages,
    "pages",
    maxDepthBySection,
  );
  setDepthIfDefined(
    patch.sitemapAutoExcludeDepthBlog,
    "blog",
    maxDepthBySection,
  );
  setDepthIfDefined(
    patch.sitemapAutoExcludeDepthPublications,
    "publications",
    maxDepthBySection,
  );
  setDepthIfDefined(
    patch.sitemapAutoExcludeDepthTeaching,
    "teaching",
    maxDepthBySection,
  );

  if (patch.rootPageId !== undefined) {
    const row = String(patch.rootPageId || "").trim();
    content.rootPageId = row || null;
  }
  if (patch.homePageId !== undefined) {
    const row = String(patch.homePageId || "").trim();
    content.homePageId = row || null;
  }

  autoExclude.maxDepthBySection = maxDepthBySection;
  content.sitemapAutoExclude = autoExclude;
  next.seo = seo;
  next.integrations = integrations;
  next.security = security;
  next.content = content;
  return next;
}

function setDepthIfDefined(
  raw: string | undefined,
  key: "pages" | "blog" | "publications" | "teaching",
  target: Partial<Record<"pages" | "blog" | "publications" | "teaching", number>>,
) {
  if (raw === undefined) return;
  const parsed = parseDepthNumber(raw, { min: 0, max: 20 });
  if (parsed === null) {
    delete target[key];
    return;
  }
  target[key] = parsed;
}

function mapRouteOverrides(siteConfig: JsonRecord): SiteAdminRouteOverride[] {
  const content = asRecord(siteConfig.content);
  const routeOverrides = asRecord(content.routeOverrides);
  const out: SiteAdminRouteOverride[] = [];

  for (const [rawPageId, rawRoute] of Object.entries(routeOverrides)) {
    const pageId = compactId(rawPageId);
    const routePath = normalizeRoutePath(String(rawRoute || ""));
    if (!pageId || !routePath) continue;
    out.push({
      rowId: hashRowId(`override:${pageId}`),
      pageId,
      routePath,
      enabled: true,
    });
  }

  out.sort((a, b) => a.routePath.localeCompare(b.routePath));
  return out;
}

function upsertRouteOverride(
  sourceSiteConfig: JsonRecord,
  input: { pageId: string; routePath: string },
): JsonRecord {
  const next = structuredClone(sourceSiteConfig);
  const content = asRecord(next.content);
  const routeOverrides = asRecord(content.routeOverrides);

  if (!input.routePath) {
    delete routeOverrides[input.pageId];
  } else {
    routeOverrides[input.pageId] = input.routePath;
  }

  content.routeOverrides = Object.keys(routeOverrides).length
    ? routeOverrides
    : null;
  next.content = content;
  return next;
}

function normalizeStoredProtectedRoutes(input: unknown): StoredProtectedRoute[] {
  if (!Array.isArray(input)) return [];
  const out: StoredProtectedRoute[] = [];

  for (const raw of input) {
    if (!isRecord(raw)) continue;
    const pathValue = normalizeRoutePath(String(raw.path || ""));
    if (!pathValue) continue;
    const pageId = compactId(String(raw.pageId || ""));
    const mode = asString(raw.mode) === "prefix" ? "prefix" : "exact";
    const auth = normalizeProtectedAccessMode(raw.auth, "password");
    const key =
      asString(raw.key) === "path" || !pageId ? "path" : "pageId";
    const secret = key === "pageId" ? pageId : pathValue;
    let token = asString(raw.token);

    if (!token && auth === "github") {
      token = sha256Hex(`${secret}\n__github__`);
    }
    if (!token) continue;

    const id =
      compactId(String(raw.id || "")) ||
      compactId(String(raw.rowId || "")) ||
      hashRowId(`protected:${pageId || pathValue}`);

    out.push({
      id,
      auth,
      key,
      pageId: pageId || "",
      path: pathValue,
      mode,
      token,
    });
  }

  out.sort((a, b) => {
    if (a.key !== b.key) return a.key === "pageId" ? -1 : 1;
    if (a.mode !== b.mode) return a.mode === "exact" ? -1 : 1;
    if (a.path.length !== b.path.length) return b.path.length - a.path.length;
    return a.path.localeCompare(b.path);
  });
  return out;
}

function upsertProtectedRoute(
  rules: StoredProtectedRoute[],
  input: {
    pageId: string;
    path: string;
    mode: "exact" | "prefix";
    auth: ProtectedAccessMode;
    password: string;
    delete?: boolean;
  },
): StoredProtectedRoute[] {
  const pageId = compactId(input.pageId);
  const pathValue = normalizeRoutePath(input.path);
  if (!pathValue) return rules;

  const auth = normalizeProtectedAccessMode(input.auth, "password");
  const key: "pageId" | "path" = pageId ? "pageId" : "path";
  const idx = rules.findIndex(
    (it) =>
      (pageId
        ? compactId(it.pageId) === pageId
        : (it.key || "path") === "path") &&
      normalizeRoutePath(it.path) === pathValue,
  );
  if (input.delete) {
    if (idx < 0) return rules;
    return normalizeStoredProtectedRoutes(rules.filter((_it, index) => index !== idx));
  }
  const previous = idx >= 0 ? rules[idx] : null;
  const secret = pageId || pathValue;
  const previousPasswordToken =
    previous?.auth === "password" && previous.token ? previous.token : "";
  if (auth === "password" && !input.password && !previousPasswordToken) {
    return rules;
  }
  const token =
    auth === "password"
      ? input.password
        ? sha256Hex(`${secret}\n${input.password}`)
        : previousPasswordToken
      : sha256Hex(`${secret}\n__github__`);

  const row: StoredProtectedRoute = {
    id:
      idx >= 0
        ? rules[idx].id
        : hashRowId(pageId ? `protected:${pageId}:${pathValue}` : `protected:path:${pathValue}`),
    auth,
    key,
    pageId: pageId || "",
    path: pathValue,
    mode: input.mode,
    token,
  };

  const next = [...rules];
  if (idx >= 0) next[idx] = row;
  else next.push(row);
  return normalizeStoredProtectedRoutes(next);
}

function assertExpectedSha(input: { expected: string; actual: string }) {
  const expected = String(input.expected || "").trim().toLowerCase();
  const actual = String(input.actual || "").trim().toLowerCase();
  if (!expected || expected !== actual) {
    throw new SiteAdminSourceConflictError({
      expectedSha: expected,
      currentSha: actual,
    });
  }
}

function pickConfigVersion(
  version: SiteAdminSourceVersion,
): SiteAdminConfigSourceVersion {
  return {
    siteConfigSha: version.siteConfigSha,
    branchSha: version.branchSha,
  };
}

function formatDepth(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return String(Math.floor(value));
}

function sha1Hex(input: string): string {
  return crypto.createHash("sha1").update(input, "utf8").digest("hex");
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function jsonSha(value: unknown): string {
  return sha1Hex(JSON.stringify(sortJson(value)));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  const out: JsonRecord = {};
  const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
  for (const key of keys) out[key] = sortJson(value[key]);
  return out;
}
