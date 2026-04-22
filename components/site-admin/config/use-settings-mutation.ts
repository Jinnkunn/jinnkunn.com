"use client";

import type { Dispatch, SetStateAction } from "react";

import type { SiteSettings } from "./types";
import { errorFromUnknown } from "./utils";
import { isRequestJsonError, requestJsonOrThrow } from "@/lib/client/request-json";
import type { SiteAdminSourceVersion } from "@/lib/site-admin/api-types";
import { isSiteAdminConfigPostOk, parseSiteAdminConfigPost } from "@/lib/site-admin/config-contract";
import type { SiteAdminEditorResultState } from "@/lib/site-admin/editor-state";
import { mapEditorErrorToResult } from "@/lib/site-admin/editor-state";

type UseSiteAdminSettingsMutationArgs = {
  draftSettings: SiteSettings | null;
  sourceVersion: SiteAdminSourceVersion | null;
  setSourceVersion: Dispatch<SetStateAction<SiteAdminSourceVersion | null>>;
  setSavedSettings: Dispatch<SetStateAction<SiteSettings | null>>;
  setEditorResult: Dispatch<SetStateAction<SiteAdminEditorResultState>>;
  setBusy: (value: boolean) => void;
  conflictLocked: boolean;
};

export function useSiteAdminSettingsMutation({
  draftSettings,
  sourceVersion,
  setSourceVersion,
  setSavedSettings,
  setEditorResult,
  setBusy,
  conflictLocked,
}: UseSiteAdminSettingsMutationArgs) {
  return async () => {
    if (!draftSettings?.rowId || conflictLocked) return;
    setBusy(true);
    setEditorResult({
      kind: "saving",
      message: "Saving site settings to GitHub main...",
    });
    try {
      const patch: Record<string, unknown> = {
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
      const result = await requestJsonOrThrow(
        "/api/site-admin/config",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "settings",
            rowId: draftSettings.rowId,
            expectedSiteConfigSha: sourceVersion?.siteConfigSha || "",
            patch,
          }),
        },
        parseSiteAdminConfigPost,
        { isOk: isSiteAdminConfigPostOk },
      );
      setSourceVersion(result.sourceVersion);
      setSavedSettings({ ...draftSettings });
      setEditorResult({
        kind: "saved",
        message: "Site settings saved to GitHub main. Deploy from Site Admin when ready.",
      });
    } catch (e: unknown) {
      setEditorResult(
        mapEditorErrorToResult({
          code: isRequestJsonError(e) ? e.code : "",
          message: errorFromUnknown(e),
          conflictMessage: "Source changed on GitHub. Reload latest before saving again.",
        }),
      );
    } finally {
      setBusy(false);
    }
  };
}
