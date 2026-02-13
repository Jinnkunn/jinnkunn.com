"use client";

import type { RouteManifestItem } from "@/lib/routes-manifest";
import { asApiAck } from "@/lib/client/api-guards";
import { requestJsonOrThrow } from "@/lib/client/request-json";
import { parseAdminRoutesPayload, type AdminConfig } from "@/lib/site-admin/route-explorer-model";
import {
  isSiteAdminRoutesOk,
  parseSiteAdminRoutesResult,
} from "@/lib/site-admin/routes-contract";

type ApiOk = { ok: true };

function isApiOkResult(v: { ok: boolean }): v is ApiOk {
  return v.ok;
}

export async function fetchAdminConfig(items: RouteManifestItem[]): Promise<AdminConfig> {
  const data = await requestJsonOrThrow(
    "/api/site-admin/routes",
    { cache: "no-store" },
    parseSiteAdminRoutesResult,
    { isOk: isSiteAdminRoutesOk },
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
