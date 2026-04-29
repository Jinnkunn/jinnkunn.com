import type { NormalizedApiResponse } from "./types";

/**
 * Categorize a failed `NormalizedApiResponse` so the editor surfaces a
 * specific recovery hint instead of the raw "code: error" string.
 *
 * The bucket also drives the message banner kind (`warn` vs `error`) and
 * lets callers branch UX (e.g. show a Reload button for conflicts, hide
 * the save button for read-only).
 */
export type SiteAdminErrorCategory =
  | "auth"
  | "conflict"
  | "validation"
  | "rate_limit"
  | "read_only"
  | "network"
  | "server"
  | "unknown";

export interface SiteAdminErrorInfo {
  category: SiteAdminErrorCategory;
  /** Single-sentence message suitable for the global banner. */
  banner: string;
  /** Longer detail for the in-editor error pane. May reference the raw code. */
  detail: string;
  /** Whether retrying the same request is likely to succeed. Editor uses
   * this to decide whether to gate or auto-retry. */
  retryable: boolean;
}

const KNOWN_AUTH_CODES = new Set([
  "UNAUTHORIZED",
  "MISSING_AUTH",
  "TOKEN_EXPIRED",
  "FORBIDDEN",
]);
const KNOWN_CONFLICT_CODES = new Set([
  "SOURCE_CONFLICT",
  "VERSION_CONFLICT",
]);
const KNOWN_VALIDATION_CODES = new Set([
  "INVALID_PAYLOAD",
  "INVALID_REQUEST",
  "VALIDATION_FAILED",
  "INVALID_ENVELOPE",
  "INVALID_RESPONSE",
]);
const KNOWN_NETWORK_CODES = new Set([
  "TAURI_INVOKE_ERROR",
  "MISSING_BASE_URL",
]);
const KNOWN_RATE_LIMIT_CODES = new Set([
  "RATE_LIMITED",
  "TOO_MANY_REQUESTS",
]);

const NETWORK_HINT_PATTERN =
  /timeout|timed out|network|fetch|disconnected|ECONN|ENOTFOUND/i;

/**
 * Classify a failed response. Always called on the failure path — for
 * `response.ok === true` use a separate code path.
 */
export function classifySiteAdminError(
  response: NormalizedApiResponse,
  context: { action: string; subject?: string } = { action: "Request" },
): SiteAdminErrorInfo {
  if (response.ok) {
    return {
      category: "unknown",
      banner: `${context.action} succeeded.`,
      detail: "",
      retryable: false,
    };
  }
  const code = response.code || "UNKNOWN";
  const subject = context.subject ?? "the document";
  const status = response.status ?? 0;

  if (code === "PRODUCTION_READ_ONLY") {
    return {
      category: "read_only",
      banner:
        "This connection is in read-only mode. Switch to Staging or Local to save.",
      detail: "Production saves are disabled. Use the connection menu to switch profiles.",
      retryable: false,
    };
  }

  if (KNOWN_CONFLICT_CODES.has(code) || status === 409) {
    return {
      category: "conflict",
      banner: `${subject} changed remotely. Reload the latest content before retrying.`,
      detail:
        "The server's copy is newer than yours. Saving now would overwrite remote changes.",
      retryable: false,
    };
  }

  if (KNOWN_AUTH_CODES.has(code) || status === 401 || status === 403) {
    return {
      category: "auth",
      banner:
        status === 403
          ? "Your account doesn't have permission for this action."
          : "Sign-in expired. Sign in again to continue.",
      detail:
        "The site-admin API rejected the request as unauthorized. The next request will trigger a fresh sign-in flow.",
      retryable: true,
    };
  }

  if (KNOWN_RATE_LIMIT_CODES.has(code) || status === 429) {
    return {
      category: "rate_limit",
      banner: "Too many requests in a short window. Wait a moment and try again.",
      detail: response.error || "Rate-limited by the API.",
      retryable: true,
    };
  }

  if (KNOWN_VALIDATION_CODES.has(code) || (status >= 400 && status < 500)) {
    return {
      category: "validation",
      banner: `${context.action} rejected: ${response.error || code}`,
      detail: `${code}: ${response.error || "(no detail)"}`,
      retryable: false,
    };
  }

  if (KNOWN_NETWORK_CODES.has(code) || NETWORK_HINT_PATTERN.test(response.error || "")) {
    return {
      category: "network",
      banner: "Couldn't reach the API. Check your connection and try again.",
      detail: response.error || "Network or backend unreachable.",
      retryable: true,
    };
  }

  if (status >= 500) {
    return {
      category: "server",
      banner: "The server returned an error. Wait a moment and try again.",
      detail: `${code}: ${response.error || "(no detail)"}`,
      retryable: true,
    };
  }

  return {
    category: "unknown",
    banner: `${context.action} failed: ${response.error || code}`,
    detail: `${code}: ${response.error || "(no detail)"}`,
    retryable: false,
  };
}

export function isAuthError(response: NormalizedApiResponse): boolean {
  if (response.ok) return false;
  return classifySiteAdminError(response).category === "auth";
}

export function isConflictError(response: NormalizedApiResponse): boolean {
  if (response.ok) return false;
  return classifySiteAdminError(response).category === "conflict";
}

export function isNetworkError(response: NormalizedApiResponse): boolean {
  if (response.ok) return false;
  return classifySiteAdminError(response).category === "network";
}
