// GitHub-backed ContentStore: reads/writes text files under the repo's
// `content/` directory via the GitHub Contents API. Designed for site-admin
// CRUD endpoints running on Cloudflare Workers (read-only filesystem).
// No `server-only` marker so node:test can import it for unit coverage.

import path from "node:path";

import {
  ContentStoreConflictError,
  ContentStoreNotFoundError,
  type ContentEntry,
  type ContentStore,
  type ContentVersion,
} from "./content-store.ts";
import {
  createGitHubAppClient,
  createGitHubAppClientFromEnv,
  GitHubApiError,
  type GitHubClient,
} from "./github-content-client.ts";

export type GitHubContentStoreConfig = {
  client: GitHubClient;
  owner: string;
  repo: string;
  branch: string;
  rootDirInRepo: string; // e.g. "content"
  commitAuthorName?: string;
  commitAuthorEmail?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function encodeRepoPath(rel: string): string {
  return rel
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function normalizeRel(relPath: string): string {
  const normalized = path.posix.normalize(relPath.replace(/^\/+/, ""));
  if (
    !normalized ||
    normalized.startsWith("..") ||
    normalized.includes("/../") ||
    normalized.endsWith("/..")
  ) {
    throw new Error(`content store: invalid path: ${relPath}`);
  }
  return normalized;
}

export function createGithubContentStore(
  config: GitHubContentStoreConfig,
): ContentStore {
  const { client, owner, repo, branch, rootDirInRepo } = config;

  function repoPath(contentRel: string): string {
    const normalized = normalizeRel(contentRel);
    return `${rootDirInRepo}/${normalized}`;
  }

  async function getFileMeta(
    contentRel: string,
  ): Promise<{ sha: string; content: string } | null> {
    try {
      const payload = await client.request<unknown>({
        method: "GET",
        apiPath: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
          repo,
        )}/contents/${encodeRepoPath(repoPath(contentRel))}?ref=${encodeURIComponent(branch)}`,
      });
      const data = asRecord(payload);
      const type = asString(data.type);
      const sha = asString(data.sha);
      const encoding = asString(data.encoding).toLowerCase();
      const rawContent = asString(data.content);
      if (type !== "file" || !sha || encoding !== "base64" || !rawContent) return null;
      const content = Buffer.from(rawContent.replace(/\s+/g, ""), "base64").toString("utf8");
      return { sha, content };
    } catch (err) {
      if (err instanceof GitHubApiError && err.status === 404) return null;
      throw err;
    }
  }

  return {
    async listFiles(dirRel: string): Promise<ContentEntry[]> {
      const normalized = normalizeRel(dirRel);
      try {
        const payload = await client.request<unknown>({
          method: "GET",
          apiPath: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
            repo,
          )}/contents/${encodeRepoPath(
            `${rootDirInRepo}/${normalized}`,
          )}?ref=${encodeURIComponent(branch)}`,
        });
        if (!Array.isArray(payload)) return [];
        const out: ContentEntry[] = [];
        for (const raw of payload) {
          const node = asRecord(raw);
          if (asString(node.type) !== "file") continue;
          const name = asString(node.name);
          const sha = asString(node.sha);
          if (!name || !sha) continue;
          out.push({
            name,
            relPath: path.posix.join(normalized, name),
            sha,
            size: asNumber(node.size),
          });
        }
        out.sort((a, b) => a.name.localeCompare(b.name));
        return out;
      } catch (err) {
        if (err instanceof GitHubApiError && err.status === 404) return [];
        throw err;
      }
    },

    async readFile(relPath: string) {
      const file = await getFileMeta(relPath);
      return file ? { content: file.content, sha: file.sha } : null;
    },

    async readBinary(relPath: string) {
      // Ask the GitHub Contents API for the raw base64 payload — same endpoint
      // as getFileMeta, but we decode to bytes instead of a UTF-8 string.
      try {
        const payload = await client.request<unknown>({
          method: "GET",
          apiPath: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
            repo,
          )}/contents/${encodeRepoPath(repoPath(relPath))}?ref=${encodeURIComponent(branch)}`,
        });
        const data = asRecord(payload);
        const type = asString(data.type);
        const sha = asString(data.sha);
        const encoding = asString(data.encoding).toLowerCase();
        const rawContent = asString(data.content);
        if (type !== "file" || !sha || encoding !== "base64" || !rawContent) return null;
        const bytes = Uint8Array.from(
          Buffer.from(rawContent.replace(/\s+/g, ""), "base64"),
        );
        return { data: bytes, sha };
      } catch (err) {
        if (err instanceof GitHubApiError && err.status === 404) return null;
        throw err;
      }
    },

    async writeFile(
      relPath: string,
      content: string,
      opts?: { ifMatch?: ContentVersion | null; commitMessage?: string },
    ) {
      const existing = await getFileMeta(relPath);
      if (opts?.ifMatch !== undefined) {
        const expected = opts.ifMatch;
        const actual = existing?.sha ?? null;
        const isCreate = expected === null || expected === "";
        if (isCreate && actual !== null) {
          throw new ContentStoreConflictError({ expected, actual });
        }
        if (!isCreate && expected !== actual) {
          throw new ContentStoreConflictError({ expected, actual });
        }
      }
      const repoPathStr = repoPath(relPath);
      const message =
        opts?.commitMessage ?? `chore(site-admin): update ${repoPathStr}`;
      try {
        const payload = await client.request<unknown>({
          method: "PUT",
          apiPath: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
            repo,
          )}/contents/${encodeRepoPath(repoPathStr)}`,
          body: {
            message,
            content: Buffer.from(content, "utf8").toString("base64"),
            branch,
            ...(existing?.sha ? { sha: existing.sha } : {}),
            ...(config.commitAuthorName && config.commitAuthorEmail
              ? {
                  committer: {
                    name: config.commitAuthorName,
                    email: config.commitAuthorEmail,
                  },
                }
              : {}),
          },
        });
        const responseData = asRecord(payload);
        const file = asRecord(responseData.content);
        const newSha = asString(file.sha);
        if (!newSha) throw new Error("GitHub write returned no sha");
        return { sha: newSha };
      } catch (err) {
        if (
          err instanceof GitHubApiError &&
          (err.status === 409 || err.status === 422)
        ) {
          const latest = await getFileMeta(relPath);
          throw new ContentStoreConflictError({
            expected: opts?.ifMatch ?? null,
            actual: latest?.sha ?? null,
          });
        }
        throw err;
      }
    },

    async writeBinary(
      relPath: string,
      data: Uint8Array,
      opts?: { ifMatch?: ContentVersion | null; commitMessage?: string },
    ): Promise<{ sha: ContentVersion }> {
      const existing = await getFileMeta(relPath);
      if (opts?.ifMatch !== undefined) {
        const expected = opts.ifMatch;
        const actual = existing?.sha ?? null;
        const isCreate = expected === null || expected === "";
        if (isCreate && actual !== null) {
          throw new ContentStoreConflictError({ expected, actual });
        }
        if (!isCreate && expected !== actual) {
          throw new ContentStoreConflictError({ expected, actual });
        }
      }
      const repoPathStr = repoPath(relPath);
      const message =
        opts?.commitMessage ?? `chore(site-admin): upload ${repoPathStr}`;
      try {
        const payload = await client.request<unknown>({
          method: "PUT",
          apiPath: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
            repo,
          )}/contents/${encodeRepoPath(repoPathStr)}`,
          body: {
            message,
            content: Buffer.from(data).toString("base64"),
            branch,
            ...(existing?.sha ? { sha: existing.sha } : {}),
            ...(config.commitAuthorName && config.commitAuthorEmail
              ? {
                  committer: {
                    name: config.commitAuthorName,
                    email: config.commitAuthorEmail,
                  },
                }
              : {}),
          },
        });
        const responseData = asRecord(payload);
        const file = asRecord(responseData.content);
        const newSha = asString(file.sha);
        if (!newSha) throw new Error("GitHub write returned no sha");
        return { sha: newSha };
      } catch (err) {
        if (
          err instanceof GitHubApiError &&
          (err.status === 409 || err.status === 422)
        ) {
          const latest = await getFileMeta(relPath);
          throw new ContentStoreConflictError({
            expected: opts?.ifMatch ?? null,
            actual: latest?.sha ?? null,
          });
        }
        throw err;
      }
    },

    async deleteFile(
      relPath: string,
      opts?: { ifMatch?: ContentVersion | null; commitMessage?: string },
    ) {
      const existing = await getFileMeta(relPath);
      if (!existing) throw new ContentStoreNotFoundError(relPath);
      if (opts?.ifMatch !== undefined && opts.ifMatch !== null) {
        if (opts.ifMatch !== existing.sha) {
          throw new ContentStoreConflictError({
            expected: opts.ifMatch,
            actual: existing.sha,
          });
        }
      }
      const repoPathStr = repoPath(relPath);
      const message =
        opts?.commitMessage ?? `chore(site-admin): delete ${repoPathStr}`;
      try {
        await client.request<unknown>({
          method: "DELETE",
          apiPath: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
            repo,
          )}/contents/${encodeRepoPath(repoPathStr)}`,
          body: {
            message,
            sha: existing.sha,
            branch,
            ...(config.commitAuthorName && config.commitAuthorEmail
              ? {
                  committer: {
                    name: config.commitAuthorName,
                    email: config.commitAuthorEmail,
                  },
                }
              : {}),
          },
        });
      } catch (err) {
        if (
          err instanceof GitHubApiError &&
          (err.status === 409 || err.status === 422)
        ) {
          const latest = await getFileMeta(relPath);
          throw new ContentStoreConflictError({
            expected: opts?.ifMatch ?? null,
            actual: latest?.sha ?? null,
          });
        }
        throw err;
      }
    },
  };
}

export function createGithubContentStoreFromEnv(): ContentStore | null {
  const client = createGitHubAppClientFromEnv();
  if (!client) return null;
  const owner = String(process.env.SITE_ADMIN_REPO_OWNER || "").trim();
  const repo = String(process.env.SITE_ADMIN_REPO_NAME || "").trim();
  const branch = String(process.env.SITE_ADMIN_REPO_BRANCH || "").trim() || "main";
  const commitAuthorName =
    String(process.env.SITE_ADMIN_COMMIT_AUTHOR_NAME || "").trim() || undefined;
  const commitAuthorEmail =
    String(process.env.SITE_ADMIN_COMMIT_AUTHOR_EMAIL || "").trim() || undefined;
  if (!owner || !repo) return null;
  return createGithubContentStore({
    client,
    owner,
    repo,
    branch,
    rootDirInRepo: "content",
    commitAuthorName,
    commitAuthorEmail,
  });
}

// Re-export for unit tests.
export { createGitHubAppClient };
