import { createNamespacedSecureStorage } from "../../lib/secureStorage";
import {
  cfAccessIdStoreKeyForBase,
  cfAccessSecretStoreKeyForBase,
  siteAdminRequest,
  tokenStoreKeyForBase,
} from "../site-admin/api";
import type { PublicCalendarPayload } from "./publicProjection";

const CONNECTION_STORAGE_KEY = "workspace.site-admin.connection.v1";
const DEFAULT_BASE_URL = "https://staging.jinkunchen.com";
const PRODUCTION_BASE_URL = "https://jinkunchen.com";
const secureStorage = createNamespacedSecureStorage("site-admin");

interface StoredConnection {
  baseUrl?: string;
}

function loadBaseUrl(): string {
  try {
    const raw = localStorage.getItem(CONNECTION_STORAGE_KEY);
    if (!raw) return DEFAULT_BASE_URL;
    const parsed = JSON.parse(raw) as StoredConnection;
    return parsed.baseUrl?.trim() || DEFAULT_BASE_URL;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

function calendarPublishBaseUrl(): string {
  const baseUrl = loadBaseUrl();
  try {
    const url = new URL(baseUrl);
    if (url.hostname === "jinkunchen.com") return DEFAULT_BASE_URL;
  } catch {
    return DEFAULT_BASE_URL;
  }
  return baseUrl;
}

export async function syncPublicCalendarProjection(
  data: PublicCalendarPayload,
): Promise<{ ok: true; fileSha: string; baseUrl: string } | { ok: false; error: string; baseUrl: string }> {
  const baseUrl = calendarPublishBaseUrl();
  const result = await calendarSiteAdminRequest(baseUrl, {
    path: "/api/site-admin/calendar-public",
    method: "POST",
    body: { data },
  });
  if (!result.response.ok) {
    return {
      ok: false,
      baseUrl,
      error: `${result.response.code}: ${result.response.error}`,
    };
  }
  const sourceVersion =
    result.response.data &&
    typeof result.response.data === "object" &&
    "sourceVersion" in result.response.data
      ? (result.response.data.sourceVersion as { fileSha?: unknown })
      : null;
  return {
    ok: true,
    baseUrl,
    fileSha:
      typeof sourceVersion?.fileSha === "string" ? sourceVersion.fileSha : "",
  };
}

async function calendarSiteAdminRequest(
  baseUrl: string,
  request: {
    path: string;
    method: string;
    body?: unknown;
    credentialBaseUrl?: string;
  },
) {
  const credentialBaseUrl = request.credentialBaseUrl ?? baseUrl;
  const [authToken, cfAccessClientId, cfAccessClientSecret] = await Promise.all([
    secureStorage.get(tokenStoreKeyForBase(credentialBaseUrl)),
    secureStorage.get(cfAccessIdStoreKeyForBase(credentialBaseUrl)),
    secureStorage.get(cfAccessSecretStoreKeyForBase(credentialBaseUrl)),
  ]);
  return siteAdminRequest({
    baseUrl,
    authToken: authToken ?? "",
    cfAccessClientId: cfAccessClientId ?? undefined,
    cfAccessClientSecret: cfAccessClientSecret ?? undefined,
    path: request.path,
    method: request.method,
    body: request.body,
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export type CalendarProductionPromotionResult =
  | {
      ok: true;
      baseUrl: string;
      eventCount: number;
      publishedAt: string;
    }
  | {
      ok: false;
      baseUrl: string;
      code: string;
      error: string;
    };

export async function publishPublicCalendarToProduction(
  data: PublicCalendarPayload,
): Promise<CalendarProductionPromotionResult> {
  const credentialBaseUrl = calendarPublishBaseUrl();
  let result = await calendarSiteAdminRequest(PRODUCTION_BASE_URL, {
    path: "/api/site-admin/calendar-public/live",
    method: "POST",
    body: { data },
    credentialBaseUrl,
  });
  if (!result.response.ok && credentialBaseUrl !== PRODUCTION_BASE_URL) {
    result = await calendarSiteAdminRequest(PRODUCTION_BASE_URL, {
      path: "/api/site-admin/calendar-public/live",
      method: "POST",
      body: { data },
      credentialBaseUrl: PRODUCTION_BASE_URL,
    });
  }
  if (!result.response.ok) {
    return {
      ok: false,
      baseUrl: PRODUCTION_BASE_URL,
      code: result.response.code,
      error: `${result.response.code}: ${result.response.error}`,
    };
  }
  const dataRecord = asRecord(result.response.data);
  return {
    ok: true,
    baseUrl: PRODUCTION_BASE_URL,
    eventCount: Number(dataRecord.eventCount ?? 0),
    publishedAt: asString(dataRecord.updatedAt) || new Date().toISOString(),
  };
}

export const publishPublicCalendarSnapshot = syncPublicCalendarProjection;
