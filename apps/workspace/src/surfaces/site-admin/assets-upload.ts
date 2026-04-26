// Drag-drop image upload helper for the editor body.
// Reads the File as base64 and POSTs to /api/site-admin/assets. Returns the
// public URL so the caller can insert a markdown image tag at the cursor.

import type { SiteAdminRequestResult } from "./api";
import type { AssetUploadResponse } from "./types";
import { normalizeString } from "./utils";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_FILE_UPLOAD_BYTES = 25 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/avif",
]);

// Generic-file upload allowlist (audio, video, archives, common docs). Image
// uploads still go through `uploadImageFile` for the stricter alt-text flow.
export const ALLOWED_FILE_TYPES = new Set<string>([
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
  "application/json",
  "application/x-tar",
  "application/gzip",
  "application/octet-stream",
  "text/plain",
  "text/csv",
  "text/markdown",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

type RequestFn = (
  path: string,
  method: string,
  body?: unknown,
) => Promise<SiteAdminRequestResult["response"]>;

export interface UploadImageFileInput {
  file: File;
  request: RequestFn;
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  // btoa needs binary string; use chunked loop to avoid stack issues on larger files.
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export type UploadImageResult =
  | { ok: true; asset: AssetUploadResponse; filename: string }
  | { ok: false; error: string };

export async function uploadImageFile(
  input: UploadImageFileInput,
): Promise<UploadImageResult> {
  const { file, request } = input;
  const contentType = normalizeString(file.type) || "image/png";
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    return { ok: false, error: `unsupported file type: ${contentType}` };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `file too large (>${MAX_UPLOAD_BYTES} bytes)` };
  }
  let base64 = "";
  try {
    base64 = await fileToBase64(file);
  } catch (err) {
    return { ok: false, error: `could not read file: ${String(err)}` };
  }
  const response = await request("/api/site-admin/assets", "POST", {
    filename: file.name,
    contentType,
    base64,
  });
  if (!response.ok) {
    return { ok: false, error: `${response.code}: ${response.error}` };
  }
  const data = response.data as Record<string, unknown>;
  const asset: AssetUploadResponse = {
    key: normalizeString(data.key),
    url: normalizeString(data.url),
    size: typeof data.size === "number" ? data.size : 0,
    contentType: normalizeString(data.contentType) || contentType,
    version: normalizeString(data.version),
  };
  if (!asset.url) return { ok: false, error: "upload response missing url" };
  return { ok: true, asset, filename: file.name };
}

// Generic-file uploader for the File block. Mirrors uploadImageFile but
// targets the broader ALLOWED_FILE_TYPES allowlist and a larger size cap.
export async function uploadGenericFile(
  input: UploadImageFileInput,
): Promise<UploadImageResult> {
  const { file, request } = input;
  const contentType = normalizeString(file.type) || "application/octet-stream";
  if (!ALLOWED_FILE_TYPES.has(contentType)) {
    return { ok: false, error: `unsupported file type: ${contentType}` };
  }
  if (file.size > MAX_FILE_UPLOAD_BYTES) {
    return { ok: false, error: `file too large (>${MAX_FILE_UPLOAD_BYTES} bytes)` };
  }
  let base64 = "";
  try {
    base64 = await fileToBase64(file);
  } catch (err) {
    return { ok: false, error: `could not read file: ${String(err)}` };
  }
  const response = await request("/api/site-admin/assets", "POST", {
    filename: file.name,
    contentType,
    base64,
  });
  if (!response.ok) {
    return { ok: false, error: `${response.code}: ${response.error}` };
  }
  const data = response.data as Record<string, unknown>;
  const asset: AssetUploadResponse = {
    key: normalizeString(data.key),
    url: normalizeString(data.url),
    size: typeof data.size === "number" ? data.size : 0,
    contentType: normalizeString(data.contentType) || contentType,
    version: normalizeString(data.version),
  };
  if (!asset.url) return { ok: false, error: "upload response missing url" };
  return { ok: true, asset, filename: file.name };
}

export interface MarkdownInsertTarget {
  insertAtCursor(snippet: string): void;
}

/** Insert a markdown image tag into any target that supports insertAtCursor. */
export function insertMarkdownImage(
  target: MarkdownInsertTarget,
  url: string,
  alt: string,
): void {
  target.insertAtCursor(`![${alt}](${url})`);
}
