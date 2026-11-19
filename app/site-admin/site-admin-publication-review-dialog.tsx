"use client";

import { Button } from "@/components/ui/button";
import { useEffect, useId, useState } from "react";
import type { PublicationReview } from "@/lib/shared/publication-snapshot";
import type { PublicationProblem } from "@/lib/shared/publication-validation";
import { SiteAdminActionDialog } from "./site-admin-action-dialog";
import { SiteAdminPublicationChanges } from "./site-admin-publication-changes";
import styles from "./site-admin-dashboard.module.css";

export function SiteAdminPublicationReviewDialog({ review, loading, error, busy, disabled, hasUnsaved, target, initialScope, readScope, onClose, onRefresh, onConfirm, onIssue }: {
  review: PublicationReview | null; loading: boolean; error: string; busy: boolean;
  disabled: boolean; hasUnsaved: boolean; target: string;
  initialScope: string;
  readScope: (scope: string, signal: AbortSignal) => Promise<PublicationReview>;
  onClose: () => void; onRefresh: () => void; onConfirm: (review: PublicationReview) => void;
  onIssue: (issue: PublicationProblem) => void;
}) {
  const [scope, setScope] = useState(initialScope);
  const scopeId = useId();
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; review?: PublicationReview; error?: string }>();
  const scoped = Boolean(scope && scope !== "all");
  const options = review?.availableScopes || [];
  const canReadScope = scoped && options.some((option) => option.id === scope);
  const unavailable = scoped && Boolean(review) && !canReadScope;
  const needsSelection = !scope || unavailable;
  const key = `${scope}:${review?.baselineSha}:${review?.snapshotSha}:${refresh}`;
  useEffect(() => {
    if (!canReadScope || loading) return;
    const request = new AbortController();
    void readScope(scope, request.signal).then(
      (next) => { if (!request.signal.aborted) setLoaded({ key, review: next }); },
      (failure) => { if (!request.signal.aborted) setLoaded({ key, error: failure instanceof Error ? failure.message : String(failure) }); },
    );
    return () => request.abort();
  }, [scope, canReadScope, key, loading, readScope]);
  const result = canReadScope && loaded?.key === key ? loaded : undefined;
  const active = scope === "all" ? review : result?.review;
  const waiting = loading || (canReadScope && !result);
  const activeError = error || result?.error;
  const blockers = active?.validation?.blockers || [];
  const warnings = active?.validation?.warnings || [];
  return <SiteAdminActionDialog title="Review publication" onClose={onClose} wide busy={busy}>
    <p className={styles.cardText}>Target: <strong>{target}</strong></p>
    <div className={styles.publicationScope}>
      <label htmlFor={scopeId}>Changes to publish</label>
      <select id={scopeId} value={scope} disabled={busy || loading} onChange={(event) => { setLoaded(undefined); setScope(event.target.value); }}>
        {!scope ? <option value="">Choose an update</option> : null}
        {scoped && !canReadScope ? <option value={scope}>Current edit</option> : null}
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        <option value="all">All saved changes ({review?.pendingChangeCount ?? review?.changes.length ?? 0})</option>
      </select>
    </div>
    {scope === "all" ? <p className={styles.cardText}>Includes saved changes from all sessions. Page moves, removals and site structure changes are reviewed together here.</p>
      : canReadScope ? <p className={styles.cardText}>Only the changes shown here will go live. Other drafts stay saved.</p> : null}
    {!waiting && unavailable ? <p role="status">This edit has no independent saved update. Choose another update or explicitly review all saved changes.</p> : null}
    {hasUnsaved ? <p role="alert">Save your open draft before confirming publication.</p> : null}
    {waiting ? <p role="status">Comparing saved content with the published snapshot…</p> : null}
    {activeError ? <p role="alert">{activeError}</p> : null}
    {blockers.length ? <section aria-label="Publication issues">
      <h3 className={styles.reviewHeading}>Needs attention before publishing</h3>
      <ul className={styles.reviewIssueList}>{blockers.map((issue, index) => <li key={`${issue.path}:${issue.entryId}:${issue.field}:${index}`}>
        <button type="button" onClick={() => onIssue(issue)}>{issue.path} · {issue.field}: {issue.message}</button>
      </li>)}</ul>
    </section> : null}
    {warnings.length ? <details><summary>{warnings.length} hidden draft {warnings.length === 1 ? "warning" : "warnings"}</summary><ul>{warnings.map((issue, index) => <li key={index}>{issue.path} · {issue.message}</li>)}</ul></details> : null}
    {!needsSelection ? <>
      <h3 className={styles.reviewHeading}>{scoped ? "Selected changes" : "Saved changes across the site"}</h3>
      <SiteAdminPublicationChanges changes={waiting ? [] : active?.changes || []} />
    </> : null}
    {!waiting && active?.changes.length === 0 ? <p className={styles.cardText}>No saved changes to publish in this selection.</p> : null}
    <div className={styles.conflictActions}>
      <Button variant="subtle" onClick={onClose}>Cancel</Button>
      <Button variant="subtle" disabled={waiting || busy} onClick={() => { setRefresh((value) => value + 1); onRefresh(); }}>Refresh review</Button>
      <Button tone="accent" disabled={disabled || needsSelection || waiting || Boolean(activeError) || !active?.changes.length || blockers.length > 0} onClick={() => active && onConfirm(active)}>{scope === "all" ? "Publish all changes" : "Publish selection"}</Button>
    </div>
  </SiteAdminActionDialog>;
}
