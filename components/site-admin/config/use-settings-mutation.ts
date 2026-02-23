"use client";

import type { SiteSettings } from "./types";
import { errorFromUnknown, isApiOk } from "./utils";
import { requestJsonOrThrow } from "@/lib/client/request-json";
import { asApiAck } from "@/lib/client/api-guards";

type UseSiteAdminSettingsMutationArgs = {
  draftSettings: SiteSettings | null;
  setBusy: (value: boolean) => void;
  setErr: (value: string) => void;
};

export function useSiteAdminSettingsMutation({
  draftSettings,
  setBusy,
  setErr,
}: UseSiteAdminSettingsMutationArgs) {
  return async () => {
    if (!draftSettings?.rowId) return;
    setBusy(true);
    setErr("");
    try {
      const patch: Record<string, unknown> = {
        siteName: draftSettings.siteName,
        lang: draftSettings.lang,
        seoTitle: draftSettings.seoTitle,
        seoDescription: draftSettings.seoDescription,
        favicon: draftSettings.favicon,
        googleAnalyticsId: draftSettings.googleAnalyticsId,
        contentGithubUsers: draftSettings.contentGithubUsers,
        sitemapExcludes: draftSettings.sitemapExcludes,
        rootPageId: draftSettings.rootPageId,
        homePageId: draftSettings.homePageId,
      };
      await requestJsonOrThrow(
        "/api/site-admin/config",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: "settings", rowId: draftSettings.rowId, patch }),
        },
        asApiAck,
        { isOk: isApiOk },
      );
    } catch (e: unknown) {
      setErr(errorFromUnknown(e));
    } finally {
      setBusy(false);
    }
  };
}
