import { useCallback, useEffect, useRef, useState } from "react";
import { openExternalUrl } from "../../lib/tauri";
import {
  deployCandidateBlockedMessage,
  parseDeployResponseSummary,
  releaseWorkflowRecovery,
  sourceStoreKind,
  type DeployResponseSummary,
} from "./release-flow-model";
import { editorDiagnosticsSummary } from "./editor-diagnostics";
import { deriveSiteHealth } from "./site-health-model";
import { PublishPreflightPanel } from "./PublishPreflightPanel";
import { PublishPreviewPanel } from "./PublishPreviewPanel";
import {
  isStagingOrigin,
  parseDeployPreview,
  parseSourceSnapshot,
  parseStatusPayload,
  previewSummaryText,
  type DeployPreviewData,
} from "./publish-flow-model";
import { useSiteAdmin, useSiteAdminEphemeral } from "./state";
import type { StatusPayload } from "./types";
import type { UseLocalSyncResult } from "./use-local-sync";
import type { OutboxHookValue } from "./use-outbox";

/**
 * Opens the publish preview. The routine D1/content path is a local
 * Cloudflare release command; /api/site-admin/deploy remains for the
 * uploaded-version path and the GitHub fallback branch.
 */
export function PublishButton({
  contentDirty = false,
  label = "Publish",
  outbox = null,
  requirePendingChanges = false,
  sync = null,
}: {
  contentDirty?: boolean;
  label?: string;
  outbox?: OutboxHookValue | null;
  requirePendingChanges?: boolean;
  sync?: UseLocalSyncResult | null;
}) {
  const { connection, environment, productionReadOnly, request, setMessage } = useSiteAdmin();
  const { editorDiagnostics } = useSiteAdminEphemeral();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewText, setPreviewText] = useState("");
  const [previewData, setPreviewData] = useState<DeployPreviewData | null>(null);
  const [sourceSnapshot, setSourceSnapshot] = useState<StatusPayload["source"] | null>(null);
  const [statusPayload, setStatusPayload] = useState<StatusPayload | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [queuedDeploy, setQueuedDeploy] = useState<DeployResponseSummary | null>(null);
  const pollTimersRef = useRef<number[]>([]);

  const ready = Boolean(connection.baseUrl) && Boolean(connection.authToken);
  const publishLabel = productionReadOnly ? "Read-only" : label;
  const siteHealth = deriveSiteHealth({
    contentDirty,
    outbox: outbox
      ? {
          draining: outbox.draining,
          failing: outbox.status.failing,
          pending: outbox.status.pending,
        }
      : null,
    productionReadOnly,
    status: statusPayload,
    sync: {
      busy: sync?.busy ?? false,
      error: sync?.error ?? null,
      lastSyncAtMs: sync?.status?.last_sync_at_ms ?? null,
      rowCount: sync?.status?.row_count ?? null,
      summaryRowsApplied: sync?.lastSummary?.rows_applied ?? null,
    },
  });
  const releaseFlow = {
    ...siteHealth.releaseFlow,
    publishLabel:
      siteHealth.releaseFlow.publishLabel === "Publish"
        ? publishLabel
        : siteHealth.releaseFlow.publishLabel,
  };
  const editorDiagnosticSummary = editorDiagnosticsSummary(editorDiagnostics);
  const blockingEditorDiagnostics = editorDiagnostics.filter(
    (diagnostic) => diagnostic.severity === "blocking",
  );
  const editorPreflightBlocked = editorDiagnosticSummary.blocking > 0;
  const editorPreflightMessage = editorPreflightBlocked
    ? `Fix ${editorDiagnosticSummary.blocking} editor preflight blocker${
        editorDiagnosticSummary.blocking === 1 ? "" : "s"
      } before publishing.`
    : "";
  const localPreflightBlocked = siteHealth.blockingReasons.length > 0;
  const localPreflightMessage = localPreflightBlocked
    ? siteHealth.blockingReasons[0]
    : "";
  const localPreflightLabel = contentDirty
    ? "Save first"
    : (outbox?.status.pending ?? 0) > 0
      ? "Sync first"
      : "Check first";

  const clearPollTimers = useCallback(() => {
    for (const timer of pollTimersRef.current) {
      window.clearTimeout(timer);
    }
    pollTimersRef.current = [];
  }, []);

  const applyStatusSnapshot = useCallback((raw: unknown) => {
    const normalized = parseStatusPayload(raw);
    setStatusPayload(normalized);
    setSourceSnapshot(normalized?.source ?? parseSourceSnapshot(raw));
    return normalized;
  }, []);

  const loadStatusSnapshot = useCallback(async () => {
    if (!requirePendingChanges || !ready || productionReadOnly) return;
    setStatusLoading(true);
    const status = await request("/api/site-admin/status", "GET");
    setStatusLoading(false);
    if (status.ok) applyStatusSnapshot(status.data);
  }, [applyStatusSnapshot, productionReadOnly, ready, request, requirePendingChanges]);

  /* eslint-disable react-hooks/set-state-in-effect -- Publish readiness syncs from the remote deploy status endpoint. */
  useEffect(() => {
    if (!requirePendingChanges || !ready || productionReadOnly) return;
    let cancelled = false;
    setStatusLoading(true);
    void request("/api/site-admin/status", "GET").then((status) => {
      if (cancelled) return;
      setStatusLoading(false);
      if (status.ok) applyStatusSnapshot(status.data);
    });
    return () => {
      cancelled = true;
    };
  }, [applyStatusSnapshot, productionReadOnly, ready, request, requirePendingChanges]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => clearPollTimers, [clearPollTimers]);

  useEffect(() => {
    if (!requirePendingChanges) return;
    const onSourceMutated = () => {
      void loadStatusSnapshot();
    };
    window.addEventListener("site-admin:source-mutated", onSourceMutated);
    return () => window.removeEventListener("site-admin:source-mutated", onSourceMutated);
  }, [loadStatusSnapshot, requirePendingChanges]);

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 30000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  async function loadPreview() {
    if (localPreflightBlocked) {
      setMessage("warn", localPreflightMessage);
      return;
    }
    if (editorPreflightBlocked) {
      setMessage("warn", editorPreflightMessage);
      return;
    }
    if (productionReadOnly) {
      setMessage(
        "warn",
        environment.helpText,
      );
      return;
    }
    setPreviewLoading(true);
    setPreviewText("");
    setPreviewData(null);
    setSourceSnapshot(null);
    setStatusPayload(null);
    setQueuedDeploy(null);
    setPreviewError("");
    const [preview, status] = await Promise.all([
      request("/api/site-admin/deploy-preview", "GET"),
      request("/api/site-admin/status", "GET"),
    ]);
    setPreviewLoading(false);
    const normalizedStatus = status.ok ? applyStatusSnapshot(status.data) : null;
    const source = normalizedStatus?.source ?? null;
    if (status.ok) {
      setSourceSnapshot(source);
    }
    if (preview.ok) {
      const parsed = parseDeployPreview(preview.data);
      setPreviewData(parsed);
      setPreviewText(previewSummaryText(parsed));
    } else {
      setPreviewError(`${preview.code}: ${preview.error}`);
    }
    setConfirming(true);
    if (source?.deployableVersionReady === false) {
      setMessage("warn", deployCandidateBlockedMessage(source));
    }
  }

  async function copyReleaseCommand() {
    const command = releaseWorkflowRecovery(sourceSnapshot).command;
    try {
      await navigator.clipboard.writeText(command);
      setMessage("success", `Copied local release command: ${command}`);
    } catch {
      setMessage("warn", `Run locally: ${command}`);
    }
  }

  const scheduleWorkflowStatusPoll = useCallback(
    (summary: DeployResponseSummary) => {
      clearPollTimers();
      const delays = [5000, 15000, 30000, 60000, 120000];
      for (const delay of delays) {
        const timer = window.setTimeout(() => {
          void request("/api/site-admin/status", "GET").then((status) => {
            if (status.ok) applyStatusSnapshot(status.data);
          });
        }, delay);
        pollTimersRef.current.push(timer);
      }
      const workflow = releaseWorkflowRecovery(sourceSnapshot);
      setQueuedDeploy(summary);
      setConfirming(true);
      const actionDetail = summary.workflowRunsListUrl
        ? ` Open ${workflow.fallbackLabel} from the publish panel.`
        : "";
      setMessage(
        "success",
        `GitHub Actions fallback queued for staging.${actionDetail} Recheck when the workflow finishes.`,
      );
    },
    [applyStatusSnapshot, clearPollTimers, request, setMessage, sourceSnapshot],
  );

  // Click 1: from the topbar Publish button. Loads the staging diff +
  // status into a commit bar; the actual deploy fires from inside that
  // panel via confirmPublish, not by re-clicking the topbar button.
  async function requestPublish() {
    if (localPreflightBlocked) {
      setMessage("warn", localPreflightMessage);
      return;
    }
    if (editorPreflightBlocked) {
      setMessage("warn", editorPreflightMessage);
      return;
    }
    if (productionReadOnly) {
      setMessage(
        "warn",
        environment.helpText,
      );
      return;
    }
    await loadPreview();
  }

  // Click 2: fired by the Confirm button inside the commit bar. Runs the
  // real /api/site-admin/deploy POST and handles the queued/stale/success
  // branches. Keeps confirming=true on stale/queued so the recovery panel
  // stays visible; only success or non-recoverable errors close it.
  async function confirmPublish() {
    if (productionReadOnly) {
      setMessage("warn", environment.helpText);
      return;
    }
    if (sourceSnapshot?.deployableVersionReady === false) {
      setMessage("warn", deployCandidateBlockedMessage(sourceSnapshot));
      return;
    }
    if (sourceStoreKind(sourceSnapshot ?? undefined) === "db") {
      const command = releaseWorkflowRecovery(sourceSnapshot).command;
      try {
        await navigator.clipboard.writeText(command);
        setMessage(
          "warn",
          `Copied ${command}. D1-backed publishing defaults to local Cloudflare; GitHub dispatch is fallback only.`,
        );
      } catch {
        setMessage(
          "warn",
          `Run locally: ${command}. D1-backed publishing defaults to local Cloudflare; GitHub dispatch is fallback only.`,
        );
      }
      return;
    }
    setBusy(true);
    const response = await request("/api/site-admin/deploy", "POST", {});
    setBusy(false);
    if (!response.ok) {
      if (response.code === "DEPLOY_VERSION_STALE") {
        const status = await request("/api/site-admin/status", "GET");
        const normalizedStatus = status.ok ? applyStatusSnapshot(status.data) : null;
        const source = normalizedStatus?.source ?? sourceSnapshot;
        setMessage("warn", deployCandidateBlockedMessage(source));
        return;
      }
      setMessage("error", `Publish failed: ${response.code}: ${response.error}`);
      setConfirming(false);
      return;
    }
    const data = parseDeployResponseSummary(response.data);
    if (data.queued) {
      const statusAfter = await request("/api/site-admin/status", "GET");
      if (statusAfter.ok) applyStatusSnapshot(statusAfter.data);
      scheduleWorkflowStatusPoll(data);
      return;
    }
    const [statusAfter, homeCheck, blogCheck] = await Promise.all([
      request("/api/site-admin/status", "GET"),
      isStagingOrigin(connection.baseUrl) ? request("/", "GET") : Promise.resolve(null),
      isStagingOrigin(connection.baseUrl) ? request("/blog", "GET") : Promise.resolve(null),
    ]);
    if (statusAfter.ok) {
      applyStatusSnapshot(statusAfter.data);
    }
    const verified =
      !isStagingOrigin(connection.baseUrl) ||
      (homeCheck?.status === 200 && blogCheck?.status === 200);
    const details = [
      data.provider ? `provider=${data.provider}` : "",
      data.deploymentId ? `deploymentId=${data.deploymentId}` : "",
      verified ? "verified" : "",
    ]
      .filter(Boolean)
      .join(", ");
    setMessage(
      verified ? "success" : "warn",
      details
        ? `Deploy triggered (${details}).`
        : "Deploy triggered. Staging verification did not complete.",
    );
    setConfirming(false);
  }

  // User dismissed the commit bar without confirming. Local-only — the
  // server doesn't have anything to undo at this point because no deploy
  // POST has fired yet.
  function cancelPublish() {
    setConfirming(false);
  }

  const deployCandidateBlocked = releaseFlow.candidateBlocked;
  const pendingChangesKnown = statusPayload !== null;
  const noPendingChanges =
    requirePendingChanges && pendingChangesKnown && releaseFlow.noPendingChanges;
  const workflowRecovery = releaseWorkflowRecovery(sourceSnapshot);

  const canConfirm =
    confirming &&
    !busy &&
    !previewLoading &&
    !previewError &&
    !deployCandidateBlocked &&
    !queuedDeploy &&
    previewData !== null;

  return (
    <div className="publish-control">
      <button
        className={
          localPreflightBlocked ||
          editorPreflightBlocked ||
          deployCandidateBlocked ||
          noPendingChanges
            ? "btn btn--secondary"
            : "btn btn--primary"
        }
        type="button"
        onClick={() => void requestPublish()}
        disabled={
          !ready ||
          productionReadOnly ||
          busy ||
          previewLoading ||
          statusLoading ||
          confirming ||
          localPreflightBlocked ||
          editorPreflightBlocked ||
          noPendingChanges
        }
        title={
          productionReadOnly
            ? environment.helpText
            : localPreflightBlocked
              ? localPreflightMessage
            : editorPreflightBlocked
              ? editorPreflightMessage
            : deployCandidateBlocked
            ? releaseFlow.disabledReason
            : noPendingChanges
              ? releaseFlow.disabledReason
              : confirming
                ? "Review the staging diff in the panel below before confirming."
                : "Promote the current worker version via Cloudflare API"
        }
      >
        {busy
          ? "Publishing…"
          : previewLoading || statusLoading
            ? "Checking…"
            : confirming
              ? "Reviewing…"
            : productionReadOnly
              ? publishLabel
            : localPreflightBlocked
              ? localPreflightLabel
            : editorPreflightBlocked
              ? "Fix editor checks"
            : deployCandidateBlocked
              ? releaseFlow.publishLabel
            : noPendingChanges
                ? releaseFlow.publishLabel
                : publishLabel}
      </button>
      {editorPreflightBlocked ? (
        <PublishPreflightPanel
          blockingDiagnostics={blockingEditorDiagnostics}
          message={editorPreflightMessage}
        />
      ) : null}
      {confirming && (
        <PublishPreviewPanel
          busy={busy}
          canConfirm={canConfirm}
          deployCandidateBlocked={deployCandidateBlocked}
          environmentLabel={environment.label}
          onCancel={cancelPublish}
          onConfirm={() => void confirmPublish()}
          onCopyReleaseCommand={() => void copyReleaseCommand()}
          onOpenQueuedWorkflow={() => {
            const url = queuedDeploy?.workflowRunsListUrl;
            if (!url) return;
            void openExternalUrl(url).catch((error) => {
              setMessage(
                "warn",
                `Could not open GitHub fallback: ${String(error)}. URL: ${url}`,
              );
            });
          }}
          onOpenRecoveryWorkflow={() => {
            void openExternalUrl(workflowRecovery.actionsUrl).catch((error) => {
              setMessage(
                "warn",
                `Could not open GitHub fallback: ${String(error)}. URL: ${workflowRecovery.actionsUrl}`,
              );
            });
          }}
          onRecheck={() => void loadPreview()}
          previewData={previewData}
          previewError={previewError}
          previewLoading={previewLoading}
          previewText={previewText}
          queuedDeploy={queuedDeploy}
          sourceSnapshot={sourceSnapshot}
          workflowRecovery={workflowRecovery}
        />
      )}
    </div>
  );
}
