"use client";

import type { RouteManifestItem } from "@/lib/routes-manifest";
import type { SiteAdminRoutesResult } from "@/lib/site-admin/api-types";
import { asApiAck, isRecord } from "@/lib/client/api-guards";
import { requestJsonOrThrow } from "@/lib/client/request-json";
import { parseAdminRoutesPayload, type AdminConfig } from "@/lib/site-admin/route-explorer-model";

type ApiOk = { ok: true };
type RoutesGetSuccess = Extract<SiteAdminRoutesResult, { ok: true }>;

function isApiOkResult(v: { ok: boolean }): v is ApiOk {
  return v.ok;
}

function isRoutesGetSuccess(v: SiteAdminRoutesResult): v is RoutesGetSuccess {
  return v.ok;
}

function asRoutesResult(x: unknown): SiteAdminRoutesResult | null {
  const base = asApiAck(x);
  if (!base) return null;
  if (!base.ok) return base;
  if (!isRecord(x)) return null;

  if (
    !Array.isArray(x.overrides) ||
    !Array.isArray(x.protectedRoutes) ||
    typeof x.adminPageId !== "string" ||
    !isRecord(x.databases)
  ) {
    return null;
  }

  const overridesDbId = x.databases.overridesDbId;
  const protectedDbId = x.databases.protectedDbId;
  if (typeof overridesDbId !== "string" || typeof protectedDbId !== "string") return null;

  return x as SiteAdminRoutesResult;
}

export async function fetchAdminConfig(items: RouteManifestItem[]): Promise<AdminConfig> {
  const data = await requestJsonOrThrow(
    "/api/site-admin/routes",
    { cache: "no-store" },
    asRoutesResult,
    { isOk: isRoutesGetSuccess },
  );
  return parseAdminRoutesPayload(data, items);
}

export async function postOverride(input: { pageId: string; routePath: string }) {
  await requestJsonOrThrow(
    "/api/site-admin/routes",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "override",
        pageId: input.pageId,
        routePath: input.routePath.trim(),
      }),
    },
    asApiAck,
    { isOk: isApiOkResult },
  );
}

export async function postAccess(input: {
  pageId: string;
  path: string;
  access: "public" | "password" | "github";
  password?: string;
}) {
  await requestJsonOrThrow(
    "/api/site-admin/routes",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "protected",
        pageId: input.pageId,
        path: input.path,
        auth: input.access,
        password: String(input.password || "").trim(),
      }),
    },
    asApiAck,
    { isOk: isApiOkResult },
  );
}
