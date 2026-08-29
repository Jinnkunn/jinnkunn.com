// Compatibility adapter for SiteAdminSourceStore. Filesystem and D1 storage
// are implemented once through DocumentRepository; this module only maps the
// historical repo-root paths and response vocabulary.

import path from "node:path";

import {
  DocumentConflictError,
  normalizeDocumentPath,
  toContentDocumentPath,
  type DocumentRepository,
} from "@jinnkunn/document-repository";
import {
  createDbDocumentRepository,
  type DbExecutor,
} from "./db-content-store.ts";
import { createLocalDocumentRepository } from "./document-repository-local.ts";

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
  statFile(repoRel: string): Promise<SiteAdminFileStat>;
  readJsonFile(repoRel: string): Promise<unknown | null>;
  writeJsonFile(repoRel: string, value: unknown): Promise<void>;
  readTextFile(repoRel: string): Promise<{ content: string; sha: string } | null>;
  writeTextFile(input: {
    repoRel: string;
    content: string;
    expectedSha?: string;
  }): Promise<{ fileSha: string; commitSha: string }>;
  listTextFileHistory(
    repoRel: string,
    limit: number,
  ): Promise<SiteAdminFileHistoryEntry[]>;
  readTextFileAtCommit(
    repoRel: string,
    commitSha: string,
  ): Promise<{ content: string; sha: string; commitSha: string } | null>;
}

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
  error: unknown,
): error is SiteAdminFileBackendConflictError {
  return error instanceof SiteAdminFileBackendConflictError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    out[key] = sortJson(value[key]);
  }
  return out;
}

function documentPath(repoRel: string, backendLabel: string): string {
  const normalized = normalizeDocumentPath(repoRel);
  if (!normalized.startsWith("content/")) {
    throw new Error(`${backendLabel}: path must be under content/: ${repoRel}`);
  }
  return toContentDocumentPath(normalized);
}

function expectedVersion(expectedSha: string | undefined): string | null | undefined {
  if (expectedSha === undefined) return undefined;
  return expectedSha === "" ? null : expectedSha;
}

function translateConflict(error: unknown, fallbackExpected = ""): never {
  if (error instanceof DocumentConflictError) {
    throw new SiteAdminFileBackendConflictError({
      expectedSha: error.expectedVersion ?? fallbackExpected,
      currentSha: error.actualVersion ?? "",
    });
  }
  throw error;
}

export function siteAdminFileBackendFromDocumentRepository(
  repository: DocumentRepository,
): SiteAdminFileBackend {
  const isDb = repository.kind === "d1" || repository.kind === "db";
  const backendLabel = isDb ? "db file backend" : "fs file backend";
  return {
    kind: isDb ? "db" : "fs",

    async statFile(repoRel) {
      const stat = await repository.stat(documentPath(repoRel, backendLabel));
      return {
        exists: stat.exists,
        ...(stat.size !== undefined ? { size: stat.size } : {}),
        ...(stat.updatedAt !== undefined ? { mtimeMs: stat.updatedAt } : {}),
      };
    },

    async readJsonFile(repoRel) {
      const document = await repository.readText(documentPath(repoRel, backendLabel));
      if (!document) return null;
      try {
        return JSON.parse(document.content);
      } catch {
        return null;
      }
    },

    async writeJsonFile(repoRel, value) {
      const content = `${JSON.stringify(sortJson(value), null, 2)}\n`;
      await repository.writeText(documentPath(repoRel, backendLabel), content);
    },

    async readTextFile(repoRel) {
      const document = await repository.readText(documentPath(repoRel, backendLabel));
      return document
        ? { content: document.content, sha: document.version }
        : null;
    },

    async writeTextFile(input) {
      try {
        const result = await repository.writeText(
          documentPath(input.repoRel, backendLabel),
          input.content,
          { expectedVersion: expectedVersion(input.expectedSha) },
        );
        return { fileSha: result.version, commitSha: result.version };
      } catch (error) {
        return translateConflict(error, input.expectedSha ?? "");
      }
    },

    async listTextFileHistory(repoRel, limit) {
      const revisions = await repository.listHistory(
        documentPath(repoRel, backendLabel),
        limit,
      );
      return revisions.map((revision) => ({
        commitSha: revision.version,
        commitShort: revision.shortVersion,
        committedAt: revision.createdAt,
        authorName: revision.actor,
        message: revision.message,
      }));
    },

    async readTextFileAtCommit(repoRel, commitSha) {
      const document = await repository.readRevision(
        documentPath(repoRel, backendLabel),
        commitSha,
      );
      return document
        ? {
            content: document.content,
            sha: document.version,
            commitSha,
          }
        : null;
    },
  };
}

export type FsFileBackendConfig = { rootDir: string };

export function createFsFileBackend(
  config: FsFileBackendConfig,
): SiteAdminFileBackend {
  return siteAdminFileBackendFromDocumentRepository(
    createLocalDocumentRepository({
      rootDir: path.join(config.rootDir, "content"),
      gitRootDir: config.rootDir,
      gitPathPrefix: "content",
    }),
  );
}

export type DbFileBackendConfig = {
  executor: DbExecutor;
  getActor?: () => string | null | undefined;
};

export function createDbFileBackend(
  config: DbFileBackendConfig,
): SiteAdminFileBackend {
  return siteAdminFileBackendFromDocumentRepository(
    createDbDocumentRepository(config),
  );
}
