import "server-only";

import { queryDatabase } from "@/lib/notion/api";
import { mapNavigationRows, mapSiteSettingsRow } from "@/lib/server/site-admin-mappers";
import {
  createDatabaseRow,
  ensureDatabaseProperties,
  findSiteAdminDatabaseIdByTitle,
  loadSiteAdminDatabases,
  patchPageProperties,
} from "@/lib/server/site-admin-notion";
import {
  buildNavCreateProperties,
  buildNavProperties,
  buildSiteSettingsProperties,
} from "@/lib/server/site-admin-writers";
import type { NavItemRow, SiteSettings } from "@/lib/site-admin/types";

type SiteAdminConfigData = {
  settings: SiteSettings | null;
  nav: NavItemRow[];
};

async function ensureSiteSettingsDbSchema(databaseId: string) {
  // Add missing properties lazily so /site-admin can run even if the admin DBs
  // were provisioned before we introduced new fields.
  await ensureDatabaseProperties(databaseId, {
    "OG Image": { rich_text: {} },
    "Google Analytics ID": { rich_text: {} },
    "Content GitHub Users": { rich_text: {} },
    "Sitemap Excludes": { rich_text: {} },
    "Sitemap Auto Exclude Enabled": { checkbox: {} },
    "Sitemap Auto Exclude Sections": { rich_text: {} },
    "Sitemap Max Depth Pages": { number: { format: "number" } },
    "Sitemap Max Depth Blog": { number: { format: "number" } },
    "Sitemap Max Depth Publications": { number: { format: "number" } },
    "Sitemap Max Depth Teaching": { number: { format: "number" } },
  });
}

async function getNavDbId(): Promise<string> {
  const { databases } = await loadSiteAdminDatabases();
  const navDbId = findSiteAdminDatabaseIdByTitle(databases, "Navigation");
  if (!navDbId) throw new Error("Missing Navigation database under Site Admin page");
  return navDbId;
}

export async function loadSiteAdminConfigData(): Promise<SiteAdminConfigData> {
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

export async function updateSiteSettingsRow(
  rowId: string,
  patch: Partial<Omit<SiteSettings, "rowId">>,
): Promise<void> {
  const properties = buildSiteSettingsProperties(patch);
  await patchPageProperties(rowId, properties);
}

export async function updateSiteNavRow(
  rowId: string,
  patch: Partial<Omit<NavItemRow, "rowId">>,
): Promise<void> {
  const properties = buildNavProperties(patch);
  await patchPageProperties(rowId, properties);
}

export async function createSiteNavRow(
  input: Omit<NavItemRow, "rowId">,
): Promise<NavItemRow> {
  const navDbId = await getNavDbId();
  const createdId = await createDatabaseRow(navDbId, buildNavCreateProperties(input));
  return { rowId: createdId, ...input };
}
