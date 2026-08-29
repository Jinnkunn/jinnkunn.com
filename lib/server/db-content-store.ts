// SQLite-backed implementation of the canonical DocumentRepository contract.
// ContentStore remains available as a compatibility facade for older callers.

import { createHash } from "node:crypto";

import {
  DocumentConflictError,
  DocumentNotFoundError,
  normalizeDocumentPath,
  type DocumentEntry,
  type DocumentRepository,
  type DocumentVersion,
} from "@jinnkunn/document-repository";
import {
  contentStoreFromDocumentRepository,
  type ContentStore,
} from "./content-store.ts";

export interface DbExecutor {
  execute(opts: { sql: string; args?: unknown[] }): Promise<{
    rows: Record<string, unknown>[];
    rowsAffected: number;
  }>;
}

export type DbContentStoreConfig = {
  executor: DbExecutor;
  /** Request-scoped actor recorded on writes and history rows. */
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

// SQLite's hex() result avoids relying on the varying BLOB result shapes
// returned by D1 and libSQL runtimes.
function hexToBytes(hex: string): Uint8Array {
  const length = hex.length >> 1;
  const out = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && code.includes("CONSTRAINT")) return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && /UNIQUE constraint failed/i.test(message);
}

function assertExpectedVersion(input: {
  expectedVersion: DocumentVersion | null | undefined;
  actualVersion: DocumentVersion | null;
}): void {
  if (input.expectedVersion === undefined) return;
  const creating = input.expectedVersion === null || input.expectedVersion === "";
  if (creating ? input.actualVersion !== null : input.expectedVersion !== input.actualVersion) {
    throw new DocumentConflictError({
      expectedVersion: input.expectedVersion,
      actualVersion: input.actualVersion,
    });
  }
}

export function createDbDocumentRepository(
  config: DbContentStoreConfig,
): DocumentRepository {
  const { executor, getActor } = config;

  async function getRow(documentPath: string): Promise<{
    body: Uint8Array;
    sha: string;
    size: number;
    updatedAt: number;
  } | null> {
    const result = await executor.execute({
      sql: `SELECT lower(hex(body)) AS body_hex, sha, size, updated_at
              FROM content_files
             WHERE rel_path = ?`,
      args: [documentPath],
    });
    const row = result.rows[0];
    if (!row) return null;
    return {
      body: hexToBytes(String(row.body_hex || "")),
      sha: String(row.sha || ""),
      size: Number(row.size),
      updatedAt: Number(row.updated_at),
    };
  }

  async function writeBytes(input: {
    path: string;
    body: Uint8Array;
    isBinary: boolean;
    expectedVersion: DocumentVersion | null | undefined;
  }) {
    const documentPath = normalizeDocumentPath(input.path);
    const existing = await getRow(documentPath);
    assertExpectedVersion({
      expectedVersion: input.expectedVersion,
      actualVersion: existing?.sha ?? null,
    });

    const sha = sha1HexBytes(input.body);
    if (existing?.sha === sha) {
      return { path: documentPath, version: sha, state: "committed" as const };
    }

    const updatedAt = Date.now();
    const updatedBy = getActor?.() ?? null;
    if (existing) {
      const result = await executor.execute({
        sql: `UPDATE content_files
                 SET body = ?, sha = ?, size = ?, is_binary = ?, updated_at = ?, updated_by = ?
               WHERE rel_path = ? AND sha = ?`,
        args: [
          input.body,
          sha,
          input.body.byteLength,
          input.isBinary ? 1 : 0,
          updatedAt,
          updatedBy,
          documentPath,
          existing.sha,
        ],
      });
      if ((result.rowsAffected ?? 0) === 0) {
        const fresh = await getRow(documentPath);
        throw new DocumentConflictError({
          expectedVersion: input.expectedVersion ?? existing.sha,
          actualVersion: fresh?.sha ?? null,
        });
      }
    } else {
      try {
        await executor.execute({
          sql: `INSERT INTO content_files
                  (rel_path, body, sha, size, is_binary, updated_at, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            documentPath,
            input.body,
            sha,
            input.body.byteLength,
            input.isBinary ? 1 : 0,
            updatedAt,
            updatedBy,
          ],
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const fresh = await getRow(documentPath);
        throw new DocumentConflictError({
          expectedVersion: input.expectedVersion ?? null,
          actualVersion: fresh?.sha ?? null,
        });
      }
    }

    // Binary revisions are not exposed by the product and would duplicate
    // large assets in D1. Text writes retain the existing version timeline.
    if (!input.isBinary) {
      try {
        await executor.execute({
          sql: `INSERT INTO content_files_history
                  (rel_path, body, sha, size, is_binary, updated_at, updated_by)
                VALUES (?, ?, ?, ?, 0, ?, ?)`,
          args: [
            documentPath,
            input.body,
            sha,
            input.body.byteLength,
            updatedAt,
            updatedBy,
          ],
        });
      } catch {
        // A missing history migration must not turn a successful write into
        // a failed user operation.
      }
    }

    return { path: documentPath, version: sha, state: "committed" as const };
  }

  return {
    kind: "d1",

    async list(prefix, options) {
      const normalizedPrefix = normalizeDocumentPath(prefix);
      const pathPrefix = `${normalizedPrefix}/`;
      const sql = options?.recursive
        ? `SELECT rel_path, sha, size, updated_at
             FROM content_files
            WHERE rel_path LIKE ?
            ORDER BY rel_path`
        : `SELECT rel_path, sha, size, updated_at
             FROM content_files
            WHERE rel_path LIKE ?
              AND instr(substr(rel_path, ?), '/') = 0
            ORDER BY rel_path`;
      const args = options?.recursive
        ? [`${pathPrefix}%`]
        : [`${pathPrefix}%`, pathPrefix.length + 1];
      const result = await executor.execute({ sql, args });
      const entries: DocumentEntry[] = result.rows.map((row) => {
        const documentPath = String(row.rel_path);
        const updatedAt = Number(row.updated_at);
        return {
          name: documentPath.slice(documentPath.lastIndexOf("/") + 1),
          path: documentPath,
          version: String(row.sha),
          size: Number(row.size),
          ...(Number.isFinite(updatedAt) ? { updatedAt } : {}),
        };
      });
      entries.sort((left, right) => left.path.localeCompare(right.path));
      return entries;
    },

    async stat(input) {
      const documentPath = normalizeDocumentPath(input);
      const result = await executor.execute({
        sql: `SELECT sha, size, updated_at
                FROM content_files
               WHERE rel_path = ?`,
        args: [documentPath],
      });
      const row = result.rows[0];
      if (!row) return { exists: false };
      const updatedAt = Number(row.updated_at);
      return {
        exists: true,
        version: String(row.sha),
        size: Number(row.size),
        ...(Number.isFinite(updatedAt) ? { updatedAt } : {}),
      };
    },

    async readText(input) {
      const documentPath = normalizeDocumentPath(input);
      const row = await getRow(documentPath);
      return row
        ? { path: documentPath, content: bytesToUtf8(row.body), version: row.sha }
        : null;
    },

    async readBinary(input) {
      const documentPath = normalizeDocumentPath(input);
      const row = await getRow(documentPath);
      return row
        ? { path: documentPath, data: row.body, version: row.sha }
        : null;
    },

    async writeText(input, content, options) {
      return writeBytes({
        path: input,
        body: utf8Bytes(content),
        isBinary: false,
        expectedVersion: options?.expectedVersion,
      });
    },

    async writeBinary(input, data, options) {
      return writeBytes({
        path: input,
        body: data,
        isBinary: true,
        expectedVersion: options?.expectedVersion,
      });
    },

    async delete(input, options) {
      const documentPath = normalizeDocumentPath(input);
      const existing = await getRow(documentPath);
      if (!existing) throw new DocumentNotFoundError(documentPath);
      assertExpectedVersion({
        expectedVersion: options?.expectedVersion,
        actualVersion: existing.sha,
      });
      const result = await executor.execute({
        sql: "DELETE FROM content_files WHERE rel_path = ? AND sha = ?",
        args: [documentPath, existing.sha],
      });
      if ((result.rowsAffected ?? 0) === 0) {
        const fresh = await getRow(documentPath);
        throw new DocumentConflictError({
          expectedVersion: options?.expectedVersion ?? existing.sha,
          actualVersion: fresh?.sha ?? null,
        });
      }
      return {
        path: documentPath,
        version: existing.sha,
        state: "committed" as const,
      };
    },

    async listHistory(input, limit = 12) {
      const documentPath = normalizeDocumentPath(input);
      const max = Math.max(1, Math.min(50, Math.floor(limit)));
      try {
        const result = await executor.execute({
          sql: `SELECT sha, updated_at, updated_by
                  FROM content_files_history
                 WHERE rel_path = ?
                 ORDER BY updated_at DESC, id DESC
                 LIMIT ?`,
          args: [documentPath, max],
        });
        return result.rows.map((row) => {
          const version = String(row.sha || "");
          const updatedAt = Number(row.updated_at);
          return {
            version,
            shortVersion: version.slice(0, 7),
            createdAt: Number.isFinite(updatedAt)
              ? new Date(updatedAt).toISOString()
              : null,
            actor: row.updated_by == null ? "" : String(row.updated_by),
            message: "",
          };
        });
      } catch {
        return [];
      }
    },

    async readRevision(input, version) {
      const documentPath = normalizeDocumentPath(input);
      const normalizedVersion = String(version || "").trim().toLowerCase();
      if (!/^[a-f0-9]{7,40}$/.test(normalizedVersion)) return null;
      try {
        const result = await executor.execute({
          sql: `SELECT lower(hex(body)) AS body_hex, sha
                  FROM content_files_history
                 WHERE rel_path = ?
                   AND substr(sha, 1, ?) = ?
                 ORDER BY id DESC
                 LIMIT 1`,
          args: [documentPath, normalizedVersion.length, normalizedVersion],
        });
        const row = result.rows[0];
        if (!row) return null;
        return {
          path: documentPath,
          content: bytesToUtf8(hexToBytes(String(row.body_hex || ""))),
          version: String(row.sha),
        };
      } catch {
        return null;
      }
    },
  };
}

/** Historical entry point retained while callers migrate to DocumentRepository. */
export function createDbContentStore(config: DbContentStoreConfig): ContentStore {
  return contentStoreFromDocumentRepository(createDbDocumentRepository(config));
}
