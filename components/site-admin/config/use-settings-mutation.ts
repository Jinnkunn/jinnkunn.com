"use client";

import type { SiteSettings } from "./types";
import { errorFromUnknown } from "./utils";
import { siteAdminBackend } from "@/lib/client/site-admin-backend";
import type { SiteAdminConfigSourceVersion } from "@jinnkunn/contracts/api";

type UseSiteAdminSettingsMutationArgs = {
  draftSettings: SiteSettings | null;
  setBusy: (value: boolean) => void;
  setErr: (value: string) => void;
  sourceVersion: SiteAdminConfigSourceVersion | null;
  setSourceVersion: (value: SiteAdminConfigSourceVersion) => void;
  /** Receives the settings that were actually persisted, for dirty tracking. */
  onSaved?: (saved: SiteSettings) => void;
};

export function useSiteAdminSettingsMutation({
  draftSettings,
  setBusy,
  setErr,
  sourceVersion,
  setSourceVersion,
  onSaved,
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
        monochromeEnabled: draftSettings.monochromeEnabled,
        monochromeScope: draftSettings.monochromeScope,
        monochromeDesaturateMedia: draftSettings.monochromeDesaturateMedia,
        monochromeStartsAt: draftSettings.monochromeStartsAt,
        monochromeEndsAt: draftSettings.monochromeEndsAt,
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
      onSaved?.({ ...draftSettings });
    } catch (e: unknown) {
      setErr(errorFromUnknown(e));
    } finally {
      setBusy(false);
    }
  };
}
