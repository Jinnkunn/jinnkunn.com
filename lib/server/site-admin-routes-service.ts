import "server-only";

import { queryDatabase } from "@/lib/notion/api";
import { compactId, normalizeRoutePath } from "@/lib/shared/route-utils";
import {
  mapProtectedRouteRows,
  mapRouteOverrideRows,
} from "@/lib/server/site-admin-mappers";
import {
  disableDatabaseRowByRichTextLookups,
  ensureDatabaseProperties,
  findSiteAdminDatabaseIdByTitle,
  loadSiteAdminDatabases,
  upsertDatabaseRowByRichTextLookups,
} from "@/lib/server/site-admin-notion";
import {
  buildEnabledOnlyProperties,
  buildProtectedRouteProperties,
  buildRouteOverrideProperties,
} from "@/lib/server/site-admin-writers";
import type {
  SiteAdminProtectedRoute,
  SiteAdminRouteOverride,
} from "@/lib/site-admin/api-types";

export type AdminDbIds = {
  adminPageId: string;
  overridesDbId: string;
  protectedDbId: string;
};

export type OverrideUpsertResult = {
  rowId: string;
  pageId: string;
  routePath: string;
  enabled: true;
};

export type ProtectedUpsertResult = {
  rowId: string;
  pageId: string;
  path: string;
  mode: "exact" | "prefix";
  auth: "password" | "github";
  enabled: true;
};

export type SiteAdminRouteData = {
  adminPageId: string;
  overridesDbId: string;
  protectedDbId: string;
  overrides: SiteAdminRouteOverride[];
  protectedRoutes: SiteAdminProtectedRoute[];
};

async function ensureProtectedDbSchema(databaseId: string) {
  if (!databaseId) return;
  await ensureDatabaseProperties(databaseId, {
    "Page ID": { rich_text: {} },
    Auth: {
      select: {
        options: [
          { name: "Password", color: "red" },
          { name: "GitHub", color: "blue" },
        ],
      },
    },
  });
}

export async function getAdminDbIds(): Promise<AdminDbIds> {
  const { adminPageId, databases } = await loadSiteAdminDatabases();
  const overridesDbId = compactId(findSiteAdminDatabaseIdByTitle(databases, "Route Overrides"));
  const protectedDbId = compactId(findSiteAdminDatabaseIdByTitle(databases, "Protected Routes"));
  if (protectedDbId) await ensureProtectedDbSchema(protectedDbId);
  return {
    adminPageId,
    overridesDbId,
    protectedDbId,
  };
}

export async function loadSiteAdminRouteData(): Promise<SiteAdminRouteData> {
  const { adminPageId, overridesDbId, protectedDbId } = await getAdminDbIds();
  const overridesRows = overridesDbId ? await queryDatabase(overridesDbId) : [];
  const protectedRows = protectedDbId ? await queryDatabase(protectedDbId) : [];
  const overrides: SiteAdminRouteOverride[] = mapRouteOverrideRows(overridesRows);
  const protectedRoutes: SiteAdminProtectedRoute[] = mapProtectedRouteRows(protectedRows);
  return {
    adminPageId,
    overridesDbId,
    protectedDbId,
    overrides,
    protectedRoutes,
  };
}

export async function upsertOverride(input: {
  overridesDbId: string;
  pageId: string;
  routePath: string;
}): Promise<OverrideUpsertResult> {
  const normalized = normalizeRoutePath(input.routePath);
  if (!normalized) throw new Error("Missing routePath");

  const properties = buildRouteOverrideProperties(input.pageId, normalized);
  const { rowId } = await upsertDatabaseRowByRichTextLookups({
    databaseId: input.overridesDbId,
    lookups: [{ property: "Page ID", equals: input.pageId }],
    properties,
  });
  return { rowId, pageId: input.pageId, routePath: normalized, enabled: true };
}

export async function disableOverride(input: {
  overridesDbId: string;
  pageId: string;
}): Promise<void> {
  await disableDatabaseRowByRichTextLookups({
    databaseId: input.overridesDbId,
    lookups: [{ property: "Page ID", equals: input.pageId }],
    disableProperties: buildEnabledOnlyProperties(false),
  });
}

export async function upsertProtected(input: {
  protectedDbId: string;
  pageId: string;
  path: string;
  mode: "exact" | "prefix";
  password: string;
  auth: "password" | "github";
}): Promise<ProtectedUpsertResult> {
  const normalized = normalizeRoutePath(input.path);
  if (!normalized) throw new Error("Missing path");
  const pid = compactId(input.pageId);
  if (!pid) throw new Error("Missing pageId");
  const pwd = String(input.password || "").trim();
  if (input.auth === "password" && !pwd) throw new Error("Missing password");

  const properties = buildProtectedRouteProperties({
    pageId: pid,
    path: normalized,
    mode: input.mode,
    auth: input.auth,
    password: pwd,
  });
  const { rowId: createdId } = await upsertDatabaseRowByRichTextLookups({
    databaseId: input.protectedDbId,
    lookups: [
      { property: "Page ID", equals: pid },
      { property: "Path", equals: normalized },
    ],
    options: { ignoreLookupErrors: true },
    properties,
  });
  return {
    rowId: createdId,
    pageId: pid,
    path: normalized,
    mode: input.mode,
    auth: input.auth,
    enabled: true,
  };
}

export async function disableProtected(input: {
  protectedDbId: string;
  pageId: string;
  path: string;
}): Promise<void> {
  const normalized = normalizeRoutePath(input.path);
  const pid = compactId(input.pageId);
  await disableDatabaseRowByRichTextLookups({
    databaseId: input.protectedDbId,
    lookups: [
      { property: "Page ID", equals: pid },
      { property: "Path", equals: normalized },
    ],
    options: { ignoreLookupErrors: true },
    disableProperties: buildEnabledOnlyProperties(false),
  });
}
