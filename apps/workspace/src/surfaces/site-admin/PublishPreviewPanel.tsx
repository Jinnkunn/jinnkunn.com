import type { DeployResponseSummary } from "./release-flow-model";
import { shortSha } from "./release-flow-model";
import type { StatusPayload } from "./types";
import {
  type DeployPreviewData,
  SUMMARY_LABELS,
} from "./publish-flow-model";

interface WorkflowRecovery {
  copyLabel: string;
  detail: string;
  openLabel: string;
  waitText: string;
}

export interface PublishPreviewPanelProps {
  busy: boolean;
  canConfirm: boolean;
  deployCandidateBlocked: boolean;
  environmentLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  onCopyReleaseCommand: () => void;
  onOpenQueuedWorkflow: () => void;
  onOpenRecoveryWorkflow: () => void;
  onRecheck: () => void;
  previewData: DeployPreviewData | null;
  previewError: string;
  previewLoading: boolean;
  previewText: string;
  queuedDeploy: DeployResponseSummary | null;
  sourceSnapshot: StatusPayload["source"] | null;
  workflowRecovery: WorkflowRecovery;
}

function commitHeadline({
  busy,
  canConfirm,
  deployCandidateBlocked,
  environmentLabel,
  previewError,
  previewLoading,
  queuedDeploy,
}: {
  busy: boolean;
  canConfirm: boolean;
  deployCandidateBlocked: boolean;
  environmentLabel: string;
  previewError: string;
  previewLoading: boolean;
  queuedDeploy: DeployResponseSummary | null;
}): string {
  if (previewError) return "Preview unavailable";
  if (previewLoading) return "Loading preview…";
  if (busy) return `Publishing to ${environmentLabel}…`;
  if (queuedDeploy) return `Release queued for ${environmentLabel}`;
  if (deployCandidateBlocked) return "Staging candidate is stale";
  if (canConfirm) return `Ready to publish to ${environmentLabel}`;
  return `Reviewing changes for ${environmentLabel}`;
}

export function PublishPreviewPanel({
  busy,
  canConfirm,
  deployCandidateBlocked,
  environmentLabel,
  onCancel,
  onConfirm,
  onCopyReleaseCommand,
  onOpenQueuedWorkflow,
  onOpenRecoveryWorkflow,
  onRecheck,
  previewData,
  previewError,
  previewLoading,
  previewText,
  queuedDeploy,
  sourceSnapshot,
  workflowRecovery,
}: PublishPreviewPanelProps) {
  const headline = commitHeadline({
    busy,
    canConfirm,
    deployCandidateBlocked,
    environmentLabel,
    previewError,
    previewLoading,
    queuedDeploy,
  });
  const subline = previewError
    ? previewError
    : previewLoading
      ? "Fetching the latest staging diff…"
      : previewText || "No content changes detected.";
  return (
    <div className="publish-preview" role="status">
      <header className="publish-preview__commit-bar">
        <div className="publish-preview__commit-summary">
          <strong>{headline}</strong>
          <span>{subline}</span>
        </div>
        <div className="publish-preview__commit-actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onCancel}
            disabled={busy}
          >
            {queuedDeploy ? "Dismiss" : "Cancel"}
          </button>
          {canConfirm ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={onConfirm}
              disabled={busy || previewLoading}
            >
              {busy ? "Publishing…" : "Confirm publish"}
            </button>
          ) : null}
        </div>
      </header>
      {!previewError && previewData ? (
        <div className="publish-preview__body">
          <div className="publish-preview__meta">
            <span>
              Generated{" "}
              {previewData.generatedAt
                ? new Date(previewData.generatedAt).toLocaleString()
                : "now"}
            </span>
            {sourceSnapshot?.branch ? <span>Branch {sourceSnapshot.branch}</span> : null}
            {sourceSnapshot?.headSha ? (
              <span>Head {shortSha(sourceSnapshot.headSha)}</span>
            ) : null}
            {sourceSnapshot?.codeSha ? (
              <span>Code {shortSha(sourceSnapshot.codeSha)}</span>
            ) : null}
            {sourceSnapshot?.contentSha ? (
              <span>Content {shortSha(sourceSnapshot.contentSha)}</span>
            ) : null}
            {typeof sourceSnapshot?.pendingDeploy === "boolean" ? (
              <span>Pending deploy {sourceSnapshot.pendingDeploy ? "yes" : "no"}</span>
            ) : null}
            {typeof sourceSnapshot?.deployableVersionReady === "boolean" ? (
              <span>
                Deployable version{" "}
                {sourceSnapshot.deployableVersionReady ? "ready" : "stale"}
              </span>
            ) : null}
          </div>
          <div className="publish-preview__summary">
            {SUMMARY_LABELS.map(([key, label]) => (
              <div key={key}>
                <strong>{previewData.summary?.[key] ?? 0}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <ChangeList
            title="Pages added"
            rows={previewData.samples?.pagesAdded ?? []}
          />
          <ChangeList
            title="Pages removed"
            rows={previewData.samples?.pagesRemoved ?? []}
          />
          <ChangeList
            title="Redirect changes"
            rows={(previewData.samples?.redirects ?? []).map((item) =>
              [
                item.kind,
                item.fromPath || item.pageId,
                item.toPath ? `→ ${item.toPath}` : "",
                item.title ? `(${item.title})` : "",
              ]
                .filter(Boolean)
                .join(" "),
            )}
          />
          <ChangeList
            title="Protection changes"
            rows={(previewData.samples?.protected ?? []).map((item) =>
              [
                item.kind,
                item.path || item.pageId,
                item.auth ? `auth=${item.auth}` : "",
                item.mode ? `mode=${item.mode}` : "",
              ]
                .filter(Boolean)
                .join(" "),
            )}
          />
          <ChangeList
            title="Shared content changes"
            rows={(previewData.samples?.components ?? []).map((item) => {
              const routes = item.affectedRoutes?.length
                ? `affects ${item.affectedRoutes.join(", ")}`
                : "no page usage found";
              return [
                item.label || item.name,
                item.embedTag ? `<${item.embedTag} />` : "",
                routes,
              ]
                .filter(Boolean)
                .join(" · ");
            })}
          />
          {sourceSnapshot?.pendingDeployReason ? (
            <p className="publish-preview__note">
              {sourceSnapshot.pendingDeployReason}
            </p>
          ) : null}
          {sourceSnapshot?.deployableVersionReason ? (
            <p className="publish-preview__note">
              {sourceSnapshot.deployableVersionReason}
            </p>
          ) : null}
          {deployCandidateBlocked ? (
            <PublishRecovery
              busy={previewLoading}
              onCopyReleaseCommand={onCopyReleaseCommand}
              onOpenRecoveryWorkflow={onOpenRecoveryWorkflow}
              onRecheck={onRecheck}
              workflowRecovery={workflowRecovery}
            />
          ) : null}
          {queuedDeploy ? (
            <QueuedDeployRecovery
              busy={previewLoading}
              canOpen={Boolean(queuedDeploy.workflowRunsListUrl)}
              onOpenQueuedWorkflow={onOpenQueuedWorkflow}
              onRecheck={onRecheck}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PublishRecovery({
  busy,
  onCopyReleaseCommand,
  onOpenRecoveryWorkflow,
  onRecheck,
  workflowRecovery,
}: {
  busy: boolean;
  onCopyReleaseCommand: () => void;
  onOpenRecoveryWorkflow: () => void;
  onRecheck: () => void;
  workflowRecovery: WorkflowRecovery;
}) {
  return (
    <div className="publish-preview__recovery">
      <div>
        <strong>Staging candidate is stale</strong>
        <span>
          {workflowRecovery.detail} {workflowRecovery.waitText}
        </span>
      </div>
      <div className="publish-preview__recovery-actions">
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy}
          onClick={onRecheck}
        >
          Recheck
        </button>
        <button type="button" className="btn btn--ghost" onClick={onOpenRecoveryWorkflow}>
          {workflowRecovery.openLabel}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCopyReleaseCommand}>
          {workflowRecovery.copyLabel}
        </button>
      </div>
    </div>
  );
}

function QueuedDeployRecovery({
  busy,
  canOpen,
  onOpenQueuedWorkflow,
  onRecheck,
}: {
  busy: boolean;
  canOpen: boolean;
  onOpenQueuedWorkflow: () => void;
  onRecheck: () => void;
}) {
  return (
    <div className="publish-preview__recovery">
      <div>
        <strong>Staging release queued</strong>
        <span>
          GitHub Actions fallback is rebuilding staging. Recheck status when
          the workflow finishes.
        </span>
      </div>
      <div className="publish-preview__recovery-actions">
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy}
          onClick={onRecheck}
        >
          Recheck
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={!canOpen}
          onClick={onOpenQueuedWorkflow}
        >
          Open GitHub fallback
        </button>
      </div>
    </div>
  );
}

function ChangeList({ title, rows }: { title: string; rows: string[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="publish-preview__list">
      <span>{title}</span>
      <ul>
        {rows.slice(0, 8).map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
    </div>
  );
}
