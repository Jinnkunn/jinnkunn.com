// File-IO surface used by SiteAdminSourceStore. Exists so the higher-level
// store doesn't have to branch on storage mode for every read/write — it just
// holds a backend and calls through.
//
// Two implementations:
//   - createFsFileBackend: node:fs + git shell (mirrors the original
//     LocalSiteAdminSourceStore behavior; for dev and CI builds).
//   - createDbFileBackend: D1-backed via the existing DbContentStore. Paths
//     must live under content/; the prefix is stripped before delegating to
//     the content store, whose rows are content-relative.
//
// History methods on the db backend stub to empty results — D1 has no
// commit timeline; an audit-log-backed implementation can replace the stub
// later without changing this interface.
//
// No `server-only` marker so node:test can import it for unit coverage.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { createDbContentStore, type DbExecutor } from "./db-content-store.ts";

const execFileAsync = promisify(execFile);

// Re-declared here to keep this module independent of site-admin-source-store
// (which would create a tricky circular import for the runtime impls; type
// imports are erased so the inverse direction is fine).
export type SiteAdminFileHistoryEntry = {
  commitSha: string;
  commitShort: string;
  committedAt: string | null;
  authorName: string;
  message: string;
};

export type SiteAdminFileStat = {
  exists: boolean;
  size?: number;
  mtimeMs?: number;
};

export interface SiteAdminFileBackend {
  readonly kind: "fs" | "db";

  /** Lightweight existence + size + mtime probe. Used by the Status panel
   * to render the GENERATED FILES card without parsing every JSON. The fs
   * backend uses fs.statSync (with a readFileSync fallback for bundled
   * Workers files); the db backend queries content_files row metadata. */
  statFile(repoRel: string): Promise<SiteAdminFileStat>;

  /** Read a JSON file by repo-root-relative path. Returns null when the file
   * doesn't exist or doesn't parse. */
  readJsonFile(repoRel: string): Promise<unknown | null>;

  /** Write a JSON file (sorted keys, trailing newline) by repo-root-relative
   * path. Creates parent dirs as needed. Always overwrites — optimistic
   * concurrency is enforced one layer up by SiteAdminSourceStore. */
  writeJsonFile(repoRel: string, value: unknown): Promise<void>;

  /** Read a UTF-8 text file by repo-root-relative path. The returned `sha`
   * is the source-store's content-hash form (jsonSha) so it lines up with
   * the optimistic-lock keys used by writeTextFile. */
  readTextFile(
    repoRel: string,
  ): Promise<{ content: string; sha: string } | null>;

  /** Write a UTF-8 text file with optional `expectedSha` optimistic lock.
   * Throws SiteAdminSourceConflictError-like errors via a callback set up
   * by the caller; raw conflicts here surface as null returns or thrown
   * `Error` so this module stays free of cross-module imports. */
  writeTextFile(input: {
    repoRel: string;
    content: string;
    expectedSha?: string;
  }): Promise<{ fileSha: string; commitSha: string }>;

  /** Best-effort recent-change history for `repoRel`. Returns an empty array
   * when the backend has no concept of history (db backend, missing git). */
  listTextFileHistory(
    repoRel: string,
    limit: number,
  ): Promise<SiteAdminFileHistoryEntry[]>;

  /** Read `repoRel` at a specific commit. Returns null when the backend
   * can't address by commit (db backend) or when the commit isn't found. */
  readTextFileAtCommit(
    repoRel: string,
    commitSha: string,
  ): Promise<{ content: string; sha: string; commitSha: string } | null>;
}

// Conflict signal used by writeTextFile when expectedSha doesn't match the
// current file. Caller (SiteAdminSourceStore) translates to its own error
// type so this module stays import-free of source-store types.
export class SiteAdminFileBackendConflictError extends Error {
  readonly code = "BACKEND_CONFLICT";
  readonly expectedSha: string;
  readonly currentSha: string;
  constructor(input: { expectedSha: string; currentSha: string }) {
    super(
      `site-admin file backend: sha mismatch (expected ${input.expectedSha}, current ${input.currentSha})`,
    );
    this.name = "SiteAdminFileBackendConflictError";
    this.expectedSha = input.expectedSha;
    this.currentSha = input.currentSha;
  }
}

export function isSiteAdminFileBackendConflictError(
  err: unknown,
): err is SiteAdminFileBackendConflictError {
  return err instanceof SiteAdminFileBackendConflictError;
}

// ---- shared helpers (intentionally duplicated from site-admin-source-store)
// These are tiny pure utilities; importing them across modules creates a
// circular dependency (source-store imports backend impls; backend would
// need to import source-store helpers). Keeping local copies keeps both
// modules clean.

function sha1Hex(input: string): string {
  return createHash("sha1").update(input, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
  for (const key of keys) out[key] = sortJson(value[key]);
  return out;
}

function jsonShaOfValue(value: unknown): string {
  return sha1Hex(JSON.stringify(sortJson(value)));
}

function jsonShaOfText(content: string): string {
  // Match LocalSiteAdminSourceStore.readTextFile's hashing — wraps the raw
  // string through the same JSON.stringify path so the returned sha lines
  // up with what consumers expect and pass back as expectedSha.
  return jsonShaOfValue(content);
}

function pickExistingFile(filePath: string): string {
  try {
    return fs.statSync(filePath).isFile() ? filePath : "";
  } catch {
    return "";
  }
}

// -- FsFileBackend: byte-for-byte mirrors the original LocalSiteAdminSourceStore
// fs/git behavior so the refactor is a no-op for local mode.

export type FsFileBackendConfig = {
  rootDir: string;
};

export function createFsFileBackend(
  config: FsFileBackendConfig,
): SiteAdminFileBackend {
  const rootDir = config.rootDir;

  function resolve(repoRel: string): string {
    return path.join(rootDir, repoRel);
  }

  return {
    kind: "fs",

    async statFile(repoRel) {
      const filePath = resolve(repoRel);
      try {
        const st = fs.statSync(filePath);
        return {
          exists: st.isFile(),
          size: st.size,
          mtimeMs: st.mtimeMs,
        };
      } catch {
        // See lib/server/fs-stats.ts for context: Workers fs can fail to
        // stat bundled Data files even though readFileSync works.
        try {
          const data = fs.readFileSync(filePath);
          return { exists: true, size: data.length };
        } catch {
          return { exists: false };
        }
      }
    },

    async readJsonFile(repoRel) {
      const filePath = pickExistingFile(resolve(repoRel));
      if (!filePath) return null;
      try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch {
        return null;
      }
    },

    async writeJsonFile(repoRel, value) {
      const outPath = resolve(repoRel);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(
        outPath,
        `${JSON.stringify(sortJson(value), null, 2)}\n`,
        "utf8",
      );
    },

    async readTextFile(repoRel) {
      const filePath = resolve(repoRel);
      try {
        const content = fs.readFileSync(filePath, "utf8");
        return { content, sha: jsonShaOfText(content) };
      } catch {
        return null;
      }
    },

    async writeTextFile(input) {
      const filePath = resolve(input.repoRel);
      let existingContent: string | null = null;
      try {
        existingContent = fs.readFileSync(filePath, "utf8");
      } catch {
        existingContent = null;
      }
      if (input.expectedSha !== undefined) {
        const currentSha = existingContent === null
          ? ""
          : jsonShaOfText(existingContent);
        if (currentSha !== input.expectedSha) {
          throw new SiteAdminFileBackendConflictError({
            expectedSha: input.expectedSha,
            currentSha,
          });
        }
      }
      if (existingContent === input.content) {
        const sha = jsonShaOfText(input.content);
        return { fileSha: sha, commitSha: sha };
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, input.content, "utf8");
      const sha = jsonShaOfText(input.content);
      return { fileSha: sha, commitSha: sha };
    },

    async listTextFileHistory(repoRel, limit) {
      const maxCount = Math.max(1, Math.min(50, Math.floor(limit)));
      try {
        const { stdout } = await execFileAsync(
          "git",
          [
            "log",
            `--max-count=${maxCount}`,
            "--format=%H%x1f%h%x1f%ct%x1f%an%x1f%s",
            "--",
            repoRel,
          ],
          { cwd: rootDir, maxBuffer: 1024 * 1024 },
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
    },

    async readTextFileAtCommit(repoRel, commitSha) {
      if (!/^[a-f0-9]{7,40}$/i.test(commitSha)) return null;
      try {
        const { stdout } = await execFileAsync(
          "git",
          ["show", `${commitSha}:${repoRel}`],
          { cwd: rootDir, maxBuffer: 8 * 1024 * 1024 },
        );
        return { content: stdout, sha: jsonShaOfText(stdout), commitSha };
      } catch {
        return null;
      }
    },
  };
}

// -- DbFileBackend: delegates to DbContentStore. Paths must be under content/.

export type DbFileBackendConfig = {
  executor: DbExecutor;
};

const CONTENT_PREFIX = "content/";

function toContentRel(repoRel: string): string {
  if (!repoRel.startsWith(CONTENT_PREFIX)) {
    // The site-admin source store only operates on content/-rooted paths;
    // anything else is a bug in the caller. Throwing loudly beats silently
    // routing the wrong file to the wrong place.
    throw new Error(
      `db file backend: path must be under content/: ${repoRel}`,
    );
  }
  return repoRel.slice(CONTENT_PREFIX.length);
}

export function createDbFileBackend(
  config: DbFileBackendConfig,
): SiteAdminFileBackend {
  const contentStore = createDbContentStore({ executor: config.executor });
  const executor = config.executor;

  return {
    kind: "db",

    async statFile(repoRel) {
      const contentRel = toContentRel(repoRel);
      // Direct executor query (instead of contentStore.readFile) so we get
      // size + updated_at without pulling the whole body across the wire.
      const result = await executor.execute({
        sql: "SELECT size, updated_at FROM content_files WHERE rel_path = ?",
        args: [contentRel],
      });
      const row = result.rows[0];
      if (!row) return { exists: false };
      const size = Number(row.size);
      const updatedAt = Number(row.updated_at);
      return {
        exists: true,
        ...(Number.isFinite(size) ? { size } : {}),
        ...(Number.isFinite(updatedAt) ? { mtimeMs: updatedAt } : {}),
      };
    },

    async readJsonFile(repoRel) {
      const contentRel = toContentRel(repoRel);
      const result = await contentStore.readFile(contentRel);
      if (!result) return null;
      try {
        return JSON.parse(result.content);
      } catch {
        return null;
      }
    },

    async writeJsonFile(repoRel, value) {
      const contentRel = toContentRel(repoRel);
      const json = `${JSON.stringify(sortJson(value), null, 2)}\n`;
      await contentStore.writeFile(contentRel, json);
    },

    async readTextFile(repoRel) {
      const contentRel = toContentRel(repoRel);
      const result = await contentStore.readFile(contentRel);
      if (!result) return null;
      // Recompute jsonShaOfText from content rather than reusing the
      // ContentStore sha. The two happen to differ — DbContentStore stores
      // sha1(bytes) while the source store's optimistic lock keys are
      // sha1(JSON.stringify(content)). Recomputing keeps lock semantics
      // backwards compatible with the fs backend.
      return { content: result.content, sha: jsonShaOfText(result.content) };
    },

    async writeTextFile(input) {
      const contentRel = toContentRel(input.repoRel);
      const existing = await contentStore.readFile(contentRel);
      if (input.expectedSha !== undefined) {
        const currentSha = existing
          ? jsonShaOfText(existing.content)
          : "";
        if (currentSha !== input.expectedSha) {
          throw new SiteAdminFileBackendConflictError({
            expectedSha: input.expectedSha,
            currentSha,
          });
        }
      }
      if (existing && existing.content === input.content) {
        const sha = jsonShaOfText(input.content);
        return { fileSha: sha, commitSha: sha };
      }
      await contentStore.writeFile(contentRel, input.content);
      const sha = jsonShaOfText(input.content);
      return { fileSha: sha, commitSha: sha };
    },

    async listTextFileHistory(_repoRel, _limit) {
      // D1 has no native commit timeline. Stub for now; an audit-log-backed
      // implementation can drop in here later.
      void _repoRel;
      void _limit;
      return [];
    },

    async readTextFileAtCommit(_repoRel, _commitSha) {
      void _repoRel;
      void _commitSha;
      return null;
    },
  };
}
