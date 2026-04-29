// Lightweight runtime validators for site-admin API responses.
//
// We deliberately avoid pulling in a schema library (zod / valibot) — the
// workspace bundle already lives under tight Tauri webview budgets and
// the contract surface here is small. Each validator returns a typed
// "extracted" view of the response on success, or `null` on shape
// mismatch so the caller can fall through to a sensible default and log
// the discrepancy.
//
// Boundary discipline: every place that previously did
//   const data = (response.data ?? {}) as Record<string, unknown>
// should route through one of these helpers instead. That gives us a
// single grep target the day we DO want to swap in zod, and keeps
// schema drift visible at code-review time.

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export interface DocumentLoadPayload {
  source: string;
  version: string;
}

/**
 * Decode a `GET /<routeBase>/:slug` response. The server returns
 * `{ source, version, sourceVersion?: { fileSha } }`; we tolerate either
 * `version` or `sourceVersion.fileSha` since some adapters lean on one
 * vs. the other depending on whether D1 or Git is the source of truth.
 */
export function decodeDocumentLoad(data: unknown): DocumentLoadPayload | null {
  if (!isRecord(data)) return null;
  const source = asString(data.source);
  if (typeof source !== "string") return null;
  const directVersion = asString(data.version);
  if (directVersion) return { source, version: directVersion };
  const sourceVersion = isRecord(data.sourceVersion) ? data.sourceVersion : null;
  const fileSha = sourceVersion ? asString(sourceVersion.fileSha) : undefined;
  return { source, version: fileSha ?? "" };
}

export interface DocumentSavePayload {
  version: string;
  fileSha: string;
}

/**
 * Decode a `POST/PATCH` save response. Both fields are surfaced because
 * different adapters care about different identifiers (Git path takes
 * fileSha, D1 path takes version). Return value is "best-effort": empty
 * strings mean the field wasn't present and the caller should keep the
 * pre-save value.
 */
export function decodeDocumentSave(data: unknown): DocumentSavePayload {
  if (!isRecord(data)) return { version: "", fileSha: "" };
  const version = asString(data.version) ?? "";
  const sourceVersion = isRecord(data.sourceVersion) ? data.sourceVersion : null;
  const fileSha = sourceVersion ? asString(sourceVersion.fileSha) ?? "" : "";
  return { version, fileSha };
}

export interface PostListSnapshot {
  rows: unknown[];
}

/** Posts/Pages list endpoints return either `[…]` or `{ rows: [...] }`. */
export function decodeListSnapshot(data: unknown): PostListSnapshot | null {
  if (Array.isArray(data)) return { rows: data };
  if (!isRecord(data)) return null;
  if (Array.isArray(data.rows)) return { rows: data.rows };
  return null;
}
