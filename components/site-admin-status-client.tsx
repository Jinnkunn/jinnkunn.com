"use client";

import { useSiteAdminStatusData } from "@/components/site-admin/status/use-status-data";
import { SiteAdminStatusView } from "@/components/site-admin/status/view";

export default function SiteAdminStatusClient() {
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
        <div>
          <h2 className="notion-heading notion-semantic-string" style={{ margin: 0 }}>
            Status
          </h2>
          <p className="notion-text notion-text__content notion-semantic-string" style={{ marginTop: 6 }}>
            Quick sanity-check that content sync ran and this deploy is using the expected config.
          </p>
        </div>

        <button
          type="button"
          onClick={load}
          disabled={busy}
          className="site-admin-status__refresh"
        >
          {busy ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {res && "ok" in res && !res.ok ? (
        <div className="site-admin-status__error">{res.error}</div>
      ) : null}

      {payload ? (
        <SiteAdminStatusView
          payload={payload}
          banner={banner}
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
