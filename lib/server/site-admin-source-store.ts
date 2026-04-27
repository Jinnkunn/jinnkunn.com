import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

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
const ROUTES_MANIFEST_REL_PATH = "routes-manifest.json";
const CONTENT_FILESYSTEM_DIR = "content/filesystem";
const CONTENT_GENERATED_DIR = "content/generated";

const SITE_SETTINGS_ROW_ID = "00000000000000000000000000000001";
const SOURCE_ADMIN_PAGE_ID = "filesystem-admin";
const SOURCE_OVERRIDES_DB_ID = "filesystem-overrides";
const SOURCE_PROTECTED_DB_ID = "filesystem-protected";
const execFileAsync = promisify(execFile);

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
  storeKind: "local" | "github";
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
  readonly kind: "local" | "github";
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

export function getSiteAdminSourceStore(): SiteAdminSourceStore {
  if (__siteAdminSourceStore) return __siteAdminSourceStore;
  const kind = String(process.env.SITE_ADMIN_STORAGE || "local")
    .trim()
    .toLowerCase();
  if (kind === "local" || !kind) {
    __siteAdminSourceStore = createLocalSiteAdminSourceStore();
    return __siteAdminSourceStore;
  }
  if (kind === "github") {
    __siteAdminSourceStore = createGithubSiteAdminSourceStoreFromEnv();
    return __siteAdminSourceStore;
  }
  throw new Error(`Unsupported SITE_ADMIN_STORAGE: ${kind}`);
}

export function createLocalSiteAdminSourceStore(opts?: {
  rootDir?: string;
}): SiteAdminSourceStore {
  return new LocalSiteAdminSourceStore(opts?.rootDir || process.cwd());
}

export function createGithubSiteAdminSourceStoreFromEnv(): SiteAdminSourceStore {
  const appId = String(process.env.GITHUB_APP_ID || "").trim();
  const privateKeyInline = normalizePrivateKey(String(process.env.GITHUB_APP_PRIVATE_KEY || ""));
  const privateKeyFile = String(process.env.GITHUB_APP_PRIVATE_KEY_FILE || "").trim();
  const privateKey = privateKeyInline || readGithubPrivateKeyFromFile(privateKeyFile);
  const installationId = String(process.env.GITHUB_APP_INSTALLATION_ID || "").trim();
  const owner = String(process.env.SITE_ADMIN_REPO_OWNER || "").trim();
  const repo = String(process.env.SITE_ADMIN_REPO_NAME || "").trim();
  const branch = String(process.env.SITE_ADMIN_REPO_BRANCH || "main").trim() || "main";

  const missing: string[] = [];
  if (!appId) missing.push("GITHUB_APP_ID");
  if (!privateKey) missing.push("GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_FILE");
  if (!installationId) missing.push("GITHUB_APP_INSTALLATION_ID");
  if (!owner) missing.push("SITE_ADMIN_REPO_OWNER");
  if (!repo) missing.push("SITE_ADMIN_REPO_NAME");
  if (missing.length) {
    throw new Error(`Missing required GitHub store env: ${missing.join(", ")}`);
  }
  return createGithubSiteAdminSourceStore({
    appId,
    privateKey,
    installationId,
    owner,
    repo,
    branch,
  });
}

function normalizePrivateKey(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

function readGithubPrivateKeyFromFile(filePathRaw: string): string {
  const filePath = String(filePathRaw || "").trim();
  if (!filePath) return "";
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
  let raw = "";
  try {
    raw = fs.readFileSync(resolved, "utf8");
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Unable to read GITHUB_APP_PRIVATE_KEY_FILE (${resolved}): ${detail}`);
  }
  const value = normalizePrivateKey(raw);
  if (!value) {
    throw new Error(`GITHUB_APP_PRIVATE_KEY_FILE is empty: ${resolved}`);
  }
  return value;
}

export function createGithubSiteAdminSourceStore(input: {
  appId: string;
  privateKey: string;
  installationId: string;
  owner: string;
  repo: string;
  branch: string;
}): SiteAdminSourceStore {
  return new GitHubSiteAdminSourceStore(input);
}

class LocalSiteAdminSourceStore implements SiteAdminSourceStore {
  readonly kind = "local" as const;

  private readonly rootDir: string;
  private readonly filesystemDir: string;
  private readonly generatedDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.filesystemDir = path.join(rootDir, "content", "filesystem");
    this.generatedDir = path.join(rootDir, "content", "generated");
  }

  async loadConfig(): Promise<SiteAdminConfigSnapshot> {
    const source = this.loadSourceSnapshot();
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
    const source = this.loadSourceSnapshot();
    if (!input.allowStaleSiteConfigSha) {
      assertExpectedSha({
        expected: input.expectedSiteConfigSha,
        actual: source.version.siteConfigSha,
      });
    }

    const nextSiteConfig = applySettingsPatch(source.siteConfig, input.patch);
    this.writeFilesystemJson(SITE_CONFIG_REL_PATH, nextSiteConfig);

    const refreshed = this.loadSourceSnapshot();
    return pickConfigVersion(refreshed.version);
  }

  async updateNavRow(input: {
    rowId: string;
    patch: Partial<Omit<NavItemRow, "rowId">>;
    expectedSiteConfigSha: string;
  }): Promise<SiteAdminConfigSourceVersion> {
    const targetRowId = compactId(input.rowId);
    if (!targetRowId) throw new Error("Missing rowId");

    const source = this.loadSourceSnapshot();
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
    this.writeFilesystemJson(SITE_CONFIG_REL_PATH, nextSiteConfig);

    const refreshed = this.loadSourceSnapshot();
    return pickConfigVersion(refreshed.version);
  }

  async createNavRow(input: {
    row: Omit<NavItemRow, "rowId">;
    expectedSiteConfigSha: string;
  }): Promise<{ created: NavItemRow; sourceVersion: SiteAdminConfigSourceVersion }> {
    const source = this.loadSourceSnapshot();
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
    this.writeFilesystemJson(SITE_CONFIG_REL_PATH, nextSiteConfig);

    const refreshed = this.loadSourceSnapshot();
    return {
      created,
      sourceVersion: pickConfigVersion(refreshed.version),
    };
  }

  async loadRoutes(): Promise<SiteAdminRoutesSnapshot> {
    const source = this.loadSourceSnapshot();
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
    const source = this.loadSourceSnapshot();
    assertExpectedSha({
      expected: input.expectedSiteConfigSha,
      actual: source.version.siteConfigSha,
    });

    const nextSiteConfig = upsertRouteOverride(source.siteConfig, {
      pageId,
      routePath,
    });
    this.writeFilesystemJson(SITE_CONFIG_REL_PATH, nextSiteConfig);

    const refreshed = this.loadSourceSnapshot();
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

    const source = this.loadSourceSnapshot();
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
    this.writeFilesystemJson(PROTECTED_ROUTES_REL_PATH, next);

    const refreshed = this.loadSourceSnapshot();
    return refreshed.version;
  }

  async getSourceState(): Promise<SiteAdminSourceState> {
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
      storeKind: "local",
      repo: owner && repo ? `${owner}/${repo}` : null,
      branch,
      headSha,
      headCommitTime: null,
    };
  }

  private loadSourceSnapshot(): RawSourceSnapshot {
    const siteConfig = this.readSiteConfig();
    const protectedRoutes = this.readProtectedRoutes();
    const routesManifest = this.readRoutesManifest();

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

  private readSiteConfig(): JsonRecord {
    const raw = this.readPreferredJson(
      SITE_CONFIG_REL_PATH,
      structuredClone(DEFAULT_SITE_CONFIG),
    );
    return isRecord(raw) ? raw : structuredClone(DEFAULT_SITE_CONFIG);
  }

  private readProtectedRoutes(): StoredProtectedRoute[] {
    const raw = this.readPreferredJson(PROTECTED_ROUTES_REL_PATH, []);
    return normalizeStoredProtectedRoutes(raw);
  }

  private readRoutesManifest(): unknown[] {
    const raw = this.readPreferredJson(ROUTES_MANIFEST_REL_PATH, []);
    return Array.isArray(raw) ? raw : [];
  }

  private readPreferredJson(relPath: string, fallback: unknown): unknown {
    const fsPath = path.join(this.filesystemDir, relPath);
    const generatedPath = path.join(this.generatedDir, relPath);
    const filePath =
      pickExistingFile(fsPath) || pickExistingFile(generatedPath) || "";

    if (!filePath) return structuredClone(fallback);
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      return JSON.parse(raw);
    } catch {
      return structuredClone(fallback);
    }
  }

  private writeFilesystemJson(relPath: string, value: unknown) {
    fs.mkdirSync(this.filesystemDir, { recursive: true });
    const outPath = path.join(this.filesystemDir, relPath);
    fs.writeFileSync(outPath, `${JSON.stringify(sortJson(value), null, 2)}\n`, "utf8");
  }

  async readTextFile(relPath: string): Promise<{ content: string; sha: string } | null> {
    const filePath = path.join(this.rootDir, relPath);
    try {
      const content = fs.readFileSync(filePath, "utf8");
      return { content, sha: jsonSha(content) };
    } catch {
      return null;
    }
  }

  async listTextFileHistory(
    relPath: string,
    limit = 12,
  ): Promise<SiteAdminFileHistoryEntry[]> {
    const maxCount = Math.max(1, Math.min(50, Math.floor(limit)));
    try {
      const { stdout } = await execFileAsync(
        "git",
        [
          "log",
          `--max-count=${maxCount}`,
          "--format=%H%x1f%h%x1f%ct%x1f%an%x1f%s",
          "--",
          relPath,
        ],
        { cwd: this.rootDir, maxBuffer: 1024 * 1024 },
      );
      return stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [commitSha, commitShort, epoch, authorName, ...messageParts] =
            line.split("\x1f");
          const timestampMs = Number(epoch) * 1000;
          return {
            commitSha: commitSha || "",
            commitShort: commitShort || (commitSha || "").slice(0, 7),
            committedAt: Number.isFinite(timestampMs)
              ? new Date(timestampMs).toISOString()
              : null,
            authorName: authorName || "",
            message: messageParts.join("\x1f") || "",
          };
        })
        .filter((entry) => Boolean(entry.commitSha));
    } catch {
      return [];
    }
  }

  async readTextFileAtCommit(
    relPath: string,
    commitSha: string,
  ): Promise<{ content: string; sha: string; commitSha: string } | null> {
    if (!/^[a-f0-9]{7,40}$/i.test(commitSha)) return null;
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["show", `${commitSha}:${relPath}`],
        { cwd: this.rootDir, maxBuffer: 8 * 1024 * 1024 },
      );
      return { content: stdout, sha: jsonSha(stdout), commitSha };
    } catch {
      return null;
    }
  }

  async writeTextFile(input: {
    relPath: string;
    content: string;
    expectedSha?: string;
    message?: string;
  }): Promise<{ fileSha: string; commitSha: string }> {
    const filePath = path.join(this.rootDir, input.relPath);
    let existingContent: string | null = null;
    // Check expected sha against current file content (best-effort
    // optimistic concurrency in local mode; real enforcement happens in
    // the GitHub store path).
    if (input.expectedSha !== undefined) {
      try {
        existingContent = fs.readFileSync(filePath, "utf8");
        const currentSha = jsonSha(existingContent);
        if (currentSha !== input.expectedSha) {
          throw new SiteAdminSourceConflictError({
            expectedSha: input.expectedSha,
            currentSha,
          });
        }
      } catch (err) {
        if (err instanceof SiteAdminSourceConflictError) throw err;
        // File missing — treat empty sha as mismatch unless caller sent "".
        if (input.expectedSha !== "") {
          throw new SiteAdminSourceConflictError({
            expectedSha: input.expectedSha,
            currentSha: "",
          });
        }
      }
    }
    if (existingContent === null) {
      try {
        existingContent = fs.readFileSync(filePath, "utf8");
      } catch {
        existingContent = null;
      }
    }
    if (existingContent === input.content) {
      const sha = jsonSha(input.content);
      return { fileSha: sha, commitSha: sha };
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, input.content, "utf8");
    const sha = jsonSha(input.content);
    return { fileSha: sha, commitSha: sha };
  }
}

type GitHubStoreConfig = {
  appId: string;
  privateKey: string;
  installationId: string;
  owner: string;
  repo: string;
  branch: string;
};

type GitHubFileData = {
  path: string;
  sha: string;
  parsed: unknown;
};

type GitHubBranchHead = {
  sha: string;
  committedAt: string | null;
};

const __githubInstallationTokenCache = new Map<
  string,
  { token: string; expiresAtMs: number }
>();
const __githubInstallationTokenInFlight = new Map<string, Promise<string>>();

class GitHubApiError extends Error {
  readonly status: number;
  readonly responseBody: unknown;

  constructor(input: { status: number; message: string; responseBody: unknown }) {
    super(input.message);
    this.name = "GitHubApiError";
    this.status = input.status;
    this.responseBody = input.responseBody;
  }
}

class GitHubSiteAdminSourceStore implements SiteAdminSourceStore {
  readonly kind = "github" as const;

  private readonly appId: string;
  private readonly privateKey: string;
  private readonly installationId: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly branch: string;

  constructor(config: GitHubStoreConfig) {
    this.appId = config.appId;
    this.privateKey = config.privateKey;
    this.installationId = config.installationId;
    this.owner = config.owner;
    this.repo = config.repo;
    this.branch = config.branch;
  }

  async loadConfig(): Promise<SiteAdminConfigSnapshot> {
    const source = await this.loadSourceSnapshot();
    return {
      settings: mapSiteSettings(source.siteConfig),
      nav: mapNavRows(source.siteConfig),
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

    let source = await this.loadSourceSnapshot();
    if (!input.allowStaleSiteConfigSha) {
      assertExpectedSha({
        expected: input.expectedSiteConfigSha,
        actual: source.version.siteConfigSha,
      });
    }

    let nextSiteConfig = applySettingsPatch(source.siteConfig, input.patch);
    let write: { fileSha: string; commitSha: string };
    try {
      write = await this.writeSiteConfig(nextSiteConfig, input.expectedSiteConfigSha);
    } catch (err: unknown) {
      if (!input.allowStaleSiteConfigSha || !isSiteAdminSourceConflictError(err)) {
        throw err;
      }
      source = await this.loadSourceSnapshot();
      nextSiteConfig = applySettingsPatch(source.siteConfig, input.patch);
      write = await this.writeSiteConfig(nextSiteConfig, source.version.siteConfigSha);
    }
    return {
      siteConfigSha: write.fileSha,
      branchSha: write.commitSha,
    };
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
    const write = await this.writeSiteConfig(nextSiteConfig, input.expectedSiteConfigSha);
    return {
      siteConfigSha: write.fileSha,
      branchSha: write.commitSha,
    };
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
    const write = await this.writeSiteConfig(nextSiteConfig, input.expectedSiteConfigSha);
    return {
      created,
      sourceVersion: {
        siteConfigSha: write.fileSha,
        branchSha: write.commitSha,
      },
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

    const source = await this.loadSourceSnapshot();
    assertExpectedSha({
      expected: input.expectedSiteConfigSha,
      actual: source.version.siteConfigSha,
    });

    const nextSiteConfig = upsertRouteOverride(source.siteConfig, {
      pageId,
      routePath: normalizeRoutePath(input.routePath),
    });
    const write = await this.writeSiteConfig(nextSiteConfig, input.expectedSiteConfigSha);
    return {
      siteConfigSha: write.fileSha,
      protectedRoutesSha: source.version.protectedRoutesSha,
      branchSha: write.commitSha,
    };
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

    const nextProtected = upsertProtectedRoute(source.protectedRoutes, {
      pageId,
      path: routePath,
      mode,
      auth,
      password,
      delete: input.delete,
    });
    const write = await this.writeProtectedRoutes(
      nextProtected,
      input.expectedProtectedRoutesSha,
    );
    return {
      siteConfigSha: source.version.siteConfigSha,
      protectedRoutesSha: write.fileSha,
      branchSha: write.commitSha,
    };
  }

  async getSourceState(): Promise<SiteAdminSourceState> {
    const head = await this.fetchBranchHead();
    return {
      storeKind: "github",
      repo: `${this.owner}/${this.repo}`,
      branch: this.branch,
      headSha: head.sha,
      headCommitTime: head.committedAt,
    };
  }

  private async loadSourceSnapshot(): Promise<RawSourceSnapshot> {
    const [siteConfigFile, protectedRoutesFile, routesManifestFile, branchHead] =
      await Promise.all([
        this.readPreferredRepoJson(SITE_CONFIG_REL_PATH, structuredClone(DEFAULT_SITE_CONFIG)),
        this.readPreferredRepoJson(PROTECTED_ROUTES_REL_PATH, []),
        this.readPreferredRepoJson(ROUTES_MANIFEST_REL_PATH, []),
        this.fetchBranchHead(),
      ]);

    const siteConfig = isRecord(siteConfigFile.parsed)
      ? siteConfigFile.parsed
      : structuredClone(DEFAULT_SITE_CONFIG);
    const protectedRoutes = normalizeStoredProtectedRoutes(protectedRoutesFile.parsed);
    const routesManifest = Array.isArray(routesManifestFile.parsed)
      ? routesManifestFile.parsed
      : [];

    return {
      siteConfig,
      protectedRoutes,
      routesManifest,
      version: {
        siteConfigSha: siteConfigFile.sha,
        protectedRoutesSha: protectedRoutesFile.sha,
        branchSha: branchHead.sha,
      },
      branchHeadSha: branchHead.sha,
      branchHeadCommitTime: branchHead.committedAt,
    };
  }

  private async writeSiteConfig(
    nextSiteConfig: JsonRecord,
    expectedSiteConfigSha: string,
  ): Promise<{ fileSha: string; commitSha: string }> {
    return this.writeRepoJsonFile({
      relPath: SITE_CONFIG_REL_PATH,
      expectedSha: expectedSiteConfigSha,
      value: nextSiteConfig,
    });
  }

  private async writeProtectedRoutes(
    nextProtectedRoutes: StoredProtectedRoute[],
    expectedProtectedRoutesSha: string,
  ): Promise<{ fileSha: string; commitSha: string }> {
    return this.writeRepoJsonFile({
      relPath: PROTECTED_ROUTES_REL_PATH,
      expectedSha: expectedProtectedRoutesSha,
      value: nextProtectedRoutes,
    });
  }

  private async writeRepoJsonFile(input: {
    relPath: string;
    expectedSha: string;
    value: unknown;
  }): Promise<{ fileSha: string; commitSha: string }> {
    const repoPath = `${CONTENT_FILESYSTEM_DIR}/${input.relPath}`;
    const existing = await this.getRepoFile(repoPath);
    const content = `${JSON.stringify(sortJson(input.value), null, 2)}\n`;
    if (existing?.content === content) {
      const head = await this.fetchBranchHead();
      return { fileSha: existing.sha, commitSha: head.sha };
    }

    try {
      const payload = await this.githubJsonRequest<unknown>({
        method: "PUT",
        apiPath: `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(
          this.repo,
        )}/contents/${encodeRepoPath(repoPath)}`,
        body: {
          message: `chore(site-admin): update ${repoPath}`,
          content: Buffer.from(content, "utf8").toString("base64"),
          branch: this.branch,
          ...(existing?.sha ? { sha: existing.sha } : {}),
        },
      });

      const data = asRecord(payload);
      const commit = asRecord(data.commit);
      const file = asRecord(data.content);
      const commitSha = asString(commit.sha);
      const fileSha = asString(file.sha);
      if (!commitSha || !fileSha) {
        throw new Error(`Invalid GitHub write response for ${repoPath}`);
      }
      return { fileSha, commitSha };
    } catch (err: unknown) {
      if (err instanceof GitHubApiError && (err.status === 409 || err.status === 422)) {
        const latest = await this.readPreferredRepoJson(input.relPath, null);
        if (!isGitHubContentWriteConflictMessage(githubApiErrorMessage(err))) {
          throw new SiteAdminSourceWriteError(
            `GitHub refused to write ${repoPath} (${err.status}): ${githubApiErrorMessage(err)}`,
          );
        }
        throw new SiteAdminSourceConflictError({
          expectedSha: input.expectedSha,
          currentSha: latest.sha,
        });
      }
      throw err;
    }
  }

  private async readPreferredRepoJson(
    relPath: string,
    fallback: unknown,
  ): Promise<GitHubFileData> {
    const candidates = [
      `${CONTENT_FILESYSTEM_DIR}/${relPath}`,
      `${CONTENT_GENERATED_DIR}/${relPath}`,
    ];

    for (const candidate of candidates) {
      const file = await this.getRepoFile(candidate);
      if (!file) continue;
      const parsed = parseJsonSafe(file.content);
      if (parsed === null) {
        return {
          path: candidate,
          sha: file.sha,
          parsed: structuredClone(fallback),
        };
      }
      return {
        path: candidate,
        sha: file.sha,
        parsed,
      };
    }

    return {
      path: candidates[0],
      sha: jsonSha(fallback),
      parsed: structuredClone(fallback),
    };
  }

  async readTextFile(relPath: string): Promise<{ content: string; sha: string } | null> {
    const file = await this.getRepoFile(relPath);
    if (!file) return null;
    return { content: file.content, sha: file.sha };
  }

  async listTextFileHistory(
    relPath: string,
    limit = 12,
  ): Promise<SiteAdminFileHistoryEntry[]> {
    const perPage = Math.max(1, Math.min(50, Math.floor(limit)));
    const payload = await this.githubJsonRequest<unknown>({
      method: "GET",
      apiPath: `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(
        this.repo,
      )}/commits?sha=${encodeURIComponent(this.branch)}&path=${encodeURIComponent(
        relPath,
      )}&per_page=${perPage}`,
    });
    if (!Array.isArray(payload)) return [];
    return payload
      .map((raw): SiteAdminFileHistoryEntry | null => {
        const node = asRecord(raw);
        const commit = asRecord(node.commit);
        const author = asRecord(commit.author);
        const sha = asString(node.sha);
        if (!sha) return null;
        return {
          commitSha: sha,
          commitShort: sha.slice(0, 7),
          committedAt: asString(author.date) || null,
          authorName: asString(author.name),
          message: asString(commit.message).split("\n")[0] || "",
        };
      })
      .filter((entry): entry is SiteAdminFileHistoryEntry => Boolean(entry));
  }

  async readTextFileAtCommit(
    relPath: string,
    commitSha: string,
  ): Promise<{ content: string; sha: string; commitSha: string } | null> {
    if (!/^[a-f0-9]{7,40}$/i.test(commitSha)) return null;
    const file = await this.getRepoFile(relPath, commitSha);
    if (!file) return null;
    return { content: file.content, sha: file.sha, commitSha };
  }

  async writeTextFile(input: {
    relPath: string;
    content: string;
    expectedSha?: string;
    message?: string;
  }): Promise<{ fileSha: string; commitSha: string }> {
    const existing = await this.getRepoFile(input.relPath);
    if (input.expectedSha !== undefined) {
      const currentSha = existing?.sha ?? "";
      if (currentSha !== input.expectedSha) {
        throw new SiteAdminSourceConflictError({
          expectedSha: input.expectedSha,
          currentSha,
        });
      }
    }
    if (existing?.content === input.content) {
      const head = await this.fetchBranchHead();
      return { fileSha: existing.sha, commitSha: head.sha };
    }
    try {
      const payload = await this.githubJsonRequest<unknown>({
        method: "PUT",
        apiPath: `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(
          this.repo,
        )}/contents/${encodeRepoPath(input.relPath)}`,
        body: {
          message: input.message || `chore(site-admin): update ${input.relPath}`,
          content: Buffer.from(input.content, "utf8").toString("base64"),
          branch: this.branch,
          ...(existing?.sha ? { sha: existing.sha } : {}),
        },
      });
      const data = asRecord(payload);
      const commit = asRecord(data.commit);
      const file = asRecord(data.content);
      const commitSha = asString(commit.sha);
      const fileSha = asString(file.sha);
      if (!commitSha || !fileSha) {
        throw new Error(`Invalid GitHub write response for ${input.relPath}`);
      }
      return { fileSha, commitSha };
    } catch (err: unknown) {
      if (err instanceof GitHubApiError && (err.status === 409 || err.status === 422)) {
        const latest = await this.getRepoFile(input.relPath);
        if (!isGitHubContentWriteConflictMessage(githubApiErrorMessage(err))) {
          throw new SiteAdminSourceWriteError(
            `GitHub refused to write ${input.relPath} (${err.status}): ${githubApiErrorMessage(err)}`,
          );
        }
        throw new SiteAdminSourceConflictError({
          expectedSha: input.expectedSha ?? "",
          currentSha: latest?.sha ?? "",
        });
      }
      throw err;
    }
  }

  private async fetchBranchHead(): Promise<GitHubBranchHead> {
    const payload = await this.githubJsonRequest<unknown>({
      method: "GET",
      apiPath: `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(
        this.repo,
      )}/branches/${encodeURIComponent(this.branch)}`,
    });
    const data = asRecord(payload);
    const commit = asRecord(data.commit);
    const nestedCommit = asRecord(commit.commit);
    const committer = asRecord(nestedCommit.committer);
    const sha = asString(commit.sha);
    if (!sha) {
      throw new Error(`Unable to resolve head sha for ${this.owner}/${this.repo}@${this.branch}`);
    }
    const committedAt = asString(committer.date) || null;
    return { sha, committedAt };
  }

  private async getRepoFile(
    repoPath: string,
    ref = this.branch,
  ): Promise<{ sha: string; content: string } | null> {
    try {
      const payload = await this.githubJsonRequest<unknown>({
        method: "GET",
        apiPath: `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(
          this.repo,
        )}/contents/${encodeRepoPath(repoPath)}?ref=${encodeURIComponent(ref)}`,
      });
      const data = asRecord(payload);
      const type = asString(data.type);
      const sha = asString(data.sha);
      const encoding = asString(data.encoding).toLowerCase();
      const rawContent = asStringKeepWhitespace(data.content);
      if (type !== "file" || !sha || encoding !== "base64" || !rawContent) return null;
      return {
        sha,
        content: Buffer.from(rawContent.replace(/\s+/g, ""), "base64").toString("utf8"),
      };
    } catch (err: unknown) {
      if (err instanceof GitHubApiError && err.status === 404) return null;
      throw err;
    }
  }

  private async githubJsonRequest<T>(input: {
    method: "GET" | "POST" | "PUT";
    apiPath: string;
    body?: unknown;
    authToken?: string;
  }): Promise<T> {
    const token = input.authToken || (await this.getInstallationToken());
    const response = await fetch(`https://api.github.com${input.apiPath}`, {
      method: input.method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "jinnkunn-site-admin",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(input.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(input.body ? { body: JSON.stringify(input.body) } : {}),
    });
    const raw = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const msg =
        asString(asRecord(raw).message) ||
        `${response.status} GitHub API request failed`;
      throw new GitHubApiError({
        status: response.status,
        message: msg,
        responseBody: raw,
      });
    }
    return raw as T;
  }

  private async getInstallationToken(): Promise<string> {
    const cacheKey = `${this.appId}:${this.installationId}`;
    const cached = __githubInstallationTokenCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAtMs - 60_000 > now) return cached.token;
    const inflight = __githubInstallationTokenInFlight.get(cacheKey);
    if (inflight) return inflight;

    const requestPromise = (async () => {
      const appJwt = this.createAppJwt();
      const payload = await this.githubJsonRequest<unknown>({
        method: "POST",
        apiPath: `/app/installations/${encodeURIComponent(
          this.installationId,
        )}/access_tokens`,
        body: {},
        authToken: appJwt,
      });
      const data = asRecord(payload);
      const token = asString(data.token);
      const expiresAt = asString(data.expires_at);
      const expiresAtMs = Date.parse(expiresAt);
      if (!token || !Number.isFinite(expiresAtMs)) {
        throw new Error("Invalid GitHub installation token response");
      }
      __githubInstallationTokenCache.set(cacheKey, { token, expiresAtMs });
      return token;
    })()
      .finally(() => {
        __githubInstallationTokenInFlight.delete(cacheKey);
      });

    __githubInstallationTokenInFlight.set(cacheKey, requestPromise);
    return requestPromise;
  }

  private createAppJwt(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", typ: "JWT" }),
      "utf8",
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iat: now - 60,
        exp: now + 9 * 60,
        iss: this.appId,
      }),
      "utf8",
    ).toString("base64url");
    const signingInput = `${header}.${payload}`;
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    const signature = signer.sign(this.privateKey, "base64url");
    return `${signingInput}.${signature}`;
  }
}

function pickExistingFile(filePath: string): string {
  try {
    return fs.statSync(filePath).isFile() ? filePath : "";
  } catch {
    return "";
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

function asStringKeepWhitespace(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function githubApiErrorMessage(err: GitHubApiError): string {
  const detail = asString(asRecord(err.responseBody).message);
  return detail || err.message || "unknown GitHub API error";
}

function isGitHubContentWriteConflictMessage(message: string): boolean {
  return /\bsha\b|does not match|already exists|not a fast-forward|conflict/i.test(
    message,
  );
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

function encodeRepoPath(repoPath: string): string {
  return String(repoPath || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function parseJsonSafe(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
