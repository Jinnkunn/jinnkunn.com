"use client";

import { Button } from "@/components/ui/button";
import styles from "./site-admin-dashboard.module.css";

export type SiteAdminConflict = {
  title: string;
  localSource: string;
  remoteSource: string;
  detail?: string;
};

export function SiteAdminConflictDialog({
  conflict,
  busy,
  onReload,
  onKeepMine,
  onClose,
}: {
  conflict: SiteAdminConflict;
  busy: boolean;
  onReload: () => void;
  onKeepMine: () => void;
  onClose: () => void;
}) {
  return (
    <div className={styles.drawerScrim} role="presentation">
      <section
        className={styles.conflictDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="site-admin-conflict-title"
      >
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.cardLabel}>Edit conflict</p>
            <h2 id="site-admin-conflict-title" className={styles.panelTitle}>
              {conflict.title} changed elsewhere
            </h2>
          </div>
          <Button onClick={onClose} variant="ghost" size="sm" disabled={busy}>
            Close
          </Button>
        </div>
        <p className={styles.cardText}>
          {conflict.detail ||
            "Compare both versions before choosing which content should become the latest Draft."}
        </p>
        <div className={styles.versionCompareGrid}>
          <label>
            <span>Your edits</span>
            <textarea readOnly value={conflict.localSource} />
          </label>
          <label>
            <span>Latest saved version</span>
            <textarea readOnly value={conflict.remoteSource} />
          </label>
        </div>
        <div className={styles.conflictActions}>
          <Button onClick={onReload} variant="subtle" disabled={busy}>
            Reload latest
          </Button>
          <Button onClick={onKeepMine} tone="accent" disabled={busy}>
            {busy ? "Saving" : "Keep my edits"}
          </Button>
        </div>
      </section>
    </div>
  );
}
