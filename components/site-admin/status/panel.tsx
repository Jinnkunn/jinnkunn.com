"use client";

import { LoadingState } from "@/components/ui/loading-state";
import { SiteAdminStatusView } from "@/components/site-admin/status/view";
import { useSiteAdminStatusData } from "@/components/site-admin/status/use-status-data";
import styles from "./status-panel.module.css";

/**
 * Renders build, content-sync, and diagnostics state inside the console so the
 * author never has to leave a page with unsaved edits to read raw API JSON.
 */
export function SiteAdminStatusPanel() {
  const {
    busy,
    res,
    payload,
    deploymentLink,
    stale,
    generated,
    readiness,
    banner,
    deployBusy,
    deployRes,
    deploy,
  } = useSiteAdminStatusData();

  if (!payload) {
    if (busy) return <LoadingState label="Loading status…" />;
    const message =
      res && res.ok === false ? res.error : "Status is not available right now.";
    return <p className={styles.error}>{message}</p>;
  }

  return (
    <div className={styles.panel}>
      <SiteAdminStatusView
        payload={payload}
        banner={banner}
        deploymentLink={deploymentLink}
        stale={stale}
        generated={generated}
        readiness={readiness}
        deployBusy={deployBusy}
        deployRes={deployRes}
        onDeploy={() => void deploy()}
      />
    </div>
  );
}
