import { siteAdminHttpRequest } from "../../modules/site-admin/tauri";
import { normalizeTauriApiResponse } from "@jinnkunn/site-admin-client/transport";
import type { NormalizedApiResponse } from "./types";
import { normalizeString } from "./utils";

export const normalizeApiResponse = normalizeTauriApiResponse;

/** The Rust host allowlist (`is_trusted_admin_host`) rejects a credentialed
 * call to an untrusted base URL by returning an `Err`, which surfaces here as
 * a thrown invoke error. That is a refusal, not a network failure — callers
 * must not mistake it for "offline" and queue the request into the write
 * outbox, which would replay the same credentials at the same bad host. */
export function isUntrustedHostRejection(message: string): boolean {
  return /refusing to (send|queue\/replay) Site Admin credentials/i.test(
    message,
  );
}

export interface SiteAdminRequestInput {
  baseUrl: string;
  authToken: string;
  path: string;
  method?: string;
  body?: unknown;
  /** Cloudflare Access service-token headers. When both are present they
   * are attached to every request so CF Access can validate the service
   * at the edge. Either both or neither — partial values are ignored. */
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
}

export interface SiteAdminRequestResult {
  response: NormalizedApiResponse;
  /** Short summary for the debug response pane — method + path + status. */
  debugTitle: string;
  /** Raw payload suitable for pretty-printing in the debug pane. */
  debugBody: unknown;
}

/** Makes an authenticated request to the site-admin API via the Tauri
 * backend. Wraps `site_admin_http_request` and normalizes the response.
 * Both missing base URL and missing auth token short-circuit locally
 * without hitting the backend. */
export async function siteAdminRequest(
  input: SiteAdminRequestInput,
): Promise<SiteAdminRequestResult> {
  const method = (input.method ?? "GET").toUpperCase();
  if (!input.baseUrl) {
    const err: NormalizedApiResponse = {
      ok: false,
      status: 0,
      code: "MISSING_BASE_URL",
      error: "Missing API base URL",
      raw: null,
    };
    return {
      response: err,
      debugTitle: `${method} ${input.path}`,
      debugBody: err,
    };
  }
  const cfId = input.cfAccessClientId?.trim() || "";
  const cfSecret = input.cfAccessClientSecret?.trim() || "";
  const hasCfServiceToken = Boolean(cfId && cfSecret);

  if (!input.authToken && !hasCfServiceToken) {
    const err: NormalizedApiResponse = {
      ok: false,
      status: 0,
      code: "MISSING_AUTH",
      error:
        "No credentials configured. Sign in via browser or paste a CF Access service token.",
      raw: null,
    };
    return {
      response: err,
      debugTitle: `${method} ${input.path}`,
      debugBody: err,
    };
  }
  try {
    const rawResponse = await siteAdminHttpRequest({
      base_url: input.baseUrl,
      path: input.path,
      method,
      body: input.body ?? null,
      session_cookie: undefined,
      bearer_token: input.authToken || undefined,
      cf_access_client_id: hasCfServiceToken ? cfId : undefined,
      cf_access_client_secret: hasCfServiceToken ? cfSecret : undefined,
    });
    const normalized = normalizeApiResponse(rawResponse);
    return {
      response: normalized,
      debugTitle: `${method} ${input.path} (${normalized.status || "n/a"})`,
      debugBody: normalized.raw ?? rawResponse,
    };
  } catch (err) {
    const message = String(err);
    const normalized: NormalizedApiResponse = {
      ok: false,
      status: 0,
      code: isUntrustedHostRejection(message)
        ? "UNTRUSTED_HOST"
        : "TAURI_INVOKE_ERROR",
      error: message,
      raw: { error: message },
    };
    return {
      response: normalized,
      debugTitle: `${method} ${input.path} (invoke failed)`,
      debugBody: normalized,
    };
  }
}

export function tokenStoreKeyForBase(baseUrl: string): string {
  const normalized = normalizeString(baseUrl).replace(/\/+$/, "").toLowerCase();
  return `token::${normalized || "default"}`;
}

export function cfAccessIdStoreKeyForBase(baseUrl: string): string {
  const normalized = normalizeString(baseUrl).replace(/\/+$/, "").toLowerCase();
  return `cf-access-id::${normalized || "default"}`;
}

export function cfAccessSecretStoreKeyForBase(baseUrl: string): string {
  const normalized = normalizeString(baseUrl).replace(/\/+$/, "").toLowerCase();
  return `cf-access-secret::${normalized || "default"}`;
}
