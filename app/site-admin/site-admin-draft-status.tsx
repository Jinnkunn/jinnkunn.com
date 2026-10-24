import { Button } from "@/components/ui/button";
import styles from "./site-admin-dashboard.module.css";

export function SiteAdminDraftStatus({ dirty, saving, pending, live, failed, needsReview, storageFailed, localSavedAt, savedAt, recovery, onRetry, onRestore, onDismiss, onReview }: {
  dirty: boolean; saving: boolean; pending: boolean; live?: boolean; failed?: boolean; needsReview?: boolean; storageFailed?: boolean;
  localSavedAt?: string; savedAt?: string; recovery?: { savedAt: string } | null;
  onRetry: () => void; onRestore?: () => void; onDismiss?: () => void;
  onReview?: () => void;
}) {
  const state = saving ? "Saving draft…" : needsReview ? "Review recovered edits before saving" : failed ? "Draft save failed" : dirty ? localSavedAt ? "Saved on this device only" : "Unsaved edits" : pending ? "Draft saved · not yet published" : live ? "Saved · matches the published site" : "Draft saved";
  return <div className={styles.draftStatus} aria-label="Draft status">
    <p role="status" aria-live="polite"><strong>{state}</strong>{savedAt && !dirty ? <small>Saved {new Date(savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small> : null}</p>
    {storageFailed ? <p role="alert">Local recovery is unavailable in this browser. Keep this page open until the draft is saved.</p> : null}
    {failed ? <Button onClick={onRetry} disabled={saving} variant="subtle" size="sm">Retry save</Button> : null}
    {pending && !dirty && !saving && onReview ? <Button onClick={onReview} variant="subtle" size="sm">Review publication</Button> : null}
    {recovery ? <div className={styles.linkRow}>
      <span>Local edits from {new Date(recovery.savedAt).toLocaleString()} are available.</span>
      <Button onClick={onRestore} disabled={saving} variant="subtle" size="sm">Restore local edits</Button>
      <Button onClick={onDismiss} disabled={saving} variant="ghost" size="sm">Discard local copy</Button>
    </div> : null}
  </div>;
}
