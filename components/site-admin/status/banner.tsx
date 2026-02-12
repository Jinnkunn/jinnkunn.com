"use client";

import Link from "next/link";

import type { BannerState } from "@/components/site-admin/status/use-status-data";
import type { StatusPayload } from "@/components/site-admin/status/types";

type SiteAdminStatusBannerProps = {
  payload: StatusPayload;
  banner: BannerState;
};

export function SiteAdminStatusBanner({ payload, banner }: SiteAdminStatusBannerProps) {
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
          <Link className="site-admin-status__banner-link" href="/site-admin">
            Deploy
          </Link>
        </div>
      ) : null}
    </div>
  );
}
