import type { NextRequest } from "next/server";

import { compactId, normalizeRoutePath } from "@/lib/shared/route-utils";
import { apiError, apiOk, withSiteAdmin } from "@/lib/server/site-admin-api";
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
  parseSiteAdminJsonCommand,
  parseSiteAdminRoutesCommand,
} from "@/lib/server/site-admin-request";
import {
  buildEnabledOnlyProperties,
  buildProtectedRouteProperties,
  buildRouteOverrideProperties,
} from "@/lib/server/site-admin-writers";
import type {
  SiteAdminProtectedRoute,
  SiteAdminRouteOverride,
  SiteAdminRoutesGetPayload,
} from "@/lib/site-admin/api-types";
import {
  queryDatabase,
} from "@/lib/notion/api";

export const runtime = "nodejs";

type AdminDbIds = {
  adminPageId: string;
  overridesDbId: string;
  protectedDbId: string;
};

type OverrideUpsertResult = {
  rowId: string;
  pageId: string;
  routePath: string;
  enabled: true;
};

type ProtectedUpsertResult = {
  rowId: string;
  pageId: string;
  path: string;
  mode: "exact" | "prefix";
  auth: "password" | "github";
  enabled: true;
};
type SiteAdminRoutesResponsePayload = Omit<SiteAdminRoutesGetPayload, "ok">;

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


async function upsertOverride({
  overridesDbId,
  pageId,
  routePath,
}: {
  overridesDbId: string;
  pageId: string;
  routePath: string;
}): Promise<OverrideUpsertResult> {
  const normalized = normalizeRoutePath(routePath);
  if (!normalized) throw new Error("Missing routePath");

  const properties = buildRouteOverrideProperties(pageId, normalized);
  const { rowId } = await upsertDatabaseRowByRichTextLookups({
    databaseId: overridesDbId,
    lookups: [{ property: "Page ID", equals: pageId }],
    properties,
  });
  return { rowId, pageId, routePath: normalized, enabled: true };
}

async function disableOverride({
  overridesDbId,
  pageId,
}: {
  overridesDbId: string;
  pageId: string;
}): Promise<void> {
  await disableDatabaseRowByRichTextLookups({
    databaseId: overridesDbId,
    lookups: [{ property: "Page ID", equals: pageId }],
    disableProperties: buildEnabledOnlyProperties(false),
  });
}

async function upsertProtected({
  protectedDbId,
  pageId,
  path,
  mode,
  password,
  auth,
}: {
  protectedDbId: string;
  pageId: string;
  path: string;
  mode: "exact" | "prefix";
  password: string;
  auth: "password" | "github";
}): Promise<ProtectedUpsertResult> {
  const normalized = normalizeRoutePath(path);
  if (!normalized) throw new Error("Missing path");
  const pid = compactId(pageId);
  if (!pid) throw new Error("Missing pageId");
  const pwd = String(password || "").trim();
  if (auth === "password" && !pwd) throw new Error("Missing password");

  const properties = buildProtectedRouteProperties({
    pageId: pid,
    path: normalized,
    mode,
    auth,
    password: pwd,
  });
  const { rowId: createdId } = await upsertDatabaseRowByRichTextLookups({
    databaseId: protectedDbId,
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
    mode,
    auth,
    enabled: true,
  };
}

async function disableProtected({
  protectedDbId,
  pageId,
  path,
}: {
  protectedDbId: string;
  pageId: string;
  path: string;
}): Promise<void> {
  const normalized = normalizeRoutePath(path);
  const pid = compactId(pageId);
  await disableDatabaseRowByRichTextLookups({
    databaseId: protectedDbId,
    lookups: [
      { property: "Page ID", equals: pid },
      { property: "Path", equals: normalized },
    ],
    options: { ignoreLookupErrors: true },
    disableProperties: buildEnabledOnlyProperties(false),
  });
}

async function getAdminDbIds(): Promise<AdminDbIds> {
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

export async function GET(req: NextRequest) {
  return withSiteAdmin(req, async () => {
    const { adminPageId, overridesDbId, protectedDbId } = await getAdminDbIds();
    const overridesRows = overridesDbId ? await queryDatabase(overridesDbId) : [];
    const protectedRows = protectedDbId ? await queryDatabase(protectedDbId) : [];
    const overrides: SiteAdminRouteOverride[] = mapRouteOverrideRows(overridesRows);
    const protectedRoutes: SiteAdminProtectedRoute[] = mapProtectedRouteRows(protectedRows);

    const payload: SiteAdminRoutesResponsePayload = {
      adminPageId,
      databases: { overridesDbId, protectedDbId },
      overrides,
      protectedRoutes,
    };

    return apiOk(payload);
  });
}

export async function POST(req: NextRequest) {
  return withSiteAdmin(req, async () => {
    const { overridesDbId, protectedDbId } = await getAdminDbIds();
    const parsed = await parseSiteAdminJsonCommand(req, parseSiteAdminRoutesCommand);
    if (!parsed.ok) return apiError(parsed.error, { status: parsed.status });
    const command = parsed.value;

    if (command.kind === "override") {
      if (!overridesDbId) return apiError("Missing Route Overrides DB", { status: 500 });

      if (!command.routePath) {
        await disableOverride({ overridesDbId, pageId: command.pageId });
        return apiOk();
      }

      const out = await upsertOverride({
        overridesDbId,
        pageId: command.pageId,
        routePath: command.routePath,
      });
      return apiOk({ override: out });
    }

    if (command.kind === "protected") {
      if (!protectedDbId) return apiError("Missing Protected Routes DB", { status: 500 });
      // Product decision: protecting a page must protect its subtree (Super-like),
      // so we always store prefix rules.
      const mode = "prefix" as const;

      // Public = disable any protection rule for this page.
      if (command.authKind === "public") {
        await disableProtected({
          protectedDbId,
          pageId: command.pageId,
          path: command.path,
        });
        return apiOk();
      }

      // Disable password protection if password is blank.
      if (command.authKind === "password" && !command.password) {
        await disableProtected({
          protectedDbId,
          pageId: command.pageId,
          path: command.path,
        });
        return apiOk();
      }

      const out = await upsertProtected({
        protectedDbId,
        pageId: command.pageId,
        path: command.path,
        mode,
        password: command.password,
        auth: command.authKind,
      });
      return apiOk({ protected: out });
    }

    return apiError("Unsupported kind", { status: 400 });
  });
}
