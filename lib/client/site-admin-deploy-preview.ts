import { requestJsonOrThrow } from "@/lib/client/request-json";
import type { SiteAdminDeployPreviewResult } from "@/lib/site-admin/api-types";
import {
  isSiteAdminDeployPreviewOk,
  parseSiteAdminDeployPreviewResult,
} from "@/lib/site-admin/deploy-preview-contract";

export async function fetchSiteAdminDeployPreview(): Promise<SiteAdminDeployPreviewResult> {
  try {
    const data = await requestJsonOrThrow(
      "/api/site-admin/deploy-preview",
      {
        cache: "no-store",
      },
      parseSiteAdminDeployPreviewResult,
      { isOk: isSiteAdminDeployPreviewOk },
    );
    return data;
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Request failed",
      code: "REQUEST_FAILED",
    };
  }
}
