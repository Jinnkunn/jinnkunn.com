import "server-only";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  SiteAdminSourceInfo,
  SiteAdminSourceVersion,
} from "@/lib/site-admin/api-types";
import type { ProtectedRoute } from "@/lib/shared/protected-route";
import {
  filesystemProtectedRoutesFile,
  filesystemRoutesManifestFile,
  filesystemSiteConfigFile,
  normalizeProtectedRouteRows,
  normalizeSourceRouteManifestRows,
  normalizeSourceSiteConfig,
  serializeSourceSiteConfig,
  type SourceRouteManifestItem,
  type SourceSiteConfig,
} from "@/lib/server/filesystem-source";

type JsonStorePayload = Record<string, unknown> | unknown[];

export type SiteAdminSourceSnapshot = {
  siteConfig: SourceSiteConfig;
  protectedRoutes: ProtectedRoute[];
  routesManifest: SourceRouteManifestItem[];
  version: SiteAdminSourceVersion;
  source: Omit<SiteAdminSourceInfo, "pendingDeploy" | "error">;
};

export type SiteAdminStorageKind = "local" | "github";

export type SiteAdminSourceStore = {
  kind: SiteAdminStorageKind;
  getSnapshot(): Promise<SiteAdminSourceSnapshot>;
  writeSiteConfig(input: {
    expectedSiteConfigSha: string;
    nextSiteConfig: SourceSiteConfig;
    commitMessage: string;
  }): Promise<SiteAdminSourceSnapshot>;
  writeProtectedRoutes(input: {
    expectedProtectedRoutesSha: string;
    nextProtectedRoutes: ProtectedRoute[];
    commitMessage: string;
  }): Promise<SiteAdminSourceSnapshot>;
};

type GitHubContentRecord<T> = {
  value: T;
  sha: string;
  text: string;
};

type GitHubRepoConfig = {
  appId: string;
  installationId: string;
  owner: string;
  repo: string;
  branch: string;
  privateKey: string;
};

type TokenCacheEntry = {
  key: string;
  token: string;
  expiresAtMs: number;
};

type TokenCacheGlobal = typeof globalThis & {
  __siteAdminGithubTokenCache?: TokenCacheEntry;
};

const GITHUB_API = "https://api.github.com";
const SOURCE_SITE_CONFIG_PATH = "content/filesystem/site-config.json";
const SOURCE_PROTECTED_ROUTES_PATH = "content/filesystem/protected-routes.json";
const SOURCE_ROUTES_MANIFEST_PATH = "content/filesystem/routes-manifest.json";

export class SiteAdminSourceError extends Error {
  status: number;
  code: string;

  constructor(message: string, init?: { status?: number; code?: string }) {
    super(message);
    this.name = "SiteAdminSourceError";
    this.status = init?.status ?? 500;
    this.code = init?.code ?? "SITE_ADMIN_SOURCE_ERROR";
  }
}

export class SiteAdminSourceConflictError extends SiteAdminSourceError {
  constructor(message = "Source changed on GitHub. Refresh and retry.") {
    super(message, { status: 409, code: "SOURCE_CONFLICT" });
    this.name = "SiteAdminSourceConflictError";
  }
}

function serializeJson(value: JsonStorePayload): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function shaFromText(text: string): string {
  return `local-${crypto.createHash("sha256").update(text).digest("hex")}`;
}

function branchShaFromVersion(version: SiteAdminSourceVersion): string {
  return `local-branch-${crypto.createHash("sha256").update([
    version.siteConfigSha,
    version.protectedRoutesSha,
    version.routesManifestSha,
  ].join("\n")).digest("hex")}`;
}

function parseIsoMs(value: string): number {
  const ms = Date.parse(String(value || "").trim());
  return Number.isFinite(ms) ? ms : NaN;
}

function latestFinite(values: number[]): number {
  let out = NaN;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (!Number.isFinite(out) || value > out) out = value;
  }
  return out;
}

async function readLocalJsonSource<T>(input: {
  filePath: string;
  fallbackValue: JsonStorePayload;
  parse: (value: unknown) => T;
}): Promise<GitHubContentRecord<T>> {
  let text = serializeJson(input.fallbackValue);
  try {
    text = await fs.readFile(input.filePath, "utf8");
  } catch {
    // use serialized fallback
  }

  let raw: unknown = input.fallbackValue;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = input.fallbackValue;
  }

  return {
    value: input.parse(raw),
    sha: shaFromText(text),
    text,
  };
}

async function getLocalSourceHead(
  version: SiteAdminSourceVersion,
  rootDir = process.cwd(),
): Promise<SiteAdminSourceSnapshot["source"]> {
  const files = [
    filesystemSiteConfigFile(rootDir),
    filesystemProtectedRoutesFile(rootDir),
    filesystemRoutesManifestFile(rootDir),
  ];
  const mtimes: number[] = [];
  for (const filePath of files) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) mtimes.push(stat.mtimeMs);
    } catch {
      // ignore
    }
  }

  const latestMs = latestFinite(mtimes);
  return {
    storeKind: "local",
    repo: "",
    branch: "local",
    headSha: branchShaFromVersion(version),
    headCommittedAt: Number.isFinite(latestMs) ? new Date(latestMs).toISOString() : "",
  };
}

export function createLocalSiteAdminSourceStore(
  options?: { rootDir?: string },
): SiteAdminSourceStore {
  const rootDir = options?.rootDir || process.cwd();
  const siteConfigFile = filesystemSiteConfigFile(rootDir);
  const protectedRoutesFile = filesystemProtectedRoutesFile(rootDir);
  const routesManifestFile = filesystemRoutesManifestFile(rootDir);
  return {
    kind: "local",
    async getSnapshot() {
      const [siteConfig, protectedRoutes, routesManifest] = await Promise.all([
        readLocalJsonSource({
          filePath: siteConfigFile,
          fallbackValue: {},
          parse: normalizeSourceSiteConfig,
        }),
        readLocalJsonSource({
          filePath: protectedRoutesFile,
          fallbackValue: [],
          parse: (value) => normalizeProtectedRouteRows(Array.isArray(value) ? value : []),
        }),
        readLocalJsonSource({
          filePath: routesManifestFile,
          fallbackValue: [],
          parse: (value) => normalizeSourceRouteManifestRows(Array.isArray(value) ? value : []),
        }),
      ]);

      const version: SiteAdminSourceVersion = {
        branchSha: "",
        siteConfigSha: siteConfig.sha,
        protectedRoutesSha: protectedRoutes.sha,
        routesManifestSha: routesManifest.sha,
      };
      version.branchSha = branchShaFromVersion(version);

      return {
        siteConfig: siteConfig.value,
        protectedRoutes: protectedRoutes.value,
        routesManifest: routesManifest.value,
        version,
        source: await getLocalSourceHead(version, rootDir),
      };
    },
    async writeSiteConfig(input) {
      const current = await readLocalJsonSource({
        filePath: siteConfigFile,
        fallbackValue: {},
        parse: normalizeSourceSiteConfig,
      });
      if (
        String(input.expectedSiteConfigSha || "").trim() &&
        current.sha !== String(input.expectedSiteConfigSha || "").trim()
      ) {
        throw new SiteAdminSourceConflictError();
      }
      await fs.mkdir(path.dirname(siteConfigFile), { recursive: true });
      await fs.writeFile(siteConfigFile, serializeJson(serializeSourceSiteConfig(input.nextSiteConfig)), "utf8");
      return this.getSnapshot();
    },
    async writeProtectedRoutes(input) {
      const current = await readLocalJsonSource({
        filePath: protectedRoutesFile,
        fallbackValue: [],
        parse: (value) => normalizeProtectedRouteRows(Array.isArray(value) ? value : []),
      });
      if (
        String(input.expectedProtectedRoutesSha || "").trim() &&
        current.sha !== String(input.expectedProtectedRoutesSha || "").trim()
      ) {
        throw new SiteAdminSourceConflictError();
      }
      await fs.mkdir(path.dirname(protectedRoutesFile), { recursive: true });
      await fs.writeFile(protectedRoutesFile, serializeJson(input.nextProtectedRoutes), "utf8");
      return this.getSnapshot();
    },
  };
}

export function normalizeGitHubAppPrivateKey(value: string): string {
  return String(value || "").replace(/\\n/g, "\n").trim();
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function createGitHubAppJwt(input: {
  appId: string;
  privateKey: string;
  nowSec?: number;
}): string {
  const appId = String(input.appId || "").trim();
  const privateKey = normalizeGitHubAppPrivateKey(input.privateKey);
  if (!appId || !privateKey) {
    throw new SiteAdminSourceError("Missing GitHub App credentials", {
      status: 500,
      code: "GITHUB_APP_MISCONFIGURED",
    });
  }

  const nowSec = Number.isFinite(input.nowSec) ? Math.floor(Number(input.nowSec)) : Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iat: nowSec - 60,
    exp: nowSec + 9 * 60,
    iss: appId,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), privateKey);
  return `${unsigned}.${base64Url(signature)}`;
}

function readGitHubRepoConfig(env = process.env): GitHubRepoConfig {
  const appId = String(env.GITHUB_APP_ID || "").trim();
  const installationId = String(env.GITHUB_APP_INSTALLATION_ID || "").trim();
  const owner = String(env.SITE_ADMIN_REPO_OWNER || "").trim();
  const repo = String(env.SITE_ADMIN_REPO_NAME || "").trim();
  const branch = String(env.SITE_ADMIN_REPO_BRANCH || "main").trim() || "main";
  const privateKey = normalizeGitHubAppPrivateKey(String(env.GITHUB_APP_PRIVATE_KEY || ""));

  const missing = [
    !appId ? "GITHUB_APP_ID" : "",
    !installationId ? "GITHUB_APP_INSTALLATION_ID" : "",
    !owner ? "SITE_ADMIN_REPO_OWNER" : "",
    !repo ? "SITE_ADMIN_REPO_NAME" : "",
    !privateKey ? "GITHUB_APP_PRIVATE_KEY" : "",
  ].filter(Boolean);

  if (missing.length) {
    throw new SiteAdminSourceError(
      `Missing GitHub source env: ${missing.join(", ")}`,
      { status: 500, code: "GITHUB_APP_MISCONFIGURED" },
    );
  }

  return { appId, installationId, owner, repo, branch, privateKey };
}

async function githubJson<T>(
  pathName: string,
  init: RequestInit,
  opts?: { allow404?: boolean },
): Promise<T | null> {
  const response = await fetch(`${GITHUB_API}${pathName}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });

  if (response.status === 404 && opts?.allow404) return null;
  const raw = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      raw && typeof raw === "object" && "message" in raw
        ? String((raw as { message?: unknown }).message || "").trim()
        : "";
    throw new SiteAdminSourceError(
      message || `GitHub API request failed (${response.status})`,
      { status: response.status, code: "GITHUB_API_ERROR" },
    );
  }
  return raw as T;
}

async function getGitHubInstallationToken(config: GitHubRepoConfig): Promise<string> {
  const cacheKey = `${config.installationId}:${config.owner}/${config.repo}`;
  const globalCache = globalThis as TokenCacheGlobal;
  const cached = globalCache.__siteAdminGithubTokenCache;
  if (cached && cached.key === cacheKey && cached.expiresAtMs > Date.now() + 60_000) {
    return cached.token;
  }

  const jwt = createGitHubAppJwt({
    appId: config.appId,
    privateKey: config.privateKey,
  });
  const response = await githubJson<{ token?: unknown; expires_at?: unknown }>(
    `/app/installations/${config.installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    },
  );

  const token = String(response?.token || "").trim();
  const expiresAtMs = parseIsoMs(String(response?.expires_at || ""));
  if (!token || !Number.isFinite(expiresAtMs)) {
    throw new SiteAdminSourceError("GitHub App access token response was invalid", {
      status: 500,
      code: "GITHUB_API_ERROR",
    });
  }

  globalCache.__siteAdminGithubTokenCache = {
    key: cacheKey,
    token,
    expiresAtMs,
  };
  return token;
}

async function fetchGitHubBranchHead(config: GitHubRepoConfig, token: string): Promise<{
  headSha: string;
  headCommittedAt: string;
}> {
  const branch = await githubJson<{ commit?: { sha?: unknown } }>(
    `/repos/${config.owner}/${config.repo}/branches/${encodeURIComponent(config.branch)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
  const headSha = String(branch?.commit?.sha || "").trim();
  if (!headSha) {
    throw new SiteAdminSourceError("GitHub branch head SHA was missing", {
      status: 500,
      code: "GITHUB_API_ERROR",
    });
  }
  const commit = await githubJson<{ commit?: { committer?: { date?: unknown }; author?: { date?: unknown } } }>(
    `/repos/${config.owner}/${config.repo}/commits/${headSha}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
  const headCommittedAt = String(
    commit?.commit?.committer?.date || commit?.commit?.author?.date || "",
  ).trim();
  return { headSha, headCommittedAt };
}

async function fetchGitHubContent<T>(input: {
  config: GitHubRepoConfig;
  token: string;
  path: string;
  fallbackValue: JsonStorePayload;
  parse: (value: unknown) => T;
}): Promise<GitHubContentRecord<T>> {
  const content = await githubJson<{
    type?: unknown;
    sha?: unknown;
    content?: unknown;
    encoding?: unknown;
  }>(
    `/repos/${input.config.owner}/${input.config.repo}/contents/${input.path}?ref=${encodeURIComponent(input.config.branch)}`,
    {
      headers: {
        Authorization: `Bearer ${input.token}`,
      },
    },
    { allow404: true },
  );

  if (!content) {
    const text = serializeJson(input.fallbackValue);
    return {
      value: input.parse(input.fallbackValue),
      sha: "",
      text,
    };
  }

  if (String(content.type || "") !== "file") {
    throw new SiteAdminSourceError(`GitHub content is not a file: ${input.path}`, {
      status: 500,
      code: "GITHUB_API_ERROR",
    });
  }

  const sha = String(content.sha || "").trim();
  const encoding = String(content.encoding || "").trim().toLowerCase();
  const payload = String(content.content || "").replace(/\n/g, "");
  const text = encoding === "base64" ? Buffer.from(payload, "base64").toString("utf8") : payload;

  let raw: unknown = input.fallbackValue;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = input.fallbackValue;
  }

  return {
    value: input.parse(raw),
    sha,
    text,
  };
}

async function putGitHubContent(input: {
  config: GitHubRepoConfig;
  token: string;
  path: string;
  text: string;
  sha: string;
  commitMessage: string;
}): Promise<void> {
  const response = await fetch(
    `${GITHUB_API}/repos/${input.config.owner}/${input.config.repo}/contents/${input.path}`,
    {
      method: "PUT",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${input.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: input.commitMessage,
        branch: input.config.branch,
        content: Buffer.from(input.text, "utf8").toString("base64"),
        ...(input.sha ? { sha: input.sha } : {}),
      }),
      cache: "no-store",
    },
  );

  if (response.ok) return;
  const raw = await response.json().catch(() => null);
  const message =
    raw && typeof raw === "object" && "message" in raw
      ? String((raw as { message?: unknown }).message || "").trim()
      : "";

  if (response.status === 409 || response.status === 422) {
    throw new SiteAdminSourceConflictError(message || undefined);
  }

  throw new SiteAdminSourceError(
    message || `GitHub content update failed (${response.status})`,
    { status: response.status, code: "GITHUB_API_ERROR" },
  );
}

export function createGitHubSiteAdminSourceStore(env = process.env): SiteAdminSourceStore {
  return {
    kind: "github",
    async getSnapshot() {
      const config = readGitHubRepoConfig(env);
      const token = await getGitHubInstallationToken(config);
      const [{ headSha, headCommittedAt }, siteConfig, protectedRoutes, routesManifest] = await Promise.all([
        fetchGitHubBranchHead(config, token),
        fetchGitHubContent({
          config,
          token,
          path: SOURCE_SITE_CONFIG_PATH,
          fallbackValue: {},
          parse: normalizeSourceSiteConfig,
        }),
        fetchGitHubContent({
          config,
          token,
          path: SOURCE_PROTECTED_ROUTES_PATH,
          fallbackValue: [],
          parse: (value) => normalizeProtectedRouteRows(Array.isArray(value) ? value : []),
        }),
        fetchGitHubContent({
          config,
          token,
          path: SOURCE_ROUTES_MANIFEST_PATH,
          fallbackValue: [],
          parse: (value) => normalizeSourceRouteManifestRows(Array.isArray(value) ? value : []),
        }),
      ]);

      return {
        siteConfig: siteConfig.value,
        protectedRoutes: protectedRoutes.value,
        routesManifest: routesManifest.value,
        version: {
          branchSha: headSha,
          siteConfigSha: siteConfig.sha,
          protectedRoutesSha: protectedRoutes.sha,
          routesManifestSha: routesManifest.sha,
        },
        source: {
          storeKind: "github",
          repo: `${config.owner}/${config.repo}`,
          branch: config.branch,
          headSha,
          headCommittedAt,
        },
      };
    },
    async writeSiteConfig(input) {
      const config = readGitHubRepoConfig(env);
      const token = await getGitHubInstallationToken(config);
      const current = await fetchGitHubContent({
        config,
        token,
        path: SOURCE_SITE_CONFIG_PATH,
        fallbackValue: {},
        parse: normalizeSourceSiteConfig,
      });
      const expected = String(input.expectedSiteConfigSha || "").trim();
      if (expected && current.sha !== expected) {
        throw new SiteAdminSourceConflictError();
      }
      await putGitHubContent({
        config,
        token,
        path: SOURCE_SITE_CONFIG_PATH,
        sha: current.sha,
        text: serializeJson(serializeSourceSiteConfig(input.nextSiteConfig)),
        commitMessage: input.commitMessage,
      });
      return this.getSnapshot();
    },
    async writeProtectedRoutes(input) {
      const config = readGitHubRepoConfig(env);
      const token = await getGitHubInstallationToken(config);
      const current = await fetchGitHubContent({
        config,
        token,
        path: SOURCE_PROTECTED_ROUTES_PATH,
        fallbackValue: [],
        parse: (value) => normalizeProtectedRouteRows(Array.isArray(value) ? value : []),
      });
      const expected = String(input.expectedProtectedRoutesSha || "").trim();
      if (expected && current.sha !== expected) {
        throw new SiteAdminSourceConflictError();
      }
      await putGitHubContent({
        config,
        token,
        path: SOURCE_PROTECTED_ROUTES_PATH,
        sha: current.sha,
        text: serializeJson(input.nextProtectedRoutes),
        commitMessage: input.commitMessage,
      });
      return this.getSnapshot();
    },
  };
}

export function resolveSiteAdminStorageKind(env = process.env): SiteAdminStorageKind {
  return String(env.SITE_ADMIN_STORAGE || "").trim().toLowerCase() === "github" ? "github" : "local";
}

export function getSiteAdminSourceStore(): SiteAdminSourceStore {
  return resolveSiteAdminStorageKind() === "github"
    ? createGitHubSiteAdminSourceStore()
    : createLocalSiteAdminSourceStore();
}

export async function getSiteAdminSourceSnapshot(): Promise<SiteAdminSourceSnapshot> {
  return getSiteAdminSourceStore().getSnapshot();
}
