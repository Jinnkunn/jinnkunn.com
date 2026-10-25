"use client";

import { Button } from "@/components/ui/button";
import type { PublicationReview } from "@/lib/shared/publication-snapshot";
import type { PublicationProblem } from "@/lib/shared/publication-validation";
import { SiteAdminActionDialog } from "./site-admin-action-dialog";
import { SiteAdminPublicationChanges } from "./site-admin-publication-changes";
import styles from "./site-admin-dashboard.module.css";

export function SiteAdminPublicationReviewDialog({ review, loading, error, busy, disabled, hasUnsaved, target, onClose, onRefresh, onConfirm, onIssue }: {
  review: PublicationReview | null; loading: boolean; error: string; busy: boolean;
  disabled: boolean; hasUnsaved: boolean; target: string;
  onClose: () => void; onRefresh: () => void; onConfirm: () => void;
  onIssue: (issue: PublicationProblem) => void;
}) {
  const blockers = review?.validation?.blockers || [];
  const warnings = review?.validation?.warnings || [];
  return <SiteAdminActionDialog title="Review publication" onClose={onClose} wide busy={busy}>
    <p className={styles.cardText}>Target: <strong>{target}</strong></p>
    <p className={styles.cardText}>This publishes all saved site content, including changes from other sessions.</p>
    {hasUnsaved ? <p role="alert">Save your open draft before confirming publication.</p> : null}
    {loading ? <p role="status">Comparing saved content with the published snapshot…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {blockers.length ? <section aria-label="Publication issues">
      <h3 className={styles.reviewHeading}>Needs attention before publishing</h3>
      <ul className={styles.reviewIssueList}>{blockers.map((issue, index) => <li key={`${issue.path}:${issue.entryId}:${issue.field}:${index}`}>
        <button type="button" onClick={() => onIssue(issue)}>{issue.path} · {issue.field}: {issue.message}</button>
      </li>)}</ul>
    </section> : null}
    {warnings.length ? <details><summary>{warnings.length} hidden draft {warnings.length === 1 ? "warning" : "warnings"}</summary><ul>{warnings.map((issue, index) => <li key={index}>{issue.path} · {issue.message}</li>)}</ul></details> : null}
    <h3 className={styles.reviewHeading}>Saved changes across the site</h3>
    <SiteAdminPublicationChanges changes={review?.changes || []} />
    {review?.changes.length === 0 ? <p className={styles.cardText}>All saved content matches the published snapshot.</p> : null}
    <div className={styles.conflictActions}>
      <Button variant="subtle" onClick={onClose}>Cancel</Button>
      <Button variant="subtle" disabled={loading || busy} onClick={onRefresh}>Refresh review</Button>
      <Button tone="accent" disabled={disabled || loading || Boolean(error) || !review?.changes.length || blockers.length > 0} onClick={onConfirm}>Confirm publish</Button>
    </div>
  </SiteAdminActionDialog>;
}
