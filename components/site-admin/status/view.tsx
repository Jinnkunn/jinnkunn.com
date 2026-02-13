"use client";

import type { StatusPayload } from "@/components/site-admin/status/types";
import { SiteAdminStatusBanner } from "@/components/site-admin/status/banner";
import { SiteAdminBuildCard } from "@/components/site-admin/status/build-card";
import { SiteAdminContentSyncCard } from "@/components/site-admin/status/content-sync-card";
import { SiteAdminRequirementsCard } from "@/components/site-admin/status/admin-requirements-card";
import { SiteAdminGeneratedFilesCard } from "@/components/site-admin/status/generated-files-card";
import type {
  BannerState,
  GeneratedState,
  ReadinessState,
  StatusFreshness,
} from "@/lib/site-admin/status-model";

type SiteAdminStatusViewProps = {
  payload: StatusPayload;
  banner: BannerState | null;
  vercelLink: string;
  stale: StatusFreshness;
  generated: GeneratedState;
  readiness: ReadinessState;
};

export function SiteAdminStatusView({
  payload,
  banner,
  vercelLink,
  stale,
  generated,
  readiness,
}: SiteAdminStatusViewProps) {
  return (
    <>
      {banner ? <SiteAdminStatusBanner payload={payload} banner={banner} /> : null}
      <div className="site-admin-status__grid">
        <SiteAdminBuildCard payload={payload} vercelLink={vercelLink} />
        <SiteAdminContentSyncCard payload={payload} stale={stale} generated={generated} />
        <SiteAdminRequirementsCard payload={payload} readiness={readiness} />
        <SiteAdminGeneratedFilesCard payload={payload} />
      </div>
    </>
  );
}
