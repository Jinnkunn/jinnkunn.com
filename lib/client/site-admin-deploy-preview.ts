import { siteAdminBackend } from "@/lib/client/site-admin-backend";
import type { SiteAdminDeployPreviewResult } from "@jinnkunn/contracts/api";

export async function fetchSiteAdminDeployPreview(): Promise<SiteAdminDeployPreviewResult> {
  try {
    const data = await siteAdminBackend.getDeployPreview();
    return data;
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Request failed",
      code: "REQUEST_FAILED",
    };
  }
}
