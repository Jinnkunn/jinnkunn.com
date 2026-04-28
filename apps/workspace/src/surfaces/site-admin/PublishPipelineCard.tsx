import type { StatusPayload } from "./types";
import { formatPendingDeploy, normalizeString } from "./utils";

type PipelineTone = "blocked" | "done" | "muted" | "pending" | "ready";

interface PipelineStep {
  detail: string;
  label: string;
  tone: PipelineTone;
  value: string;
}

interface PublishPipelineCardProps {
  actionsUrl: string;
  loading?: boolean;
  onCopyReleaseCommand: () => void;
  onRefresh: () => void;
  releaseCommand: string;
  status: StatusPayload | null;
}

function shortSha(value?: string): string {
  return normalizeString(value).slice(0, 7) || "-";
}

function pipelineSteps(status: StatusPayload | null): PipelineStep[] {
  const source = status?.source;
  const branch = normalizeString(source?.contentBranch || source?.branch);
  const pending = source?.pendingDeploy === true;
  const deployable = source?.deployableVersionReady;
  return [
    {
      detail: branch ? `Content branch ${branch}` : "Waiting for source metadata",
      label: "Saved source",
      tone: source?.contentSha || source?.headSha ? "done" : "muted",
      value: shortSha(source?.contentSha || source?.headSha),
    },
    {
      detail:
        deployable === false
          ? source?.deployableVersionReason ||
            "Worker candidate does not match current code/content."
          : deployable === true
            ? `Worker version ${source?.deployableVersionId || "ready"}`
            : "Candidate metadata not available yet.",
      label: "Worker candidate",
      tone: deployable === true ? "ready" : deployable === false ? "blocked" : "muted",
      value:
        deployable === true
          ? "Ready"
          : deployable === false
            ? "Stale"
            : "Unknown",
    },
    {
      detail: source ? formatPendingDeploy(source) : "No status loaded",
      label: "Staging deploy",
      tone: pending ? "pending" : deployable === false ? "blocked" : "done",
      value: pending ? "Pending" : deployable === false ? "Blocked" : "Current",
    },
    {
      detail: "Production promotion remains explicit and runbook-driven.",
      label: "Production",
      tone: "muted",
      value: "Manual",
    },
  ];
}

export function PublishPipelineCard({
  actionsUrl,
  loading = false,
  onCopyReleaseCommand,
  onRefresh,
  releaseCommand,
  status,
}: PublishPipelineCardProps) {
  const stale = status?.source?.deployableVersionReady === false;
  return (
    <section className="publish-pipeline" aria-label="Publish pipeline">
      <header className="publish-pipeline__head">
        <div>
          <h2>Publish pipeline</h2>
          <p>Saved content, rebuilt Worker candidate, staging deploy, then manual production.</p>
        </div>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? "Checking…" : "Recheck"}
        </button>
      </header>

      <ol className="publish-pipeline__steps">
        {pipelineSteps(status).map((step) => (
          <li key={step.label} data-tone={step.tone}>
            <span className="publish-pipeline__dot" aria-hidden="true" />
            <div>
              <strong>{step.label}</strong>
              <span>{step.detail}</span>
            </div>
            <code>{step.value}</code>
          </li>
        ))}
      </ol>

      {stale ? (
        <div className="publish-pipeline__recovery">
          <div>
            <strong>Candidate rebuild required</strong>
            <span>
              Wait for Deploy (auto), or run <code>{releaseCommand}</code>, then recheck.
            </span>
          </div>
          <div className="publish-pipeline__actions">
            <a className="btn btn--ghost" href={actionsUrl} target="_blank" rel="noreferrer">
              Open Deploy Action
            </a>
            <button type="button" className="btn btn--ghost" onClick={onCopyReleaseCommand}>
              Copy release command
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
