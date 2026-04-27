import "server-only";

import {
  getSiteAdminSourceStore,
  type SiteAdminConfigSourceVersion,
} from "@/lib/server/site-admin-source-store";
import type { NavItemRow, SiteSettings } from "@/lib/site-admin/types";

type SiteAdminConfigData = {
  settings: SiteSettings | null;
  nav: NavItemRow[];
  sourceVersion: SiteAdminConfigSourceVersion;
};

const sourceStore = getSiteAdminSourceStore();

export async function loadSiteAdminConfigData(): Promise<SiteAdminConfigData> {
  const data = await sourceStore.loadConfig();
  return {
    settings: data.settings,
    nav: data.nav,
    sourceVersion: data.sourceVersion,
  };
}

export async function updateSiteSettingsRow(
  rowId: string,
  patch: Partial<Omit<SiteSettings, "rowId">>,
  expectedSiteConfigSha: string,
  allowStaleSiteConfigSha = false,
): Promise<SiteAdminConfigSourceVersion> {
  return sourceStore.updateSettings({
    rowId,
    patch,
    expectedSiteConfigSha,
    allowStaleSiteConfigSha,
  });
}

export async function updateSiteNavRow(
  rowId: string,
  patch: Partial<Omit<NavItemRow, "rowId">>,
  expectedSiteConfigSha: string,
): Promise<SiteAdminConfigSourceVersion> {
  return sourceStore.updateNavRow({
    rowId,
    patch,
    expectedSiteConfigSha,
  });
}

export async function createSiteNavRow(
  input: Omit<NavItemRow, "rowId">,
  expectedSiteConfigSha: string,
): Promise<{ created: NavItemRow; sourceVersion: SiteAdminConfigSourceVersion }> {
  return sourceStore.createNavRow({
    row: input,
    expectedSiteConfigSha,
  });
}
