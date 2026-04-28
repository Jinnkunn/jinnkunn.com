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
  const [authToken, cfAccessClientId, cfAccessClientSecret] = await Promise.all([
    secureStorage.get(tokenStoreKeyForBase(baseUrl)),
    secureStorage.get(cfAccessIdStoreKeyForBase(baseUrl)),
    secureStorage.get(cfAccessSecretStoreKeyForBase(baseUrl)),
  ]);
  const result = await siteAdminRequest({
    baseUrl,
    authToken: authToken ?? "",
    cfAccessClientId: cfAccessClientId ?? undefined,
    cfAccessClientSecret: cfAccessClientSecret ?? undefined,
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

export const publishPublicCalendarSnapshot = syncPublicCalendarProjection;
