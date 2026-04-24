// Asset upload/read over the generic ContentStore.
// v1 strategy: commit image assets to the repo under `public/uploads/<yyyy>/<mm>/<hash>.<ext>`
// so both dev (local fs) and prod (GitHub → CF static bundle) serve them via a
// stable `/uploads/<path>` URL without needing a runtime R2 binding.
// R2 direct serving can be added later as an optimization; the store interface
// won't need to change since only the URL prefix + backend swap.

import { createHash } from "node:crypto";

import {
  ContentStoreConflictError,
  type ContentStore,
} from "./content-store.ts";
import { getContentStore } from "./content-store-resolver.ts";

const UPLOADS_PREFIX = "public/uploads";
const PUBLIC_URL_PREFIX = "/uploads";

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

function sha256HexBytes(input: Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}

function datePrefix(): { year: string; month: string } {
  const d = new Date();
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
}): Promise<AssetUploadResult> {
  validateAssetInput({ contentType: input.contentType, data: input.data });
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

export async function deleteAsset(
  key: string,
  ifMatch: string,
  store?: ContentStore,
): Promise<void> {
  const backend = store ?? getContentStore();
  await backend.deleteFile(key, { ifMatch });
}
