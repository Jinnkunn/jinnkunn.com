import "server-only";

import { queryDatabase } from "@/lib/notion/api";
import { resolveContentSourceKind } from "@/lib/shared/content-source";
import { mapNavigationRows, mapSiteSettingsRow } from "@/lib/server/site-admin-mappers";
import {
  appendNavRowToSourceConfig,
  applyNavPatchToSourceConfig,
  applySiteSettingsPatchToSourceConfig,
  mapSourceConfigToSiteAdminConfigData,
} from "@/lib/server/filesystem-source";
import { getSiteAdminSourceStore } from "@/lib/server/site-admin-source-store";
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
import type { SiteAdminSourceVersion } from "@/lib/site-admin/api-types";
import type { NavItemRow, SiteSettings } from "@/lib/site-admin/types";

type SiteAdminConfigData = {
  settings: SiteSettings | null;
  nav: NavItemRow[];
  sourceVersion: SiteAdminSourceVersion;
};

const EMPTY_SOURCE_VERSION: SiteAdminSourceVersion = {
  branchSha: "",
  siteConfigSha: "",
  protectedRoutesSha: "",
  routesManifestSha: "",
};
const FILESYSTEM_SETTINGS_ROW_ID = "filesystem-site-settings";

async function ensureSiteSettingsDbSchema(databaseId: string) {
  // Add missing properties lazily so /site-admin can run even if the admin DBs
  // were provisioned before we introduced new fields.
  await ensureDatabaseProperties(databaseId, {
    "OG Image": { rich_text: {} },
    "SEO Page Overrides": { rich_text: {} },
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
  if (resolveContentSourceKind() === "filesystem") {
    const snapshot = await getSiteAdminSourceStore().getSnapshot();
    return {
      ...mapSourceConfigToSiteAdminConfigData(snapshot.siteConfig),
      sourceVersion: snapshot.version,
    };
  }

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

  return { settings, nav, sourceVersion: EMPTY_SOURCE_VERSION };
}

export async function updateSiteSettingsRow(
  rowId: string,
  expectedSiteConfigSha: string,
  patch: Partial<Omit<SiteSettings, "rowId">>,
): Promise<{ sourceVersion: SiteAdminSourceVersion }> {
  if (resolveContentSourceKind() === "filesystem") {
    if (String(rowId || "").trim() !== FILESYSTEM_SETTINGS_ROW_ID) {
      throw new Error("Unknown filesystem settings row");
    }
    const store = getSiteAdminSourceStore();
    const snapshot = await store.getSnapshot();
    const nextSiteConfig = applySiteSettingsPatchToSourceConfig(snapshot.siteConfig, patch);
    const saved = await store.writeSiteConfig({
      expectedSiteConfigSha,
      nextSiteConfig,
      commitMessage: "site-admin: update site settings",
    });
    return { sourceVersion: saved.version };
  }

  const properties = buildSiteSettingsProperties(patch);
  await patchPageProperties(rowId, properties);
  return { sourceVersion: EMPTY_SOURCE_VERSION };
}

export async function updateSiteNavRow(
  rowId: string,
  expectedSiteConfigSha: string,
  patch: Partial<Omit<NavItemRow, "rowId">>,
): Promise<{ sourceVersion: SiteAdminSourceVersion }> {
  if (resolveContentSourceKind() === "filesystem") {
    const store = getSiteAdminSourceStore();
    const snapshot = await store.getSnapshot();
    const nextSiteConfig = applyNavPatchToSourceConfig(snapshot.siteConfig, rowId, patch);
    const saved = await store.writeSiteConfig({
      expectedSiteConfigSha,
      nextSiteConfig,
      commitMessage: "site-admin: update navigation",
    });
    return { sourceVersion: saved.version };
  }

  const properties = buildNavProperties(patch);
  await patchPageProperties(rowId, properties);
  return { sourceVersion: EMPTY_SOURCE_VERSION };
}

export async function createSiteNavRow(
  expectedSiteConfigSha: string,
  input: Omit<NavItemRow, "rowId">,
): Promise<{ created: NavItemRow; sourceVersion: SiteAdminSourceVersion }> {
  if (resolveContentSourceKind() === "filesystem") {
    const store = getSiteAdminSourceStore();
    const snapshot = await store.getSnapshot();
    const next = appendNavRowToSourceConfig(snapshot.siteConfig, input);
    const saved = await store.writeSiteConfig({
      expectedSiteConfigSha,
      nextSiteConfig: next.sourceConfig,
      commitMessage: "site-admin: add navigation item",
    });
    return { created: next.created, sourceVersion: saved.version };
  }

  const navDbId = await getNavDbId();
  const createdId = await createDatabaseRow(navDbId, buildNavCreateProperties(input));
  return {
    created: { rowId: createdId, ...input },
    sourceVersion: EMPTY_SOURCE_VERSION,
  };
}
