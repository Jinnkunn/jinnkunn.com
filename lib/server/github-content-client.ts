// Lightweight GitHub REST client used by explicit GitHub Actions fallback
// dispatch and related tests.
//
// Scope: authenticated JSON requests + installation-token caching.
// Specific endpoint calls live in higher-level modules (github-workflow-dispatch).
// No `server-only` marker: we need to import this in the node:test runner for
// unit coverage, and the module has no client-safe twin so accidental client
// use is implausible (node:crypto + fetch to api.github.com).

import crypto from "node:crypto";

export class GitHubApiError extends Error {
  readonly status: number;
  readonly responseBody: unknown;

  constructor(input: { status: number; message: string; responseBody: unknown }) {
    super(input.message);
    this.name = "GitHubApiError";
    this.status = input.status;
    this.responseBody = input.responseBody;
  }
}

export type GitHubClientConfig = {
  appId: string;
  privateKey: string;
  installationId: string;
};

type CachedToken = { token: string; expiresAtMs: number };

// Module-scope caches: dedupe concurrent mint attempts and memoize the token
// across requests. These live on globalThis so hot-reload in dev doesn't
// multiply the cache.
const TOKEN_CACHE_KEY = "__jkn_github_installation_token_cache__";
const TOKEN_INFLIGHT_KEY = "__jkn_github_installation_token_inflight__";

type CacheHolder = {
  [TOKEN_CACHE_KEY]?: Map<string, CachedToken>;
  [TOKEN_INFLIGHT_KEY]?: Map<string, Promise<string>>;
};

function getTokenCache(): Map<string, CachedToken> {
  const holder = globalThis as CacheHolder;
  if (!holder[TOKEN_CACHE_KEY]) holder[TOKEN_CACHE_KEY] = new Map();
  return holder[TOKEN_CACHE_KEY];
}

function getInflight(): Map<string, Promise<string>> {
  const holder = globalThis as CacheHolder;
  if (!holder[TOKEN_INFLIGHT_KEY]) holder[TOKEN_INFLIGHT_KEY] = new Map();
  return holder[TOKEN_INFLIGHT_KEY];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export interface GitHubClient {
  request<T>(input: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    apiPath: string;
    body?: unknown;
  }): Promise<T>;
}

export function createGitHubAppClient(config: GitHubClientConfig): GitHubClient {
  const cacheKey = `${config.appId}:${config.installationId}`;

  function createAppJwt(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", typ: "JWT" }),
      "utf8",
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: config.appId }),
      "utf8",
    ).toString("base64url");
    const signingInput = `${header}.${payload}`;
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    const signature = signer.sign(config.privateKey, "base64url");
    return `${signingInput}.${signature}`;
  }

  async function rawRequest<T>(input: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    apiPath: string;
    body?: unknown;
    authToken: string;
  }): Promise<T> {
    const response = await fetch(`https://api.github.com${input.apiPath}`, {
      method: input.method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${input.authToken}`,
        "User-Agent": "jinnkunn-site-admin",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(input.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
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

  async function getInstallationToken(): Promise<string> {
    const cache = getTokenCache();
    const inflight = getInflight();
    const cached = cache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAtMs - 60_000 > now) return cached.token;
    const pending = inflight.get(cacheKey);
    if (pending) return pending;

    const promise = (async () => {
      const appJwt = createAppJwt();
      const payload = await rawRequest<unknown>({
        method: "POST",
        apiPath: `/app/installations/${encodeURIComponent(
          config.installationId,
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
      cache.set(cacheKey, { token, expiresAtMs });
      return token;
    })().finally(() => {
      inflight.delete(cacheKey);
    });

    inflight.set(cacheKey, promise);
    return promise;
  }

  return {
    async request<T>(input: {
      method: "GET" | "POST" | "PUT" | "DELETE";
      apiPath: string;
      body?: unknown;
    }): Promise<T> {
      const token = await getInstallationToken();
      return rawRequest<T>({ ...input, authToken: token });
    },
  };
}

function normalizePrivateKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  // Support PEM strings with literal \n sequences (common in env files).
  return trimmed.includes("\\n") ? trimmed.replace(/\\n/g, "\n") : trimmed;
}

export function createGitHubAppClientFromEnv(): GitHubClient | null {
  const appId = String(process.env.GITHUB_APP_ID || "").trim();
  const installationId = String(process.env.GITHUB_APP_INSTALLATION_ID || "").trim();
  const privateKeyInline = normalizePrivateKey(
    String(process.env.GITHUB_APP_PRIVATE_KEY || ""),
  );
  if (!appId || !installationId || !privateKeyInline) return null;
  return createGitHubAppClient({
    appId,
    privateKey: privateKeyInline,
    installationId,
  });
}
