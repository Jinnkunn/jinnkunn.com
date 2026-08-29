import { normalizeDocumentPath } from "./path.ts";

export type DocumentVersion = string;
export type DocumentCommitState = "committed" | "queued";

export type DocumentEntry = {
  name: string;
  path: string;
  version: DocumentVersion;
  size: number;
  updatedAt?: number;
};

export type DocumentStat = {
  exists: boolean;
  size?: number;
  updatedAt?: number;
  version?: DocumentVersion;
};

export type TextDocument = {
  path: string;
  content: string;
  version: DocumentVersion;
};

export type BinaryDocument = {
  path: string;
  data: Uint8Array;
  version: DocumentVersion;
};

export type DocumentWriteResult = {
  path: string;
  version: DocumentVersion;
  state: DocumentCommitState;
};

export type DocumentRevision = {
  version: DocumentVersion;
  shortVersion: string;
  createdAt: string | null;
  actor: string;
  message: string;
};

export type DocumentListOptions = {
  recursive?: boolean;
};

export type DocumentWriteOptions = {
  /**
   * `null` means the document must not exist. A string requires an exact
   * version match. `undefined` is an unconditional write.
   */
  expectedVersion?: DocumentVersion | null;
  message?: string;
};

export class DocumentConflictError extends Error {
  readonly code = "DOCUMENT_CONFLICT";
  readonly expectedVersion: DocumentVersion | null;
  readonly actualVersion: DocumentVersion | null;

  constructor(input: {
    expectedVersion: DocumentVersion | null;
    actualVersion: DocumentVersion | null;
  }) {
    super(
      `document repository: version mismatch (expected ${input.expectedVersion ?? "null"}, actual ${input.actualVersion ?? "null"})`,
    );
    this.name = "DocumentConflictError";
    this.expectedVersion = input.expectedVersion;
    this.actualVersion = input.actualVersion;
  }
}

export class DocumentNotFoundError extends Error {
  readonly code = "DOCUMENT_NOT_FOUND";
  readonly path: string;

  constructor(input: string) {
    const path = normalizeDocumentPath(input);
    super(`document repository: path not found: ${path}`);
    this.name = "DocumentNotFoundError";
    this.path = path;
  }
}

export class DocumentOperationUnsupportedError extends Error {
  readonly code = "DOCUMENT_OPERATION_UNSUPPORTED";
  readonly operation: string;

  constructor(operation: string) {
    super(`document repository: operation is not supported: ${operation}`);
    this.name = "DocumentOperationUnsupportedError";
    this.operation = operation;
  }
}

export function isDocumentConflictError(
  error: unknown,
): error is DocumentConflictError {
  return error instanceof DocumentConflictError;
}

export interface DocumentRepository {
  readonly kind: string;
  list(prefix: string, options?: DocumentListOptions): Promise<DocumentEntry[]>;
  stat(path: string): Promise<DocumentStat>;
  readText(path: string): Promise<TextDocument | null>;
  readBinary(path: string): Promise<BinaryDocument | null>;
  writeText(
    path: string,
    content: string,
    options?: DocumentWriteOptions,
  ): Promise<DocumentWriteResult>;
  writeBinary(
    path: string,
    data: Uint8Array,
    options?: DocumentWriteOptions,
  ): Promise<DocumentWriteResult>;
  delete(path: string, options?: DocumentWriteOptions): Promise<DocumentWriteResult>;
  listHistory(path: string, limit?: number): Promise<DocumentRevision[]>;
  readRevision(path: string, version: DocumentVersion): Promise<TextDocument | null>;
}
