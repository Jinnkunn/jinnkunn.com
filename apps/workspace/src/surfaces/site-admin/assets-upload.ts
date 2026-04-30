// Drag-drop image / file upload helper for the editor body. Reads the
// File as base64 and hands it to a `WorkspaceAssetUploader` provided by
// the host surface (site-admin → R2 cloud, Notes → local note-asset
// protocol, future surfaces → whatever fits). Validation (mime allowlist,
// size cap) lives here so every consumer enforces the same rules.

import type {
  WorkspaceAssetUploader,
  WorkspaceEditorRequest,
} from "../../ui/editor-runtime";
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

export interface UploadImageFileInput {
  file: File;
  /** Typed uploader from `WorkspaceEditorRuntime`. Preferred. */
  uploadAsset?: WorkspaceAssetUploader;
  /** Legacy path-based escape hatch — used when `uploadAsset` isn't
   * provided. Kept so existing site-admin call sites that already plumb
   * a `request` keep working without immediate migration. */
  request?: WorkspaceEditorRequest;
}

function fileToBase64(file: File): Promise<string> {
  // FileReader.readAsDataURL is async and runs the encode off the main JS
  // thread (browser-internal) — for a 5 MB image this is the difference
  // between a 200-500 ms UI freeze and an imperceptible await. We strip
  // the `data:<mime>;base64,` prefix and return just the encoded body so
  // callers downstream don't need to know which path produced the string.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader did not return a string"));
        return;
      }
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

export type UploadImageResult =
  | { ok: true; asset: AssetUploadResponse; filename: string }
  | { ok: false; error: string };

// Pick the runtime uploader if provided, else fall back to a path-based
// `request("/api/site-admin/assets", "POST", { … })`. New surfaces should
// always pass `uploadAsset` so the site-admin path string isn't a shared
// dependency.
async function dispatchUpload(
  input: UploadImageFileInput,
  body: { filename: string; contentType: string; base64: string },
): Promise<UploadImageResult> {
  if (input.uploadAsset) {
    const result = await input.uploadAsset(body);
    if (!result.ok) {
      return { ok: false, error: `${result.code}: ${result.error}` };
    }
    if (!result.asset.url) return { ok: false, error: "upload response missing url" };
    return { ok: true, asset: result.asset, filename: input.file.name };
  }
  if (input.request) {
    const response = await input.request("/api/site-admin/assets", "POST", body);
    if (!response.ok) {
      return { ok: false, error: `${response.code}: ${response.error}` };
    }
    const data = response.data as Record<string, unknown>;
    const asset: AssetUploadResponse = {
      key: normalizeString(data.key),
      url: normalizeString(data.url),
      size: typeof data.size === "number" ? data.size : 0,
      contentType: normalizeString(data.contentType) || body.contentType,
      version: normalizeString(data.version),
    };
    if (!asset.url) return { ok: false, error: "upload response missing url" };
    return { ok: true, asset, filename: input.file.name };
  }
  return {
    ok: false,
    error: "editor runtime does not support uploads (no uploadAsset / request)",
  };
}

export async function uploadImageFile(
  input: UploadImageFileInput,
): Promise<UploadImageResult> {
  const { file } = input;
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
  return dispatchUpload(input, {
    filename: file.name,
    contentType,
    base64,
  });
}

// Generic-file uploader for the File block. Mirrors uploadImageFile but
// targets the broader ALLOWED_FILE_TYPES allowlist and a larger size cap.
export async function uploadGenericFile(
  input: UploadImageFileInput,
): Promise<UploadImageResult> {
  const { file } = input;
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
  return dispatchUpload(input, {
    filename: file.name,
    contentType,
    base64,
  });
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
