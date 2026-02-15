"use client";

import type { StatusPayload } from "@/components/site-admin/status/types";
import type { SiteAdminDeployResult } from "@/lib/site-admin/api-types";
import type { BannerState } from "@/lib/site-admin/status-model";

type SiteAdminStatusBannerProps = {
  payload: StatusPayload;
  banner: BannerState;
  deployBusy: boolean;
  deployRes: SiteAdminDeployResult | null;
  onDeploy: () => void;
};

export function SiteAdminStatusBanner({
  payload,
  banner,
  deployBusy,
  deployRes,
  onDeploy,
}: SiteAdminStatusBannerProps) {
  return (
    <div
      className={`site-admin-status__banner ${
        banner.kind === "ok" ? "site-admin-status__banner--ok" : "site-admin-status__banner--warn"
      }`}
      role={banner.kind === "ok" ? "status" : "alert"}
    >
      <div className="site-admin-status__banner-title">{banner.title}</div>
      <div className="site-admin-status__banner-detail">{banner.detail}</div>
      {banner.kind !== "ok" && payload.env.hasDeployHookUrl ? (
        <div className="site-admin-status__banner-cta">
          <button
            type="button"
            className="site-admin-status__banner-button"
            onClick={onDeploy}
            disabled={deployBusy}
          >
            {deployBusy ? "Deploying..." : "Deploy"}
          </button>
          {deployRes ? (
            <span
              className={`site-admin-status__banner-feedback ${
                deployRes.ok
                  ? "site-admin-status__banner-feedback--ok"
                  : "site-admin-status__banner-feedback--error"
              }`}
            >
              {deployRes.ok ? `Triggered at ${deployRes.triggeredAt}` : deployRes.error}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
