import "server-only";

import { queryDatabase } from "@/lib/notion/api";
import { resolveContentSourceKind } from "@/lib/shared/content-source";
import type { ProtectedAccessMode } from "@/lib/shared/access";
import { compactId, normalizeRoutePath } from "@/lib/shared/route-utils";
import {
  applyOverrideToSourceConfig,
  applyProtectedRouteToSourceRoutes,
  mapSourceRouteData,
  removeOverrideFromSourceConfig,
  removeProtectedRouteFromSourceRoutes,
} from "@/lib/server/filesystem-source";
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
import { getSiteAdminSourceStore } from "@/lib/server/site-admin-source-store";
import {
  buildEnabledOnlyProperties,
  buildProtectedRouteProperties,
  buildRouteOverrideProperties,
} from "@/lib/server/site-admin-writers";
import type {
  SiteAdminProtectedRoute,
  SiteAdminRouteOverride,
  SiteAdminSourceVersion,
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
  auth: ProtectedAccessMode;
  enabled: true;
};

export type SiteAdminRouteData = {
  adminPageId: string;
  overridesDbId: string;
  protectedDbId: string;
  overrides: SiteAdminRouteOverride[];
  protectedRoutes: SiteAdminProtectedRoute[];
  sourceVersion: SiteAdminSourceVersion;
};

const EMPTY_SOURCE_VERSION: SiteAdminSourceVersion = {
  branchSha: "",
  siteConfigSha: "",
  protectedRoutesSha: "",
  routesManifestSha: "",
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
  if (resolveContentSourceKind() === "filesystem") {
    return {
      adminPageId: "",
      overridesDbId: "",
      protectedDbId: "",
    };
  }

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
  if (resolveContentSourceKind() === "filesystem") {
    const snapshot = await getSiteAdminSourceStore().getSnapshot();
    return {
      ...mapSourceRouteData(snapshot.siteConfig, snapshot.protectedRoutes),
      sourceVersion: snapshot.version,
    };
  }

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
    sourceVersion: EMPTY_SOURCE_VERSION,
  };
}

export async function upsertOverride(input: {
  expectedSiteConfigSha: string;
  overridesDbId: string;
  pageId: string;
  routePath: string;
}): Promise<{ override: OverrideUpsertResult; sourceVersion: SiteAdminSourceVersion }> {
  if (resolveContentSourceKind() === "filesystem") {
    const store = getSiteAdminSourceStore();
    const snapshot = await store.getSnapshot();
    const out = applyOverrideToSourceConfig(snapshot.siteConfig, {
      pageId: input.pageId,
      routePath: input.routePath,
    });
    const saved = await store.writeSiteConfig({
      expectedSiteConfigSha: input.expectedSiteConfigSha,
      nextSiteConfig: out.sourceConfig,
      commitMessage: "site-admin: update route override",
    });
    return { override: out, sourceVersion: saved.version };
  }

  const normalized = normalizeRoutePath(input.routePath);
  if (!normalized) throw new Error("Missing routePath");

  const properties = buildRouteOverrideProperties(input.pageId, normalized);
  const { rowId } = await upsertDatabaseRowByRichTextLookups({
    databaseId: input.overridesDbId,
    lookups: [{ property: "Page ID", equals: input.pageId }],
    properties,
  });
  return {
    override: { rowId, pageId: input.pageId, routePath: normalized, enabled: true },
    sourceVersion: EMPTY_SOURCE_VERSION,
  };
}

export async function disableOverride(input: {
  expectedSiteConfigSha: string;
  overridesDbId: string;
  pageId: string;
}): Promise<{ sourceVersion: SiteAdminSourceVersion }> {
  if (resolveContentSourceKind() === "filesystem") {
    const store = getSiteAdminSourceStore();
    const snapshot = await store.getSnapshot();
    const nextSiteConfig = removeOverrideFromSourceConfig(snapshot.siteConfig, { pageId: input.pageId });
    const saved = await store.writeSiteConfig({
      expectedSiteConfigSha: input.expectedSiteConfigSha,
      nextSiteConfig,
      commitMessage: "site-admin: remove route override",
    });
    return { sourceVersion: saved.version };
  }

  await disableDatabaseRowByRichTextLookups({
    databaseId: input.overridesDbId,
    lookups: [{ property: "Page ID", equals: input.pageId }],
    disableProperties: buildEnabledOnlyProperties(false),
  });
  return { sourceVersion: EMPTY_SOURCE_VERSION };
}

export async function upsertProtected(input: {
  expectedProtectedRoutesSha: string;
  protectedDbId: string;
  pageId: string;
  path: string;
  mode: "exact" | "prefix";
  password: string;
  auth: ProtectedAccessMode;
}): Promise<{ protectedRoute: ProtectedUpsertResult; sourceVersion: SiteAdminSourceVersion }> {
  if (resolveContentSourceKind() === "filesystem") {
    const store = getSiteAdminSourceStore();
    const snapshot = await store.getSnapshot();
    const out = applyProtectedRouteToSourceRoutes(snapshot.protectedRoutes, {
      pageId: input.pageId,
      path: input.path,
      mode: input.mode,
      password: input.password,
      auth: input.auth,
    });
    const saved = await store.writeProtectedRoutes({
      expectedProtectedRoutesSha: input.expectedProtectedRoutesSha,
      nextProtectedRoutes: out.routes,
      commitMessage: "site-admin: update protected route",
    });
    return { protectedRoute: out.row, sourceVersion: saved.version };
  }

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
    protectedRoute: {
      rowId: createdId,
      pageId: pid,
      path: normalized,
      mode: input.mode,
      auth: input.auth,
      enabled: true,
    },
    sourceVersion: EMPTY_SOURCE_VERSION,
  };
}

export async function disableProtected(input: {
  expectedProtectedRoutesSha: string;
  protectedDbId: string;
  pageId: string;
  path: string;
}): Promise<{ sourceVersion: SiteAdminSourceVersion }> {
  if (resolveContentSourceKind() === "filesystem") {
    const store = getSiteAdminSourceStore();
    const snapshot = await store.getSnapshot();
    const nextProtectedRoutes = removeProtectedRouteFromSourceRoutes(snapshot.protectedRoutes, {
      pageId: input.pageId,
      path: input.path,
    });
    const saved = await store.writeProtectedRoutes({
      expectedProtectedRoutesSha: input.expectedProtectedRoutesSha,
      nextProtectedRoutes,
      commitMessage: "site-admin: remove protected route",
    });
    return { sourceVersion: saved.version };
  }

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
  return { sourceVersion: EMPTY_SOURCE_VERSION };
}
