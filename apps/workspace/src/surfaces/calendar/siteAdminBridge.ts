import { createNamespacedSecureStorage } from "../../lib/secureStorage";
import {
  cfAccessIdStoreKeyForBase,
  cfAccessSecretStoreKeyForBase,
  siteAdminRequest,
  tokenStoreKeyForBase,
} from "../site-admin/api";
import type {
  NormalizedApiFailure,
  NormalizedApiResponse,
} from "../site-admin/types";
import type { PublicCalendarPayload } from "./publicProjection";
import { fingerprintPublicCalendarPayload } from "./syncSnapshot";
import type {
  CalendarObservationSyncPayload,
} from "../../../../../lib/shared/calendar-core.ts";
import { normalizePublicCalendarData } from "../../../../../lib/shared/public-calendar.ts";

const CONNECTION_STORAGE_KEY = "workspace.site-admin.connection.v1";
const DEFAULT_BASE_URL = "https://staging.jinkunchen.com";
const PRODUCTION_BASE_URL = "https://jinkunchen.com";
const secureStorage = createNamespacedSecureStorage("site-admin");

interface StoredConnection {
  baseUrl?: string;
}

type CalendarPublishFailure = {
  ok: false;
  baseUrl: string;
  code: string;
  error: string;
  currentFileSha?: string;
};

type CalendarEndpointSnapshot = {
  data: unknown;
  fileSha: string;
};

type CalendarEndpointPath =
  | "/api/site-admin/calendar-public"
  | "/api/site-admin/calendar-public/live";

type CalendarRequestExecutor = typeof calendarSiteAdminRequest;

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
): Promise<
  { ok: true; fileSha: string; baseUrl: string } | CalendarPublishFailure
> {
  const baseUrl = calendarPublishBaseUrl();
  const path = "/api/site-admin/calendar-public";
  const current = await readCalendarEndpointSnapshot(baseUrl, { path });
  if (!current.ok) return current.failure;

  const result = await calendarSiteAdminRequest(baseUrl, {
    path,
    method: "POST",
    body: { data, expectedFileSha: current.snapshot.fileSha },
  });
  if (!result.response.ok) {
    if (isSourceConflict(result.response)) {
      const resolution = await resolveCalendarPublishConflict({
        baseUrl,
        data,
        path,
        failedResponse: result.response,
        readSnapshot: () => readCalendarEndpointSnapshot(baseUrl, { path }),
      });
      if (!resolution.ok) return resolution.failure;
      return {
        ok: true,
        baseUrl,
        fileSha: resolution.snapshot.fileSha,
      };
    }
    return calendarPublishFailure(baseUrl, result.response);
  }
  const sourceVersion = asRecord(asRecord(result.response.data).sourceVersion);
  if (typeof sourceVersion.fileSha !== "string") {
    return invalidCalendarResponse(
      baseUrl,
      `${path} POST response is missing sourceVersion.fileSha`,
    );
  }
  return {
    ok: true,
    baseUrl,
    fileSha: sourceVersion.fileSha,
  };
}

async function readCalendarEndpointSnapshot(
  baseUrl: string,
  input: {
    path: CalendarEndpointPath;
    credentialBaseUrl?: string;
  },
  requestExecutor?: CalendarRequestExecutor,
): Promise<
  | { ok: true; snapshot: CalendarEndpointSnapshot }
  | { ok: false; failure: CalendarPublishFailure }
> {
  const execute = requestExecutor ?? calendarSiteAdminRequest;
  const result = await execute(baseUrl, {
    path: input.path,
    method: "GET",
    credentialBaseUrl: input.credentialBaseUrl,
  });
  if (!result.response.ok) {
    return {
      ok: false,
      failure: calendarPublishFailure(baseUrl, result.response),
    };
  }
  const payload = asRecord(result.response.data);
  const sourceVersion = asRecord(payload.sourceVersion);
  if (typeof sourceVersion.fileSha !== "string" || !("data" in payload)) {
    return {
      ok: false,
      failure: invalidCalendarResponse(
        baseUrl,
        `${input.path} GET response is missing data or sourceVersion.fileSha`,
      ),
    };
  }
  return {
    ok: true,
    snapshot: {
      data: payload.data,
      fileSha: sourceVersion.fileSha,
    },
  };
}

export type CalendarObservationSyncResult =
  | {
      ok: true;
      baseUrl: string;
      sourcesWritten: number;
      observationsWritten: number;
      entitiesWritten: number;
      staleObservations: number;
      syncedAt: string;
    }
  | {
      ok: false;
      baseUrl: string;
      code: string;
      error: string;
    };

export async function syncCalendarObservations(
  payload: CalendarObservationSyncPayload,
): Promise<CalendarObservationSyncResult> {
  const baseUrl = calendarPublishBaseUrl();
  const result = await calendarSiteAdminRequest(baseUrl, {
    path: "/api/site-admin/calendar-observations",
    method: "POST",
    body: payload,
  });
  if (!result.response.ok) {
    return {
      ok: false,
      baseUrl,
      code: result.response.code,
      error: `${result.response.code}: ${result.response.error}`,
    };
  }
  const dataRecord = asRecord(result.response.data);
  return {
    ok: true,
    baseUrl,
    sourcesWritten: Number(dataRecord.sourcesWritten ?? 0),
    observationsWritten: Number(dataRecord.observationsWritten ?? 0),
    entitiesWritten: Number(dataRecord.entitiesWritten ?? 0),
    staleObservations: Number(dataRecord.staleObservations ?? 0),
    syncedAt: asString(dataRecord.syncedAt) || new Date().toISOString(),
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

function createProductionCalendarRequestExecutor(): CalendarRequestExecutor {
  let credentialBaseUrl = calendarPublishBaseUrl();
  return async (_baseUrl, request) => {
    const result = await calendarSiteAdminRequest(PRODUCTION_BASE_URL, {
      ...request,
      credentialBaseUrl,
    });
    if (
      result.response.ok ||
      credentialBaseUrl === PRODUCTION_BASE_URL ||
      !isCredentialFailure(result.response)
    ) {
      return result;
    }
    credentialBaseUrl = PRODUCTION_BASE_URL;
    return calendarSiteAdminRequest(PRODUCTION_BASE_URL, {
      ...request,
      credentialBaseUrl,
    });
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isCredentialFailure(response: NormalizedApiResponse): boolean {
  if (response.ok) return false;
  return (
    response.status === 401 ||
    response.status === 403 ||
    response.code === "UNAUTHORIZED" ||
    response.code === "FORBIDDEN" ||
    response.code === "MISSING_AUTH" ||
    response.code === "TOKEN_EXPIRED"
  );
}

function isSourceConflict(
  response: NormalizedApiResponse,
): response is NormalizedApiFailure {
  return (
    !response.ok &&
    (response.status === 409 ||
      response.code === "SOURCE_CONFLICT" ||
      response.code === "VERSION_CONFLICT")
  );
}

function calendarPublishFailure(
  baseUrl: string,
  response: NormalizedApiFailure,
  currentFileSha?: string,
): CalendarPublishFailure {
  return {
    ok: false,
    baseUrl,
    code: response.code,
    error: `${response.code}: ${response.error}`,
    ...(currentFileSha === undefined ? {} : { currentFileSha }),
  };
}

function invalidCalendarResponse(
  baseUrl: string,
  error: string,
): CalendarPublishFailure {
  return {
    ok: false,
    baseUrl,
    code: "INVALID_RESPONSE",
    error: `INVALID_RESPONSE: ${error}`,
  };
}

function hasSamePublicCalendarProjection(
  current: unknown,
  intended: PublicCalendarPayload,
): boolean {
  if (!current) return false;
  return (
    fingerprintPublicCalendarPayload(normalizePublicCalendarData(current)) ===
    fingerprintPublicCalendarPayload(normalizePublicCalendarData(intended))
  );
}

async function resolveCalendarPublishConflict(input: {
  baseUrl: string;
  data: PublicCalendarPayload;
  path: CalendarEndpointPath;
  failedResponse: NormalizedApiFailure;
  readSnapshot: () => Promise<
    | { ok: true; snapshot: CalendarEndpointSnapshot }
    | { ok: false; failure: CalendarPublishFailure }
  >;
}): Promise<
  | { ok: true; snapshot: CalendarEndpointSnapshot }
  | { ok: false; failure: CalendarPublishFailure }
> {
  const refreshed = await input.readSnapshot();
  if (!refreshed.ok) {
    const failure = calendarPublishFailure(
      input.baseUrl,
      input.failedResponse,
    );
    return {
      ok: false,
      failure: {
        ...failure,
        error:
          `${failure.error}. Re-reading ${input.path} also failed: ` +
          refreshed.failure.error,
      },
    };
  }
  if (hasSamePublicCalendarProjection(refreshed.snapshot.data, input.data)) {
    // A concurrent writer already committed the exact same projection. This
    // operation is idempotently complete; retrying the replacement write is
    // unnecessary and would only open another race window.
    return { ok: true, snapshot: refreshed.snapshot };
  }
  const failure = calendarPublishFailure(
    input.baseUrl,
    input.failedResponse,
    refreshed.snapshot.fileSha,
  );
  return {
    ok: false,
    failure: {
      ...failure,
      error:
        `${failure.error}. The calendar changed after it was read ` +
        `(current sourceVersion.fileSha=${JSON.stringify(refreshed.snapshot.fileSha)}); ` +
        "the client did not overwrite it.",
    },
  };
}

export type CalendarProductionPromotionResult =
  | {
      ok: true;
      baseUrl: string;
      eventCount: number;
      publishedAt: string;
    }
  | CalendarPublishFailure;

export async function publishPublicCalendarToProduction(
  data: PublicCalendarPayload,
): Promise<CalendarProductionPromotionResult> {
  const path = "/api/site-admin/calendar-public/live";
  const requestExecutor = createProductionCalendarRequestExecutor();
  const current = await readCalendarEndpointSnapshot(
    PRODUCTION_BASE_URL,
    { path },
    requestExecutor,
  );
  if (!current.ok) return current.failure;

  const result = await requestExecutor(PRODUCTION_BASE_URL, {
    path,
    method: "POST",
    body: { data, expectedFileSha: current.snapshot.fileSha },
  });
  if (!result.response.ok) {
    if (isSourceConflict(result.response)) {
      const resolution = await resolveCalendarPublishConflict({
        baseUrl: PRODUCTION_BASE_URL,
        data,
        path,
        failedResponse: result.response,
        readSnapshot: () =>
          readCalendarEndpointSnapshot(
            PRODUCTION_BASE_URL,
            { path },
            requestExecutor,
          ),
      });
      if (!resolution.ok) return resolution.failure;
      const currentData = normalizePublicCalendarData(resolution.snapshot.data);
      return {
        ok: true,
        baseUrl: PRODUCTION_BASE_URL,
        eventCount: currentData.events.length,
        publishedAt: currentData.generatedAt,
      };
    }
    return calendarPublishFailure(PRODUCTION_BASE_URL, result.response);
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
