"use client";
import { Button } from "@/components/ui/button";
import { SiteAdminActionDialog } from "./site-admin-action-dialog";
import type { SiteAdminNavigationGuard } from "./use-site-admin-navigation-guard";
import styles from "./site-admin-dashboard.module.css";

export function SiteAdminNavigationDialog({ guard }: { guard: SiteAdminNavigationGuard }) {
  if (!guard.prompt) return null;
  const busy = guard.prompt.phase !== "choice";
  return <SiteAdminActionDialog title="Unsaved changes" onClose={guard.stay} busy={guard.prompt.phase === "saving"}>
    <p role={busy ? "status" : undefined}>{guard.prompt.phase === "waiting" ? "Finishing the current save…" : guard.prompt.phase === "saving" ? "Saving the draft before continuing…" : "Save this draft before leaving?"}</p>
    {guard.prompt.error ? <p role="alert">{guard.prompt.error}</p> : null}
    <div className={styles.conflictActions}>
      <Button variant="subtle" onClick={guard.stay} disabled={guard.prompt.phase === "saving"}>Stay here</Button>
      <Button variant="ghost" tone="danger" onClick={guard.discardAndContinue} disabled={busy}>Discard changes</Button>
      <Button tone="accent" onClick={() => void guard.saveAndContinue()} disabled={busy}>Save and continue</Button>
    </div>
  </SiteAdminActionDialog>;
}
