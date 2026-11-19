import type { SiteAdminReleaseJobLike, SiteAdminReleaseProgress } from "@/lib/site-admin/release-progress";
import { Button } from "@/components/ui/button";
import type { ReleaseJobOutcome } from "./site-admin-console-model";
import styles from "./site-admin-dashboard.module.css";

export type PublicationAttempt = {
  origin: string;
  job: SiteAdminReleaseJobLike;
  outcome?: Exclude<ReleaseJobOutcome, { state: "active" }>;
  wakePending?: boolean;
};

export function SiteAdminPublicationStatus({ draftVersion, liveVersion, attempt, progress, onReview, onActivity }: {
  draftVersion?: string;
  liveVersion?: string;
  attempt?: PublicationAttempt | null;
  progress?: SiteAdminReleaseProgress | null;
  onReview: () => void;
  onActivity: () => void;
}) {
  if (!draftVersion && !liveVersion && !attempt) return null;
  const outcome = attempt?.outcome;
  const failure = outcome?.state === "failed" || outcome?.state === "canceled";
  const verified = outcome?.state === "succeeded" ? outcome.verifiedPublicationSha : "";
  const stage = outcome?.state === "failed" ? (outcome.failurePhase ? `${outcome.failurePhase} failed` : "Runner reported a failure")
    : outcome?.state === "canceled" ? "Publishing canceled"
      : verified ? `Published snapshot ${verified.slice(0, 8)}`
        : outcome?.state === "succeeded" ? "Live verification not reported"
          : progress?.stage === "queued" ? "Queued for the runner"
            : progress?.label || "Queued for the runner";
  const awaitingRunner = !outcome && progress?.stage === "queued" && (attempt?.wakePending || progress.runnerState !== "online");

  return (
    <section className={styles.publicationReceipt} aria-label="Publication status">
      {draftVersion || liveVersion ? (
        <div className={styles.publicationVersions}>
          {draftVersion ? <span>Saved draft <code title={draftVersion}>{draftVersion.slice(0, 8)}</code></span> : null}
          <span>Live snapshot {liveVersion ? <code title={liveVersion}>{liveVersion.slice(0, 8)}</code> : <span>Not confirmed</span>}</span>
        </div>
      ) : null}
      {attempt ? (
        <div className={styles.publicationAttempt}>
          <div role="status" aria-live="polite" aria-atomic="true">
            <strong>{stage}</strong>
            <span>{attempt.job.target === "production" ? "Production" : "Staging"} · <code title={attempt.job.id}>{attempt.job.id.slice(0, 8)}</code></span>
            {awaitingRunner ? <span>Wait for the runner to reconnect. Do not submit again.</span> : null}
            {failure ? <span>Your saved drafts were not discarded.</span> : null}
          </div>
          {failure ? <Button onClick={onReview} variant="subtle" size="sm">Review and retry</Button> : null}
          {!verified ? <Button onClick={onActivity} variant="ghost" size="sm">Release activity</Button> : null}
        </div>
      ) : null}
    </section>
  );
}
