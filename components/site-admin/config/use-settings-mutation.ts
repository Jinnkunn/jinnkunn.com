"use client";

import type { SiteSettings } from "./types";
import { errorFromUnknown } from "./utils";
import { siteAdminBackend } from "@/lib/client/site-admin-backend";
import type { SiteAdminConfigSourceVersion } from "@/lib/site-admin/api-types";

type UseSiteAdminSettingsMutationArgs = {
  draftSettings: SiteSettings | null;
  setBusy: (value: boolean) => void;
  setErr: (value: string) => void;
  sourceVersion: SiteAdminConfigSourceVersion | null;
  setSourceVersion: (value: SiteAdminConfigSourceVersion) => void;
};

export function useSiteAdminSettingsMutation({
  draftSettings,
  setBusy,
  setErr,
  sourceVersion,
  setSourceVersion,
}: UseSiteAdminSettingsMutationArgs) {
  return async () => {
    if (!draftSettings?.rowId) return;
    if (!sourceVersion?.siteConfigSha) {
      setErr("Missing sourceVersion. Reload latest and try again.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const patch: Partial<Omit<SiteSettings, "rowId">> = {
        siteName: draftSettings.siteName,
        lang: draftSettings.lang,
        seoTitle: draftSettings.seoTitle,
        seoDescription: draftSettings.seoDescription,
        favicon: draftSettings.favicon,
        ogImage: draftSettings.ogImage,
        seoPageOverrides: draftSettings.seoPageOverrides,
        googleAnalyticsId: draftSettings.googleAnalyticsId,
        contentGithubUsers: draftSettings.contentGithubUsers,
        sitemapExcludes: draftSettings.sitemapExcludes,
        sitemapAutoExcludeEnabled: draftSettings.sitemapAutoExcludeEnabled,
        sitemapAutoExcludeSections: draftSettings.sitemapAutoExcludeSections,
        sitemapAutoExcludeDepthPages: draftSettings.sitemapAutoExcludeDepthPages,
        sitemapAutoExcludeDepthBlog: draftSettings.sitemapAutoExcludeDepthBlog,
        sitemapAutoExcludeDepthPublications: draftSettings.sitemapAutoExcludeDepthPublications,
        sitemapAutoExcludeDepthTeaching: draftSettings.sitemapAutoExcludeDepthTeaching,
        rootPageId: draftSettings.rootPageId,
        homePageId: draftSettings.homePageId,
      };
      const data = await siteAdminBackend.postConfig({
        kind: "settings",
        rowId: draftSettings.rowId,
        patch,
        expectedSiteConfigSha: sourceVersion.siteConfigSha,
      });
      setSourceVersion(data.sourceVersion);
    } catch (e: unknown) {
      setErr(errorFromUnknown(e));
    } finally {
      setBusy(false);
    }
  };
}
