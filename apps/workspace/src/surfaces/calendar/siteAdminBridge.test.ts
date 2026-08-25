import { beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeCalendarObservationSyncPayload } from "../../../../../lib/shared/calendar-core.ts";
import {
  parseSiteAdminCalendarPublicLiveSaveCommand,
  parseSiteAdminCalendarPublicSaveCommand,
} from "../../../../../lib/site-admin/calendar-public-commands.ts";
import type { PublicCalendarPayload } from "./publicProjection";

const mocks = vi.hoisted(() => ({
  secureGet: vi.fn(),
  siteAdminRequest: vi.fn(),
}));

vi.mock("../../lib/secureStorage", () => ({
  createNamespacedSecureStorage: () => ({ get: mocks.secureGet }),
}));

vi.mock("../site-admin/api", () => ({
  cfAccessIdStoreKeyForBase: (baseUrl: string) => `cf-id::${baseUrl}`,
  cfAccessSecretStoreKeyForBase: (baseUrl: string) => `cf-secret::${baseUrl}`,
  siteAdminRequest: (input: unknown) => mocks.siteAdminRequest(input),
  tokenStoreKeyForBase: (baseUrl: string) => `token::${baseUrl}`,
}));

import {
  publishPublicCalendarToProduction,
  syncCalendarObservations,
  syncPublicCalendarProjection,
} from "./siteAdminBridge";

const STAGING_BASE_URL = "https://staging.jinkunchen.com";
const PRODUCTION_BASE_URL = "https://jinkunchen.com";

const PROJECTION: PublicCalendarPayload = {
  schemaVersion: 1,
  generatedAt: "2026-08-11T12:00:00.000Z",
  range: {
    startsAt: "2026-08-01T00:00:00.000Z",
    endsAt: "2026-09-01T00:00:00.000Z",
  },
  events: [
    {
      id: "event-1",
      title: "Reading group",
      startsAt: "2026-08-12T14:00:00.000Z",
      endsAt: "2026-08-12T15:00:00.000Z",
      isAllDay: false,
      visibility: "titleOnly",
    },
  ],
};

function okResponse(data: unknown) {
  return {
    response: {
      ok: true as const,
      status: 200,
      data,
      raw: { ok: true, data },
    },
    debugTitle: "test",
    debugBody: data,
  };
}

function errorResponse(code: string, status: number, error = "Request failed") {
  const raw = { ok: false, code, error };
  return {
    response: {
      ok: false as const,
      status,
      code,
      error,
      raw,
    },
    debugTitle: "test",
    debugBody: raw,
  };
}

function requestAt(index: number): Record<string, unknown> {
  const call = mocks.siteAdminRequest.mock.calls[index]?.[0];
  expect(call).toBeTruthy();
  return call as Record<string, unknown>;
}

describe("calendar Site Admin optimistic-lock bridge", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    mocks.secureGet.mockReset();
    mocks.secureGet.mockImplementation(async (key: string) =>
      key.startsWith("token::") ? key : null,
    );
    mocks.siteAdminRequest.mockReset();
  });

  it("GETs the staging version and sends it back as expectedFileSha", async () => {
    mocks.siteAdminRequest
      .mockResolvedValueOnce(
        okResponse({
          data: { ...PROJECTION, events: [] },
          sourceVersion: { fileSha: "staging-sha-1" },
        }),
      )
      .mockResolvedValueOnce(
        okResponse({
          sourceVersion: { fileSha: "staging-sha-2" },
          dbStatus: "ok",
        }),
      );

    await expect(syncPublicCalendarProjection(PROJECTION)).resolves.toEqual({
      ok: true,
      baseUrl: STAGING_BASE_URL,
      fileSha: "staging-sha-2",
    });

    expect(mocks.siteAdminRequest).toHaveBeenCalledTimes(2);
    expect(requestAt(0)).toMatchObject({
      baseUrl: STAGING_BASE_URL,
      path: "/api/site-admin/calendar-public",
      method: "GET",
    });
    expect(requestAt(1)).toMatchObject({
      baseUrl: STAGING_BASE_URL,
      path: "/api/site-admin/calendar-public",
      method: "POST",
      body: { data: PROJECTION, expectedFileSha: "staging-sha-1" },
    });
    expect(
      parseSiteAdminCalendarPublicSaveCommand(
        requestAt(1).body as Record<string, unknown>,
      ),
    ).toMatchObject({
      ok: true,
      value: { expectedFileSha: "staging-sha-1" },
    });
  });

  it("GETs the live version before publishing to production", async () => {
    mocks.siteAdminRequest
      .mockResolvedValueOnce(
        okResponse({
          data: { ...PROJECTION, events: [] },
          sourceVersion: { fileSha: "live-sha-1" },
        }),
      )
      .mockResolvedValueOnce(
        okResponse({
          eventCount: 1,
          eventsWritten: 1,
          updatedAt: "2026-08-11T12:01:00.000Z",
        }),
      );

    await expect(publishPublicCalendarToProduction(PROJECTION)).resolves.toEqual({
      ok: true,
      baseUrl: PRODUCTION_BASE_URL,
      eventCount: 1,
      publishedAt: "2026-08-11T12:01:00.000Z",
    });

    expect(mocks.siteAdminRequest).toHaveBeenCalledTimes(2);
    expect(requestAt(0)).toMatchObject({
      baseUrl: PRODUCTION_BASE_URL,
      path: "/api/site-admin/calendar-public/live",
      method: "GET",
    });
    expect(requestAt(1)).toMatchObject({
      baseUrl: PRODUCTION_BASE_URL,
      path: "/api/site-admin/calendar-public/live",
      method: "POST",
      body: { data: PROJECTION, expectedFileSha: "live-sha-1" },
    });
    expect(
      parseSiteAdminCalendarPublicLiveSaveCommand(
        requestAt(1).body as Record<string, unknown>,
      ),
    ).toMatchObject({
      ok: true,
      value: { expectedFileSha: "live-sha-1" },
    });
  });

  it("re-reads a 409 and refuses to overwrite a different projection", async () => {
    const concurrentProjection = {
      ...PROJECTION,
      generatedAt: "2026-08-11T12:02:00.000Z",
      events: [],
    };
    mocks.siteAdminRequest
      .mockResolvedValueOnce(
        okResponse({
          data: concurrentProjection,
          sourceVersion: { fileSha: "staging-sha-1" },
        }),
      )
      .mockResolvedValueOnce(
        errorResponse("SOURCE_CONFLICT", 409, "Calendar changed"),
      )
      .mockResolvedValueOnce(
        okResponse({
          data: concurrentProjection,
          sourceVersion: { fileSha: "staging-sha-2" },
        }),
      );

    const result = await syncPublicCalendarProjection(PROJECTION);

    expect(result).toMatchObject({
      ok: false,
      code: "SOURCE_CONFLICT",
      currentFileSha: "staging-sha-2",
    });
    expect(result.ok || result.error).toContain("did not overwrite it");
    expect(mocks.siteAdminRequest).toHaveBeenCalledTimes(3);
    expect(mocks.siteAdminRequest.mock.calls.map((call) => call[0].method)).toEqual([
      "GET",
      "POST",
      "GET",
    ]);
  });

  it("treats an identical concurrent projection as idempotent success", async () => {
    mocks.siteAdminRequest
      .mockResolvedValueOnce(
        okResponse({ data: PROJECTION, sourceVersion: { fileSha: "old-sha" } }),
      )
      .mockResolvedValueOnce(
        errorResponse("SOURCE_CONFLICT", 409, "Calendar changed"),
      )
      .mockResolvedValueOnce(
        okResponse({
          data: {
            ...PROJECTION,
            generatedAt: "2026-08-11T12:03:00.000Z",
          },
          sourceVersion: { fileSha: "concurrent-sha" },
        }),
      );

    await expect(syncPublicCalendarProjection(PROJECTION)).resolves.toEqual({
      ok: true,
      baseUrl: STAGING_BASE_URL,
      fileSha: "concurrent-sha",
    });
    expect(mocks.siteAdminRequest.mock.calls.map((call) => call[0].method)).toEqual([
      "GET",
      "POST",
      "GET",
    ]);
  });

  it("reports a live conflict after re-read instead of retrying the write", async () => {
    const concurrentProjection = {
      ...PROJECTION,
      generatedAt: "2026-08-11T12:03:30.000Z",
      events: [],
    };
    mocks.siteAdminRequest
      .mockResolvedValueOnce(
        okResponse({ data: PROJECTION, sourceVersion: { fileSha: "live-old" } }),
      )
      .mockResolvedValueOnce(
        errorResponse("SOURCE_CONFLICT", 409, "Published calendar changed"),
      )
      .mockResolvedValueOnce(
        okResponse({
          data: concurrentProjection,
          sourceVersion: { fileSha: "live-current" },
        }),
      );

    const result = await publishPublicCalendarToProduction(PROJECTION);

    expect(result).toMatchObject({
      ok: false,
      code: "SOURCE_CONFLICT",
      currentFileSha: "live-current",
    });
    expect(mocks.siteAdminRequest.mock.calls.map((call) => call[0].method)).toEqual([
      "GET",
      "POST",
      "GET",
    ]);
  });

  it("falls back to production credentials only for authentication failures", async () => {
    mocks.siteAdminRequest
      .mockResolvedValueOnce(errorResponse("UNAUTHORIZED", 401, "Unauthorized"))
      .mockResolvedValueOnce(
        okResponse({ data: null, sourceVersion: { fileSha: "" } }),
      )
      .mockResolvedValueOnce(
        okResponse({
          eventCount: 1,
          eventsWritten: 1,
          updatedAt: "2026-08-11T12:04:00.000Z",
        }),
      );

    const result = await publishPublicCalendarToProduction(PROJECTION);

    expect(result.ok).toBe(true);
    expect(mocks.siteAdminRequest).toHaveBeenCalledTimes(3);
    expect(requestAt(0).authToken).toBe(`token::${STAGING_BASE_URL}`);
    expect(requestAt(1).authToken).toBe(`token::${PRODUCTION_BASE_URL}`);
    expect(requestAt(2).authToken).toBe(`token::${PRODUCTION_BASE_URL}`);
    expect(requestAt(2)).toMatchObject({
      method: "POST",
      body: { data: PROJECTION, expectedFileSha: "" },
    });
  });

  it("keeps observations as a single POST without a version preflight", async () => {
    const observations = normalizeCalendarObservationSyncPayload({
      collector: { id: "test-collector", kind: "tauri-macos" },
      sources: [],
      range: {
        startsAt: "2026-08-01T00:00:00.000Z",
        endsAt: "2026-09-01T00:00:00.000Z",
      },
      syncMode: "snapshot",
      observedAt: "2026-08-11T12:00:00.000Z",
      observations: [],
    });
    mocks.siteAdminRequest.mockResolvedValueOnce(
      okResponse({
        sourcesWritten: 0,
        observationsWritten: 0,
        entitiesWritten: 0,
        staleObservations: 0,
        syncedAt: "2026-08-11T12:00:01.000Z",
      }),
    );

    expect((await syncCalendarObservations(observations)).ok).toBe(true);
    expect(mocks.siteAdminRequest).toHaveBeenCalledTimes(1);
    expect(requestAt(0)).toMatchObject({
      path: "/api/site-admin/calendar-observations",
      method: "POST",
      body: observations,
    });
  });
});
