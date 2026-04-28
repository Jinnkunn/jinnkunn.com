// SQLite-backed ContentStore. Stores file blobs as rows in a single
// `content_files` table; uses sha1 over the body bytes as the optimistic-lock
// version so the contract matches the local + GitHub stores 1:1 — callers
// don't need to branch.
//
// Decoupled from any specific SQLite client so the same code runs against:
//   - Cloudflare D1 binding (production / staging / dev under wrangler)
//   - in-memory libSQL                         (unit tests)
//   - any other SQLite client implementing `DbExecutor`
// No `server-only` marker so node:test can import it for unit coverage.

import { createHash } from "node:crypto";
import path from "node:path";

import {
  ContentStoreConflictError,
  ContentStoreNotFoundError,
  type ContentEntry,
  type ContentStore,
  type ContentVersion,
} from "./content-store.ts";

// Minimal SQL-execution surface shared by D1 (`prepare(...).bind(...).all()`)
// and libSQL (`execute({sql, args})`). Adapters live next to each backend.
export interface DbExecutor {
  execute(opts: { sql: string; args?: unknown[] }): Promise<{
    rows: Record<string, unknown>[];
    rowsAffected: number;
  }>;
}

export type DbContentStoreConfig = {
  executor: DbExecutor;
  // Optional: tag every write with an actor for the audit trail.
  // Called per-write so request-scoped values can be threaded in.
  getActor?: () => string | null | undefined;
};

function sha1HexBytes(input: Uint8Array): string {
  return createHash("sha1").update(input).digest("hex");
}

function utf8Bytes(input: string): Uint8Array {
  return new Uint8Array(Buffer.from(input, "utf8"));
}

function bytesToUtf8(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

// Decode a SQLite hex string (output of `hex()`) into bytes. The hand-rolled
// loop avoids depending on Buffer in case this code ever runs in a Workers
// context where the nodejs_compat shim isn't available.
function hexToBytes(hex: string): Uint8Array {
  const length = hex.length >> 1;
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
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

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && code.includes("CONSTRAINT")) return true;
  const message = (err as { message?: unknown }).message;
  if (typeof message === "string" && /UNIQUE constraint failed/i.test(message)) {
    return true;
  }
  return false;
}

export function createDbContentStore(config: DbContentStoreConfig): ContentStore {
  const { executor, getActor } = config;

  async function getRow(relPath: string): Promise<{
    body: Uint8Array;
    sha: string;
  } | null> {
    // Pull the body as a SQLite hex string (`lower(hex(body))`) instead of
    // raw BLOB. D1's binding has shipped BLOB-column results in several
    // shapes over time (ArrayBuffer, cross-realm ArrayBuffer, Uint8Array,
    // even number arrays in some Worker isolation contexts) — hex sidesteps
    // every one of those at the cost of 2x payload bytes, which is fine for
    // the small JSON / MDX rows we read here. libSQL also supports hex(),
    // so unit tests against in-memory libSQL exercise the same path.
    const result = await executor.execute({
      sql: "SELECT lower(hex(body)) AS body_hex, sha FROM content_files WHERE rel_path = ?",
      args: [relPath],
    });
    const row = result.rows[0];
    if (!row) return null;
    return {
      body: hexToBytes(String(row.body_hex)),
      sha: String(row.sha),
    };
  }

  async function upsert(
    relPath: string,
    body: Uint8Array,
    isBinary: boolean,
    opts?: { ifMatch?: ContentVersion | null },
  ): Promise<{ sha: string }> {
    const existing = await getRow(relPath);
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
    const sha = sha1HexBytes(body);
    if (existing && existing.sha === sha) {
      return { sha };
    }
    const updatedAt = Date.now();
    const updatedBy = getActor?.() ?? null;
    if (existing) {
      // UPDATE … WHERE sha = oldSha gives row-level atomicity even if a
      // concurrent writer slipped between the SELECT above and this UPDATE.
      const res = await executor.execute({
        sql: `UPDATE content_files
                 SET body = ?, sha = ?, size = ?, is_binary = ?, updated_at = ?, updated_by = ?
               WHERE rel_path = ? AND sha = ?`,
        args: [
          body,
          sha,
          body.byteLength,
          isBinary ? 1 : 0,
          updatedAt,
          updatedBy,
          relPath,
          existing.sha,
        ],
      });
      if ((res.rowsAffected ?? 0) === 0) {
        const fresh = await getRow(relPath);
        throw new ContentStoreConflictError({
          expected: opts?.ifMatch ?? null,
          actual: fresh?.sha ?? null,
        });
      }
    } else {
      try {
        await executor.execute({
          sql: `INSERT INTO content_files
                  (rel_path, body, sha, size, is_binary, updated_at, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            relPath,
            body,
            sha,
            body.byteLength,
            isBinary ? 1 : 0,
            updatedAt,
            updatedBy,
          ],
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          // Lost the race — a concurrent INSERT got there first.
          const fresh = await getRow(relPath);
          throw new ContentStoreConflictError({
            expected: opts?.ifMatch ?? null,
            actual: fresh?.sha ?? null,
          });
        }
        throw err;
      }
    }
    return { sha };
  }

  return {
    async listFiles(dirRel, opts) {
      const normalized = normalizeRel(dirRel);
      const prefix = `${normalized}/`;
      // Non-recursive listing excludes paths that have an additional `/`
      // after the prefix, i.e. files nested in subdirectories.
      const sql = opts?.recursive
        ? "SELECT rel_path, sha, size FROM content_files WHERE rel_path LIKE ? ORDER BY rel_path"
        : "SELECT rel_path, sha, size FROM content_files WHERE rel_path LIKE ? AND instr(substr(rel_path, ?), '/') = 0 ORDER BY rel_path";
      const args = opts?.recursive
        ? [`${prefix}%`]
        : [`${prefix}%`, prefix.length + 1];
      const result = await executor.execute({ sql, args });
      const out: ContentEntry[] = [];
      for (const row of result.rows) {
        const relPath = String(row.rel_path);
        const name = path.posix.basename(relPath);
        out.push({
          name,
          relPath,
          sha: String(row.sha),
          size: Number(row.size),
        });
      }
      out.sort((a, b) => a.name.localeCompare(b.name));
      return out;
    },

    async readFile(relPath) {
      const normalized = normalizeRel(relPath);
      const row = await getRow(normalized);
      if (!row) return null;
      return { content: bytesToUtf8(row.body), sha: row.sha };
    },

    async readBinary(relPath) {
      const normalized = normalizeRel(relPath);
      const row = await getRow(normalized);
      if (!row) return null;
      return { data: row.body, sha: row.sha };
    },

    async writeFile(relPath, content, opts) {
      const normalized = normalizeRel(relPath);
      return upsert(normalized, utf8Bytes(content), false, opts);
    },

    async writeBinary(relPath, data, opts) {
      const normalized = normalizeRel(relPath);
      return upsert(normalized, data, true, opts);
    },

    async deleteFile(relPath, opts) {
      const normalized = normalizeRel(relPath);
      const existing = await getRow(normalized);
      if (!existing) throw new ContentStoreNotFoundError(normalized);
      if (opts?.ifMatch !== undefined && opts.ifMatch !== null) {
        if (opts.ifMatch !== existing.sha) {
          throw new ContentStoreConflictError({
            expected: opts.ifMatch,
            actual: existing.sha,
          });
        }
      }
      const res = await executor.execute({
        sql: "DELETE FROM content_files WHERE rel_path = ? AND sha = ?",
        args: [normalized, existing.sha],
      });
      if ((res.rowsAffected ?? 0) === 0) {
        // Race: someone updated/deleted between the SELECT and DELETE.
        const fresh = await getRow(normalized);
        throw new ContentStoreConflictError({
          expected: opts?.ifMatch ?? null,
          actual: fresh?.sha ?? null,
        });
      }
    },
  };
}
