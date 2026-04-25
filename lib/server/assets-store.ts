import { createHash } from "node:crypto";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import {
  ContentStoreConflictError,
  type ContentStore,
} from "./content-store.ts";
import { getContentStore } from "./content-store-resolver.ts";

const UPLOADS_PREFIX = "public/uploads";
const PUBLIC_URL_PREFIX = "/uploads";
const R2_UPLOADS_PREFIX = "uploads";
const DEFAULT_MEDIA_PUBLIC_BASE_URL = "https://cdn.jinkunchen.com";
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

// Keep conservative: images only for v1. Widen later if needed.
const ALLOWED_MIME_TYPES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/avif",
]);

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

const MAX_BYTES = 5 * 1024 * 1024; // 5MB

export class AssetsValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "AssetsValidationError";
    this.field = field;
  }
}

export type AssetUploadResult = {
  key: string; // storage path, relative to repo root
  url: string; // public URL
  size: number; // bytes
  contentType: string;
  sha: string; // ContentStore version
};

export type AssetListItem = AssetUploadResult & {
  filename: string;
  uploadedAt: string | null;
};

type R2ObjectLike = {
  key: string;
  size?: number;
  uploaded?: Date | string;
  httpEtag?: string;
  etag?: string;
  customMetadata?: Record<string, string>;
  httpMetadata?: {
    contentType?: string;
    cacheControl?: string;
  };
};

type R2ListResultLike = {
  objects: R2ObjectLike[];
  truncated?: boolean;
  cursor?: string;
};

type R2PutOptionsLike = {
  httpMetadata?: {
    contentType?: string;
    cacheControl?: string;
  };
  customMetadata?: Record<string, string>;
};

export type R2BucketLike = {
  head(key: string): Promise<R2ObjectLike | null>;
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: R2PutOptionsLike,
  ): Promise<R2ObjectLike>;
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<R2ListResultLike>;
  delete(key: string): Promise<void>;
};

type AssetBackendOptions = {
  store?: ContentStore;
  bucket?: R2BucketLike | null;
  publicBaseUrl?: string;
};

function sha256HexBytes(input: Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}

function datePrefix(date = new Date()): { year: string; month: string } {
  const d = date;
  return { year: String(d.getUTCFullYear()), month: two(d.getUTCMonth() + 1) };
}

function chooseExtension(mime: string, filename?: string): string {
  const fromMime = EXTENSION_BY_MIME[mime];
  if (fromMime) return fromMime;
  if (filename) {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext && /^[a-z0-9]{1,8}$/.test(ext)) return ext;
  }
  return "bin";
}

function mimeFromKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() || "";
  for (const [mime, knownExt] of Object.entries(EXTENSION_BY_MIME)) {
    if (knownExt === ext) return mime;
  }
  return "application/octet-stream";
}

function publicUrlFromKey(key: string): string {
  return key.replace(UPLOADS_PREFIX, PUBLIC_URL_PREFIX);
}

function normalizePublicBaseUrl(raw?: string): string {
  const value = String(raw || process.env.MEDIA_PUBLIC_BASE_URL || DEFAULT_MEDIA_PUBLIC_BASE_URL)
    .trim()
    .replace(/\/+$/, "");
  return value || DEFAULT_MEDIA_PUBLIC_BASE_URL;
}

function publicR2UrlFromKey(key: string, publicBaseUrl?: string): string {
  return `${normalizePublicBaseUrl(publicBaseUrl)}/${key.replace(/^\/+/, "")}`;
}

function uploadedAtFromKey(key: string): string | null {
  const match = /^public\/uploads\/(\d{4})\/(\d{2})\//.exec(key);
  if (!match) return null;
  return `${match[1]}-${match[2]}-01T00:00:00.000Z`;
}

function validateAssetKey(key: string): string {
  const normalized = key.replace(/^\/+/, "");
  if (
    !normalized.startsWith(`${UPLOADS_PREFIX}/`) ||
    normalized.includes("..") ||
    normalized.endsWith("/")
  ) {
    throw new AssetsValidationError("key", "invalid asset key");
  }
  return normalized;
}

function validateR2AssetKey(key: string): string {
  const normalized = key.replace(/^\/+/, "");
  if (
    !normalized.startsWith(`${R2_UPLOADS_PREFIX}/`) ||
    normalized.includes("..") ||
    normalized.endsWith("/")
  ) {
    throw new AssetsValidationError("key", "invalid asset key");
  }
  return normalized;
}

function assetHashFromR2Key(key: string): string {
  const file = key.split("/").pop() || "";
  const hash = file.split(".")[0] || "";
  if (!/^[a-f0-9]{16,64}$/.test(hash)) {
    throw new AssetsValidationError("key", "invalid asset key");
  }
  return hash;
}

function isR2BucketLike(value: unknown): value is R2BucketLike {
  if (!value || typeof value !== "object") return false;
  const bucket = value as Partial<Record<keyof R2BucketLike, unknown>>;
  return (
    typeof bucket.head === "function" &&
    typeof bucket.put === "function" &&
    typeof bucket.list === "function" &&
    typeof bucket.delete === "function"
  );
}

function boundR2Bucket(): R2BucketLike | null {
  if (String(process.env.SITE_ADMIN_ASSET_BACKEND || "").trim() === "content") {
    return null;
  }
  try {
    const { env } = getCloudflareContext();
    const bucket = (env as Record<string, unknown>).SITE_ASSETS;
    return isR2BucketLike(bucket) ? bucket : null;
  } catch {
    return null;
  }
}

function resolveR2Bucket(options?: AssetBackendOptions): R2BucketLike | null {
  if (options?.store) return null;
  if (options?.bucket !== undefined) return options.bucket;
  return boundR2Bucket();
}

function r2UploadedAt(object: R2ObjectLike): string | null {
  const uploaded = object.uploaded;
  if (!uploaded) return null;
  if (uploaded instanceof Date) return uploaded.toISOString();
  const date = new Date(uploaded);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function r2AssetFromObject(
  object: R2ObjectLike,
  publicBaseUrl?: string,
): AssetListItem {
  const metadata = object.customMetadata || {};
  const sha = metadata.sha256 || assetHashFromR2Key(object.key);
  return {
    key: object.key,
    url: publicR2UrlFromKey(object.key, publicBaseUrl),
    filename: metadata.filename || object.key.split("/").pop() || object.key,
    size: object.size || 0,
    contentType: metadata.contentType || object.httpMetadata?.contentType || mimeFromKey(object.key),
    sha,
    uploadedAt: r2UploadedAt(object),
  };
}

async function uploadR2Asset(input: {
  filename?: string;
  contentType: string;
  data: Uint8Array;
  bucket: R2BucketLike;
  publicBaseUrl?: string;
}): Promise<AssetUploadResult> {
  const { year, month } = datePrefix();
  const hash = sha256HexBytes(input.data);
  const extension = chooseExtension(input.contentType, input.filename);
  const key = `${R2_UPLOADS_PREFIX}/${year}/${month}/${hash}.${extension}`;
  const existing = await input.bucket.head(key);
  if (existing) return r2AssetFromObject(existing, input.publicBaseUrl);

  const uploaded = await input.bucket.put(key, input.data, {
    httpMetadata: {
      contentType: input.contentType,
      cacheControl: IMMUTABLE_CACHE_CONTROL,
    },
    customMetadata: {
      sha256: hash,
      contentType: input.contentType,
      filename: input.filename || "",
    },
  });
  return {
    key,
    url: publicR2UrlFromKey(key, input.publicBaseUrl),
    size: input.data.byteLength,
    contentType: input.contentType,
    sha: uploaded.customMetadata?.sha256 || hash,
  };
}

async function listR2Assets(input: {
  bucket: R2BucketLike;
  publicBaseUrl?: string;
}): Promise<AssetListItem[]> {
  const objects: R2ObjectLike[] = [];
  let cursor: string | undefined;
  do {
    const page = await input.bucket.list({
      prefix: `${R2_UPLOADS_PREFIX}/`,
      cursor,
      limit: 1000,
    });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return objects
    .map((object) => r2AssetFromObject(object, input.publicBaseUrl))
    .sort((a, b) => b.key.localeCompare(a.key));
}

async function deleteR2Asset(
  key: string,
  ifMatch: string,
  bucket: R2BucketLike,
): Promise<void> {
  const normalized = validateR2AssetKey(key);
  const expectedVersion = assetHashFromR2Key(normalized);
  if (ifMatch !== expectedVersion) {
    throw new AssetsValidationError("version", "asset version mismatch");
  }
  const existing = await bucket.head(normalized);
  if (!existing) {
    throw new AssetsValidationError("key", "asset not found");
  }
  await bucket.delete(normalized);
}

function normalizeDeleteOptions(
  input?: ContentStore | AssetBackendOptions,
): AssetBackendOptions {
  if (!input) return {};
  const maybeStore = input as Partial<ContentStore>;
  if (typeof maybeStore.deleteFile === "function") {
    return { store: input as ContentStore };
  }
  return input as AssetBackendOptions;
}

export function validateAssetInput(input: {
  contentType: string;
  data: Uint8Array;
}): void {
  if (!ALLOWED_MIME_TYPES.has(input.contentType)) {
    throw new AssetsValidationError(
      "contentType",
      `content type not allowed: ${input.contentType}`,
    );
  }
  if (input.data.byteLength === 0) {
    throw new AssetsValidationError("data", "empty upload");
  }
  if (input.data.byteLength > MAX_BYTES) {
    throw new AssetsValidationError(
      "data",
      `upload exceeds ${MAX_BYTES} byte limit (${input.data.byteLength} bytes)`,
    );
  }
}

export async function uploadAsset(input: {
  filename?: string;
  contentType: string;
  data: Uint8Array;
  store?: ContentStore;
  bucket?: R2BucketLike | null;
  publicBaseUrl?: string;
}): Promise<AssetUploadResult> {
  validateAssetInput({ contentType: input.contentType, data: input.data });
  const bucket = resolveR2Bucket(input);
  if (bucket) {
    return uploadR2Asset({
      filename: input.filename,
      contentType: input.contentType,
      data: input.data,
      bucket,
      publicBaseUrl: input.publicBaseUrl,
    });
  }

  const store = input.store ?? getContentStore();
  const { year, month } = datePrefix();
  const hash = sha256HexBytes(input.data).slice(0, 16);
  const extension = chooseExtension(input.contentType, input.filename);
  const relPath = `${UPLOADS_PREFIX}/${year}/${month}/${hash}.${extension}`;
  const publicUrl = `${PUBLIC_URL_PREFIX}/${year}/${month}/${hash}.${extension}`;

  // Idempotent on content hash: if a file with the same hashed name already
  // exists, treat this upload as a no-op success (same URL).
  try {
    const { sha } = await store.writeBinary(relPath, input.data, { ifMatch: null });
    return {
      key: relPath,
      url: publicUrl,
      size: input.data.byteLength,
      contentType: input.contentType,
      sha,
    };
  } catch (err) {
    if (err instanceof ContentStoreConflictError) {
      // File already exists — content-hash dedupe: return the existing URL.
      const existing = await store.readBinary(relPath);
      if (!existing) throw err;
      return {
        key: relPath,
        url: publicUrl,
        size: input.data.byteLength,
        contentType: input.contentType,
        sha: existing.sha,
      };
    }
    throw err;
  }
}

export async function listAssets(input?: {
  store?: ContentStore;
  bucket?: R2BucketLike | null;
  publicBaseUrl?: string;
}): Promise<AssetListItem[]> {
  const bucket = resolveR2Bucket(input);
  if (bucket) {
    return listR2Assets({ bucket, publicBaseUrl: input?.publicBaseUrl });
  }

  const store = input?.store ?? getContentStore();
  const entries = await store.listFiles(UPLOADS_PREFIX, { recursive: true });
  return entries
    .filter((entry) => entry.relPath.startsWith(`${UPLOADS_PREFIX}/`))
    .map((entry) => ({
      key: entry.relPath,
      url: publicUrlFromKey(entry.relPath),
      filename: entry.name,
      size: entry.size,
      contentType: mimeFromKey(entry.relPath),
      sha: entry.sha,
      uploadedAt: uploadedAtFromKey(entry.relPath),
    }))
    .sort((a, b) => b.key.localeCompare(a.key));
}

export async function deleteAsset(
  key: string,
  ifMatch: string,
  input?: ContentStore | AssetBackendOptions,
): Promise<void> {
  const options = normalizeDeleteOptions(input);
  const bucket = resolveR2Bucket(options);
  if (bucket) {
    await deleteR2Asset(key, ifMatch, bucket);
    return;
  }

  const backend = options.store ?? getContentStore();
  await backend.deleteFile(validateAssetKey(key), { ifMatch });
}
