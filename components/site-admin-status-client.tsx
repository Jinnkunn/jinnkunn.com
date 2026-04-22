"use client";

import { useSiteAdminStatusData } from "@/components/site-admin/status/use-status-data";
import { SiteAdminStatusView } from "@/components/site-admin/status/view";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusNotice } from "@/components/ui/status-notice";

type SiteAdminStatusClientProps = {
  showBanner?: boolean;
};

export default function SiteAdminStatusClient({
  showBanner = true,
}: SiteAdminStatusClientProps) {
  const {
    busy,
    res,
    payload,
    vercelLink,
    stale,
    generated,
    readiness,
    banner,
    load,
    deployBusy,
    deployRes,
    deploy,
  } = useSiteAdminStatusData();

  return (
    <section className="site-admin-status">
      <div className="site-admin-status__head">
        <SectionHeader
          title="Status"
          description="Quick sanity-check that content sync ran and this deploy is using the expected config."
        />

        <Button
          type="button"
          onClick={load}
          disabled={busy}
          variant="ghost"
          className="site-admin-status__refresh"
        >
          {busy ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {res && "ok" in res && !res.ok ? (
        <StatusNotice className="site-admin-status__error" tone="danger">
          {res.error}
        </StatusNotice>
      ) : null}

      {payload ? (
        <SiteAdminStatusView
          payload={payload}
          banner={showBanner ? banner : null}
          vercelLink={vercelLink}
          stale={stale}
          generated={generated}
          readiness={readiness}
          deployBusy={deployBusy}
          deployRes={deployRes}
          onDeploy={deploy}
        />
      ) : null}
    </section>
  );
}
