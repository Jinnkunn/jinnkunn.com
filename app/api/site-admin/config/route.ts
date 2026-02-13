import type { NextRequest } from "next/server";

import { apiError, apiOk, withSiteAdmin } from "@/lib/server/site-admin-api";
import { mapNavigationRows, mapSiteSettingsRow } from "@/lib/server/site-admin-mappers";
import {
  createDatabaseRow,
  ensureDatabaseProperties,
  findSiteAdminDatabaseIdByTitle,
  loadSiteAdminDatabases,
  patchPageProperties,
} from "@/lib/server/site-admin-notion";
import {
  parseSiteAdminConfigCommand,
  parseSiteAdminJsonCommand,
} from "@/lib/server/site-admin-request";
import { buildNavCreateProperties, buildNavProperties, buildSiteSettingsProperties } from "@/lib/server/site-admin-writers";
import type { NavItemRow, SiteSettings } from "@/lib/site-admin/types";
import type {
  SiteAdminConfigGetPayload,
  SiteAdminConfigPostPayload,
} from "@/lib/site-admin/api-types";
import { queryDatabase } from "@/lib/notion/api";

export const runtime = "nodejs";

async function ensureSiteSettingsDbSchema(databaseId: string) {
  // Add missing properties lazily so /site-admin can run even if the admin DBs
  // were provisioned before we introduced new fields.
  await ensureDatabaseProperties(databaseId, {
    "Google Analytics ID": { rich_text: {} },
    "Content GitHub Users": { rich_text: {} },
  });
}


async function loadConfigFromNotion(): Promise<{ settings: SiteSettings | null; nav: NavItemRow[] }> {
  const { databases } = await loadSiteAdminDatabases();
  const settingsDbId = findSiteAdminDatabaseIdByTitle(databases, "Site Settings");
  const navDbId = findSiteAdminDatabaseIdByTitle(databases, "Navigation");

  let settings: SiteSettings | null = null;
  if (settingsDbId) {
    await ensureSiteSettingsDbSchema(settingsDbId);
    const rows = await queryDatabase(settingsDbId);
    settings = mapSiteSettingsRow(rows[0] ?? null);
  }

  const nav: NavItemRow[] = [];
  if (navDbId) {
    const rows = await queryDatabase(navDbId);
    nav.push(...mapNavigationRows(rows));
  }

  return { settings, nav };
}

async function updateSiteSettings(rowId: string, patch: Partial<Omit<SiteSettings, "rowId">>) {
  const properties = buildSiteSettingsProperties(patch);
  await patchPageProperties(rowId, properties);
}

async function getNavDbId(): Promise<string> {
  const { databases } = await loadSiteAdminDatabases();
  const navDbId = findSiteAdminDatabaseIdByTitle(databases, "Navigation");
  if (!navDbId) throw new Error("Missing Navigation database under Site Admin page");
  return navDbId;
}

async function updateNavRow(rowId: string, patch: Partial<Omit<NavItemRow, "rowId">>) {
  const properties = buildNavProperties(patch);
  await patchPageProperties(rowId, properties);
}

async function createNavRow(input: Omit<NavItemRow, "rowId">) {
  const navDbId = await getNavDbId();
  const createdId = await createDatabaseRow(navDbId, buildNavCreateProperties(input));
  const created: NavItemRow = { rowId: createdId, ...input };
  return created;
}

export async function GET(req: NextRequest) {
  return withSiteAdmin(req, async () => {
    const data = await loadConfigFromNotion();
    const payload: Omit<SiteAdminConfigGetPayload, "ok"> = data;
    return apiOk(payload);
  });
}

export async function POST(req: NextRequest) {
  return withSiteAdmin(req, async () => {
    const parsed = await parseSiteAdminJsonCommand(req, parseSiteAdminConfigCommand);
    if (!parsed.ok) return apiError(parsed.error, { status: parsed.status });
    const command = parsed.value;

    if (command.kind === "settings") {
      await updateSiteSettings(command.rowId, command.patch);
      return apiOk();
    }

    if (command.kind === "nav-update") {
      await updateNavRow(command.rowId, command.patch);
      return apiOk();
    }

    if (command.kind === "nav-create") {
      const created = await createNavRow(command.input);
      const payload: Omit<SiteAdminConfigPostPayload, "ok"> = { created };
      return apiOk(payload);
    }

    return apiError("Unknown kind", { status: 400 });
  });
}
