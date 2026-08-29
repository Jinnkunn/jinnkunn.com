// Compatibility facade for callers that still use the historical ContentStore
// vocabulary. New storage code should depend on DocumentRepository directly.

import path from "node:path";

import {
  DocumentConflictError,
  DocumentNotFoundError,
  type DocumentRepository,
  type DocumentVersion,
} from "@jinnkunn/document-repository";
import { createLocalDocumentRepository } from "./document-repository-local.ts";

export type ContentVersion = DocumentVersion;

export class ContentStoreConflictError extends DocumentConflictError {
  readonly expected: ContentVersion | null;
  readonly actual: ContentVersion | null;

  constructor(input: { expected: ContentVersion | null; actual: ContentVersion | null }) {
    super({ expectedVersion: input.expected, actualVersion: input.actual });
    this.name = "ContentStoreConflictError";
    this.expected = input.expected;
    this.actual = input.actual;
  }
}

export class ContentStoreNotFoundError extends DocumentNotFoundError {
  readonly relPath: string;

  constructor(relPath: string) {
    super(relPath);
    this.name = "ContentStoreNotFoundError";
    this.relPath = this.path;
  }
}

export type ContentEntry = {
  name: string;
  relPath: string;
  sha: ContentVersion;
  size: number;
};

export interface ContentStore {
  listFiles(dirRel: string, opts?: { recursive?: boolean }): Promise<ContentEntry[]>;
  readFile(relPath: string): Promise<{ content: string; sha: ContentVersion } | null>;
  writeFile(
    relPath: string,
    content: string,
    opts?: { ifMatch?: ContentVersion | null; commitMessage?: string },
  ): Promise<{ sha: ContentVersion }>;
  writeBinary(
    relPath: string,
    data: Uint8Array,
    opts?: { ifMatch?: ContentVersion | null; commitMessage?: string },
  ): Promise<{ sha: ContentVersion }>;
  readBinary(relPath: string): Promise<{ data: Uint8Array; sha: ContentVersion } | null>;
  deleteFile(
    relPath: string,
    opts?: { ifMatch?: ContentVersion | null; commitMessage?: string },
  ): Promise<void>;
}

function toContentStoreError(error: unknown): never {
  if (error instanceof DocumentConflictError) {
    throw new ContentStoreConflictError({
      expected: error.expectedVersion,
      actual: error.actualVersion,
    });
  }
  if (error instanceof DocumentNotFoundError) {
    throw new ContentStoreNotFoundError(error.path);
  }
  throw error;
}

/** Adapt the canonical repository to the legacy ContentStore method names. */
export function contentStoreFromDocumentRepository(
  repository: DocumentRepository,
): ContentStore {
  return {
    async listFiles(dirRel, opts) {
      const entries = await repository.list(dirRel, opts);
      return entries.map((entry) => ({
        name: entry.name,
        relPath: entry.path,
        sha: entry.version,
        size: entry.size,
      }));
    },

    async readFile(relPath) {
      const document = await repository.readText(relPath);
      return document ? { content: document.content, sha: document.version } : null;
    },

    async writeFile(relPath, content, opts) {
      try {
        const result = await repository.writeText(relPath, content, {
          expectedVersion: opts?.ifMatch,
          message: opts?.commitMessage,
        });
        return { sha: result.version };
      } catch (error) {
        return toContentStoreError(error);
      }
    },

    async writeBinary(relPath, data, opts) {
      try {
        const result = await repository.writeBinary(relPath, data, {
          expectedVersion: opts?.ifMatch,
          message: opts?.commitMessage,
        });
        return { sha: result.version };
      } catch (error) {
        return toContentStoreError(error);
      }
    },

    async readBinary(relPath) {
      const document = await repository.readBinary(relPath);
      return document ? { data: document.data, sha: document.version } : null;
    },

    async deleteFile(relPath, opts) {
      try {
        await repository.delete(relPath, {
          expectedVersion: opts?.ifMatch,
          message: opts?.commitMessage,
        });
      } catch (error) {
        return toContentStoreError(error);
      }
    },
  };
}

export function createLocalContentStore(opts?: { rootDir?: string }): ContentStore {
  const rootDir = opts?.rootDir ?? path.join(process.cwd(), "content");
  return contentStoreFromDocumentRepository(
    createLocalDocumentRepository({ rootDir }),
  );
}
