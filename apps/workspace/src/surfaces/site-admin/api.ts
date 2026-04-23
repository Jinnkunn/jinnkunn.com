import { siteAdminHttpRequest } from "../../lib/tauri";
import type { NormalizedApiResponse } from "./types";
import { normalizeString } from "./utils";

// Normalize the server's admin-envelope response into one of two discrete
// variants. Callers discriminate on `.ok` — success path exposes `.data`,
// failure path exposes `.code` + `.error`.
export function normalizeApiResponse(rawResponse: unknown): NormalizedApiResponse {
  if (!rawResponse || typeof rawResponse !== "object") {
    return {
      ok: false,
      status: 0,
      code: "INVALID_RESPONSE",
      error: "Invalid Tauri response",
      raw: rawResponse,
    };
  }
  const raw = rawResponse as { status?: number; body?: unknown };
  const status = Number(raw.status ?? 0);
  const body = raw.body;
  if (!body || typeof body !== "object") {
    return {
      ok: false,
      status,
      code: "INVALID_RESPONSE",
      error: "Response body is not JSON object",
      raw: rawResponse,
    };
  }
  const bodyRecord = body as Record<string, unknown>;
  if (bodyRecord.ok === false) {
    return {
      ok: false,
      status,
      code: normalizeString(bodyRecord.code) || "REQUEST_FAILED",
      error: normalizeString(bodyRecord.error) || "Request failed",
      raw: body,
    };
  }
  if (bodyRecord.ok === true) {
    return {
      ok: true,
      status,
      data: bodyRecord.data ?? bodyRecord,
      raw: body,
    };
  }
  return {
    ok: false,
    status,
    code: "INVALID_ENVELOPE",
    error: "Response envelope missing ok/data fields",
    raw: body,
  };
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
      code: "TAURI_INVOKE_ERROR",
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
