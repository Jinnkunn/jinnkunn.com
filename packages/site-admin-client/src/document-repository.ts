import {
  DocumentConflictError,
  DocumentOperationUnsupportedError,
  normalizeDocumentPath,
  type DocumentEntry,
  type DocumentRepository,
} from "@jinnkunn/document-repository";
import {
  isRecord,
  type NormalizedApiResponse,
} from "@jinnkunn/contracts/transport";
import { decodeDocumentLoad, decodeDocumentSave } from "./transport.ts";

export type SiteAdminDocumentRequest = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<NormalizedApiResponse>;

export type SiteAdminDocumentRepositoryOptions = {
  request: SiteAdminDocumentRequest;
};

export class RemoteDocumentRepositoryError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(input: { code: string; message: string; status: number }) {
    super(input.message);
    this.name = "RemoteDocumentRepositoryError";
    this.code = input.code;
    this.status = input.status;
  }
}

type RemoteDocumentKind = "posts" | "pages" | "components";

type RemotePath = {
  documentPath: string;
  kind: RemoteDocumentKind;
  slug: string;
  collectionRoute: string;
  itemRoute: string;
};

function encodeRoutePath(value: string): string {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function parseRemotePath(input: string): RemotePath {
  const documentPath = normalizeDocumentPath(input);
  const slash = documentPath.indexOf("/");
  const kind = documentPath.slice(0, slash) as RemoteDocumentKind;
  const fileName = slash >= 0 ? documentPath.slice(slash + 1) : "";
  const slug = fileName.replace(/\.mdx?$/i, "");
  if (
    !slug ||
    !/\.mdx?$/i.test(fileName) ||
    (kind !== "posts" && kind !== "pages" && kind !== "components") ||
    (kind !== "pages" && slug.includes("/"))
  ) {
    throw new DocumentOperationUnsupportedError(`remote path ${documentPath}`);
  }
  const collectionRoute = `/api/site-admin/${kind}`;
  return {
    documentPath,
    kind,
    slug,
    collectionRoute,
    itemRoute: `${collectionRoute}/${encodeRoutePath(slug)}`,
  };
}

function asRemoteError(response: Extract<NormalizedApiResponse, { ok: false }>): Error {
  return new RemoteDocumentRepositoryError({
    code: response.code,
    message: response.error,
    status: response.status,
  });
}

function throwWriteError(
  response: Extract<NormalizedApiResponse, { ok: false }>,
  expectedVersion: string | null,
): never {
  if (response.status === 409 || response.code === "SOURCE_CONFLICT") {
    throw new DocumentConflictError({
      expectedVersion,
      actualVersion: null,
    });
  }
  throw asRemoteError(response);
}

function getArray(data: unknown, key: string): unknown[] {
  if (!isRecord(data) || !Array.isArray(data[key])) return [];
  return data[key];
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function listedEntry(kind: "posts" | "pages", raw: unknown): DocumentEntry | null {
  if (!isRecord(raw)) return null;
  const slug = cleanString(raw.slug);
  const version = cleanString(raw.version);
  if (!slug || !version) return null;
  const date = cleanString(kind === "posts" ? raw.dateIso : raw.updatedIso);
  const updatedAt = date ? Date.parse(date) : Number.NaN;
  const path = `${kind}/${slug}.mdx`;
  return {
    name: `${slug.slice(slug.lastIndexOf("/") + 1)}.mdx`,
    path,
    version,
    // List endpoints intentionally return metadata, not complete source.
    // Consumers that need exact bytes can call stat/readText.
    size: 0,
    ...(Number.isFinite(updatedAt) ? { updatedAt } : {}),
  };
}

export function createSiteAdminDocumentRepository(
  options: SiteAdminDocumentRepositoryOptions,
): DocumentRepository {
  const { request } = options;

  async function readText(input: string) {
    const remote = parseRemotePath(input);
    const response = await request(remote.itemRoute, "GET");
    if (!response.ok) {
      if (response.status === 404 || response.code === "NOT_FOUND") return null;
      throw asRemoteError(response);
    }
    const decoded = decodeDocumentLoad(response.data);
    if (!decoded || !decoded.version) {
      throw new RemoteDocumentRepositoryError({
        code: "INVALID_DOCUMENT_RESPONSE",
        message: `Site Admin did not return source/version for ${remote.documentPath}.`,
        status: response.status,
      });
    }
    return {
      path: remote.documentPath,
      content: decoded.source,
      version: decoded.version,
    };
  }

  return {
    kind: "site-admin-api",

    async list(prefix) {
      const normalizedPrefix = normalizeDocumentPath(prefix);
      if (normalizedPrefix === "posts" || normalizedPrefix === "pages") {
        const response = await request(
          `/api/site-admin/${normalizedPrefix}?drafts=1`,
          "GET",
        );
        if (!response.ok) throw asRemoteError(response);
        return getArray(response.data, normalizedPrefix)
          .map((row) => listedEntry(normalizedPrefix, row))
          .filter((entry): entry is DocumentEntry => entry !== null)
          .sort((left, right) => left.path.localeCompare(right.path));
      }
      if (normalizedPrefix === "components") {
        const response = await request("/api/site-admin/components", "GET");
        if (!response.ok) throw asRemoteError(response);
        const definitions = getArray(response.data, "components");
        const paths = definitions
          .map((definition) =>
            isRecord(definition) ? cleanString(definition.contentRelPath) : "",
          )
          .filter(Boolean);
        const documents = await Promise.all(paths.map((documentPath) => readText(documentPath)));
        return documents
          .filter((document): document is NonNullable<typeof document> => document !== null)
          .map((document) => ({
            name: document.path.slice(document.path.lastIndexOf("/") + 1),
            path: document.path,
            version: document.version,
            size: new TextEncoder().encode(document.content).byteLength,
          }));
      }
      throw new DocumentOperationUnsupportedError(`list ${normalizedPrefix}`);
    },

    async stat(input) {
      const document = await readText(input);
      return document
        ? {
            exists: true,
            size: new TextEncoder().encode(document.content).byteLength,
            version: document.version,
          }
        : { exists: false };
    },

    readText,

    async readBinary() {
      throw new DocumentOperationUnsupportedError("remote readBinary");
    },

    async writeText(input, content, writeOptions) {
      const remote = parseRemotePath(input);
      const expected = writeOptions?.expectedVersion === ""
        ? null
        : writeOptions?.expectedVersion;
      if (expected === undefined) {
        throw new DocumentOperationUnsupportedError(
          "remote writeText without expectedVersion",
        );
      }

      let response: NormalizedApiResponse;
      if (expected === null) {
        if (remote.kind === "components") {
          throw new DocumentOperationUnsupportedError("remote component create");
        }
        response = await request(remote.collectionRoute, "POST", {
          slug: remote.slug,
          source: content,
        });
      } else {
        response = await request(remote.itemRoute, "PATCH", {
          source: content,
          version: expected,
        });
      }
      if (!response.ok) throwWriteError(response, expected);
      const saved = decodeDocumentSave(response.data);
      if (!saved.version) {
        throw new RemoteDocumentRepositoryError({
          code: "INVALID_DOCUMENT_RESPONSE",
          message: `Site Admin did not return a version for ${remote.documentPath}.`,
          status: response.status,
        });
      }
      return {
        path: remote.documentPath,
        version: saved.version,
        state: response.status === 202 ? "queued" : "committed",
      };
    },

    async writeBinary() {
      throw new DocumentOperationUnsupportedError("remote writeBinary");
    },

    async delete(input, writeOptions) {
      const remote = parseRemotePath(input);
      const expected = writeOptions?.expectedVersion;
      if (!expected) {
        throw new DocumentOperationUnsupportedError(
          "remote delete without expectedVersion",
        );
      }
      if (remote.kind === "components") {
        throw new DocumentOperationUnsupportedError("remote component delete");
      }
      const response = await request(remote.itemRoute, "DELETE", {
        version: expected,
      });
      if (!response.ok) throwWriteError(response, expected);
      return {
        path: remote.documentPath,
        version: expected,
        state: response.status === 202 ? "queued" : "committed",
      };
    },

    async listHistory(input, limit = 12) {
      const remote = parseRemotePath(input);
      const query = new URLSearchParams({
        path: `content/${remote.documentPath}`,
        limit: String(Math.max(1, Math.min(50, Math.floor(limit)))),
      });
      const response = await request(`/api/site-admin/versions?${query}`, "GET");
      if (!response.ok) throw asRemoteError(response);
      return getArray(response.data, "history")
        .map((raw) => {
          if (!isRecord(raw)) return null;
          const version = cleanString(raw.commitSha);
          if (!version) return null;
          return {
            version,
            shortVersion: cleanString(raw.commitShort) || version.slice(0, 7),
            createdAt: cleanString(raw.committedAt) || null,
            actor: cleanString(raw.authorName),
            message: cleanString(raw.message),
          };
        })
        .filter((revision): revision is NonNullable<typeof revision> => revision !== null);
    },

    async readRevision(input, version) {
      const remote = parseRemotePath(input);
      const query = new URLSearchParams({
        path: `content/${remote.documentPath}`,
        commitSha: version,
      });
      const response = await request(`/api/site-admin/versions?${query}`, "GET");
      if (!response.ok) {
        if (response.status === 404) return null;
        throw asRemoteError(response);
      }
      if (!isRecord(response.data) || !isRecord(response.data.version)) return null;
      const source = response.data.version;
      const content = typeof source.content === "string" ? source.content : "";
      const sha = cleanString(source.sha);
      return sha
        ? { path: remote.documentPath, content, version: sha }
        : null;
    },
  };
}
