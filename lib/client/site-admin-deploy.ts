import { requestJsonOrThrow } from "@/lib/client/request-json";
import type { SiteAdminDeployResult } from "@/lib/site-admin/api-types";
import {
  isSiteAdminDeployOk,
  parseSiteAdminDeployResult,
} from "@/lib/site-admin/deploy-contract";

export async function triggerSiteAdminDeploy(): Promise<SiteAdminDeployResult> {
  try {
    const data = await requestJsonOrThrow(
      "/api/site-admin/deploy",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
      },
      parseSiteAdminDeployResult,
      { isOk: isSiteAdminDeployOk },
    );
    return data;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Request failed" };
  }
}
