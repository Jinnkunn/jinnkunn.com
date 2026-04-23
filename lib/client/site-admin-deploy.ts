import { siteAdminBackend } from "@/lib/client/site-admin-backend";
import type { SiteAdminDeployResult } from "@/lib/site-admin/api-types";

export async function triggerSiteAdminDeploy(): Promise<SiteAdminDeployResult> {
  try {
    const data = await siteAdminBackend.postDeploy();
    return data;
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Request failed",
      code: "REQUEST_FAILED",
    };
  }
}
