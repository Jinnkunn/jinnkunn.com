"use client";

import type { RouteManifestItem } from "@/lib/routes-manifest";
import { siteAdminBackend } from "@/lib/client/site-admin-backend";
import type { AccessMode } from "@/lib/shared/access";
import { parseAdminRoutesPayload, type AdminConfig } from "@/lib/site-admin/route-explorer-model";
import type { SiteAdminRoutesSourceVersion } from "@/lib/site-admin/api-types";

export async function fetchAdminConfig(
  items: RouteManifestItem[],
): Promise<{ config: AdminConfig; sourceVersion: SiteAdminRoutesSourceVersion }> {
  const data = await siteAdminBackend.getRoutes();
  return {
    config: parseAdminRoutesPayload(data, items),
    sourceVersion: data.sourceVersion,
  };
}

export async function postOverride(input: {
  pageId: string;
  routePath: string;
  expectedSiteConfigSha: string;
}): Promise<SiteAdminRoutesSourceVersion> {
  const data = await siteAdminBackend.postRoutes({
    kind: "override",
    pageId: input.pageId,
    routePath: input.routePath.trim(),
    expectedSiteConfigSha: input.expectedSiteConfigSha,
  });
  return data.sourceVersion;
}

export async function postAccess(input: {
  pageId: string;
  path: string;
  access: AccessMode;
  password?: string;
  expectedProtectedRoutesSha: string;
}): Promise<SiteAdminRoutesSourceVersion> {
  const data = await siteAdminBackend.postRoutes({
    kind: "protected",
    pageId: input.pageId,
    path: input.path,
    auth: input.access,
    password: String(input.password || "").trim(),
    expectedProtectedRoutesSha: input.expectedProtectedRoutesSha,
  });
  return data.sourceVersion;
}
