import { useCallback, useEffect, useRef, useState } from "react";
import { openExternalUrl } from "../../lib/tauri";
import {
  deployCandidateBlockedMessage,
  parseDeployResponseSummary,
  releaseWorkflowRecovery,
  shortSha,
  type DeployResponseSummary,
} from "./release-flow-model";
import { editorDiagnosticsSummary } from "./editor-diagnostics";
import { deriveSiteHealth } from "./site-health-model";
import { useSiteAdmin, useSiteAdminEphemeral } from "./state";
import type { StatusPayload } from "./types";
import { normalizeString } from "./utils";

type DeployPreviewSummaryKey =
  | "pagesAdded"
  | "pagesRemoved"
  | "redirectsAdded"
  | "redirectsRemoved"
  | "redirectsChanged"
  | "protectedAdded"
  | "protectedRemoved"
  | "protectedChanged"
  | "componentsChanged";

type DeployPreviewRedirectChange = {
  kind?: string;
  source?: string;
  pageId?: string;
  title?: string;
  fromPath?: string;
  toPath?: string;
};

type DeployPreviewProtectedChange = {
  kind?: string;
  pageId?: string;
  path?: string;
  mode?: string;
  auth?: string;
  previousMode?: string;
  previousAuth?: string;
};

type DeployPreviewComponentChange = {
  name?: string;
  label?: string;
  sourcePath?: string;
  embedTag?: string;
  affectedRoutes?: string[];
};

type DeployPreviewData = {
  generatedAt?: string;
  hasChanges?: boolean;
  summary?: Partial<Record<DeployPreviewSummaryKey, number>>;
  samples?: {
    pagesAdded?: string[];
    pagesRemoved?: string[];
    redirects?: DeployPreviewRedirectChange[];
    protected?: DeployPreviewProtectedChange[];
    components?: DeployPreviewComponentChange[];
  };
};

const SUMMARY_LABELS: Array<[DeployPreviewSummaryKey, string]> = [
  ["pagesAdded", "Pages added"],
  ["pagesRemoved", "Pages removed"],
  ["redirectsAdded", "Redirects added"],
  ["redirectsRemoved", "Redirects removed"],
  ["redirectsChanged", "Redirects changed"],
  ["protectedAdded", "Protected added"],
  ["protectedRemoved", "Protected removed"],
  ["protectedChanged", "Protected changed"],
  ["componentsChanged", "Shared content changed"],
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseDeployPreview(raw: unknown): DeployPreviewData {
  const data = asRecord(raw);
  const summary = asRecord(data.summary);
  const samples = asRecord(data.samples);
  return {
    generatedAt: normalizeString(data.generatedAt),
    hasChanges:
      typeof data.hasChanges === "boolean" ? data.hasChanges : undefined,
    summary: Object.fromEntries(
      SUMMARY_LABELS.map(([key]) => [
        key,
        typeof summary[key] === "number" ? summary[key] : 0,
      ]),
    ) as DeployPreviewData["summary"],
    samples: {
      pagesAdded: asStringArray(samples.pagesAdded),
      pagesRemoved: asStringArray(samples.pagesRemoved),
      redirects: Array.isArray(samples.redirects)
        ? samples.redirects.map((item) => {
            const record = asRecord(item);
            return {
              kind: normalizeString(record.kind),
              source: normalizeString(record.source),
              pageId: normalizeString(record.pageId),
              title: normalizeString(record.title),
              fromPath: normalizeString(record.fromPath),
              toPath: normalizeString(record.toPath),
            };
          })
        : [],
      protected: Array.isArray(samples.protected)
        ? samples.protected.map((item) => {
            const record = asRecord(item);
            return {
              kind: normalizeString(record.kind),
              pageId: normalizeString(record.pageId),
              path: normalizeString(record.path),
              mode: normalizeString(record.mode),
              auth: normalizeString(record.auth),
              previousMode: normalizeString(record.previousMode),
              previousAuth: normalizeString(record.previousAuth),
            };
          })
        : [],
      components: Array.isArray(samples.components)
        ? samples.components.map((item) => {
            const record = asRecord(item);
            return {
              name: normalizeString(record.name),
              label: normalizeString(record.label),
              sourcePath: normalizeString(record.sourcePath),
              embedTag: normalizeString(record.embedTag),
              affectedRoutes: asStringArray(record.affectedRoutes),
            };
          })
        : [],
    },
  };
}

function parseStatusPayload(raw: unknown): StatusPayload | null {
  const data = asRecord(raw);
  if (!data.source || !data.env || !data.build) return null;
  return data as unknown as StatusPayload;
}

function parseSourceSnapshot(raw: unknown): StatusPayload["source"] | null {
  const data = asRecord(raw);
  const source = asRecord(data.source);
  if (!Object.keys(source).length) return null;
  return {
    storeKind: normalizeString(source.storeKind),
    branch: normalizeString(source.branch),
    headSha: normalizeString(source.headSha),
    pendingDeploy:
      typeof source.pendingDeploy === "boolean"
        ? source.pendingDeploy
        : source.pendingDeploy === null
          ? null
          : undefined,
    pendingDeployReason: normalizeString(source.pendingDeployReason),
    codeSha: normalizeString(source.codeSha),
    contentSha: normalizeString(source.contentSha),
    contentBranch: normalizeString(source.contentBranch),
    deployableVersionReady:
      typeof source.deployableVersionReady === "boolean"
        ? source.deployableVersionReady
        : source.deployableVersionReady === null
          ? null
          : undefined,
    deployableVersionReason: normalizeString(source.deployableVersionReason),
    deployableVersionId: normalizeString(source.deployableVersionId),
  };
}

function previewSummaryText(preview: DeployPreviewData): string {
  const counts = SUMMARY_LABELS.filter(
    ([key]) => (preview.summary?.[key] ?? 0) > 0,
  )
    .map(([key, label]) => `${label} ${preview.summary?.[key] ?? 0}`)
    .join(" · ");
  if (counts) return counts;
  return preview.hasChanges === false
    ? "No route/protection changes detected."
    : "Preview loaded.";
}

function isStagingOrigin(baseUrl: string): boolean {
  return /\/\/staging\./i.test(baseUrl);
}

/**
 * Triggers /api/site-admin/deploy. GitHub/content-branch mode promotes the
 * currently uploaded Worker version; D1 mode dispatches the staging release
 * workflow and returns immediately with a queued state.
 */
export function PublishButton({
  label = "Publish",
  requirePendingChanges = false,
}: {
  label?: string;
  requirePendingChanges?: boolean;
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
    contentDirty: false,
    outbox: null,
    productionReadOnly,
    status: statusPayload,
    sync: {
      busy: false,
      error: null,
      lastSyncAtMs: null,
      rowCount: null,
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
      setMessage("success", `Copied: ${command}`);
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
        ? ` Open ${workflow.label} from the publish panel or GitHub Actions.`
        : "";
      setMessage(
        "success",
        `Staging release queued in GitHub Actions.${actionDetail} Recheck when the workflow finishes.`,
      );
    },
    [applyStatusSnapshot, clearPollTimers, request, setMessage, sourceSnapshot],
  );

  async function trigger() {
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
    if (!confirming || sourceSnapshot?.deployableVersionReady === false) {
      await loadPreview();
      return;
    }
    setConfirming(false);
    setBusy(true);
    const response = await request("/api/site-admin/deploy", "POST", {});
    setBusy(false);
    if (!response.ok) {
      if (response.code === "DEPLOY_VERSION_STALE") {
        const status = await request("/api/site-admin/status", "GET");
        const normalizedStatus = status.ok ? applyStatusSnapshot(status.data) : null;
        const source = normalizedStatus?.source ?? sourceSnapshot;
        setMessage("warn", deployCandidateBlockedMessage(source));
        setConfirming(true);
        return;
      }
      setMessage("error", `Publish failed: ${response.code}: ${response.error}`);
      return;
    }
    const data = parseDeployResponseSummary(response.data);
    if (data.queued) {
      setConfirming(false);
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
  }

  const deployCandidateBlocked = releaseFlow.candidateBlocked;
  const pendingChangesKnown = statusPayload !== null;
  const noPendingChanges =
    requirePendingChanges && pendingChangesKnown && releaseFlow.noPendingChanges;
  const workflowRecovery = releaseWorkflowRecovery(sourceSnapshot);

  return (
    <div className="publish-control">
      <button
        className={
          editorPreflightBlocked || deployCandidateBlocked || noPendingChanges
            ? "btn btn--secondary"
            : confirming
              ? "btn btn--danger"
              : "btn btn--primary"
        }
        type="button"
        onClick={() => void trigger()}
        disabled={
          !ready ||
          productionReadOnly ||
          busy ||
          previewLoading ||
          statusLoading ||
          editorPreflightBlocked ||
          noPendingChanges
        }
        title={
          productionReadOnly
            ? environment.helpText
            : editorPreflightBlocked
              ? editorPreflightMessage
            : deployCandidateBlocked
            ? releaseFlow.disabledReason
            : noPendingChanges
              ? releaseFlow.disabledReason
              : "Promote the current worker version via Cloudflare API"
        }
      >
        {busy
          ? "Publishing…"
          : previewLoading || statusLoading
            ? "Checking…"
            : productionReadOnly
              ? publishLabel
            : editorPreflightBlocked
              ? "Fix editor checks"
            : deployCandidateBlocked
              ? releaseFlow.publishLabel
              : confirming
                ? "Confirm Publish"
              : noPendingChanges
                  ? releaseFlow.publishLabel
                  : publishLabel}
      </button>
      {editorPreflightBlocked ? (
        <details className="publish-preview publish-preview--preflight" role="status" open>
          <summary>{editorPreflightMessage}</summary>
          <div className="publish-preview__body">
            <ul className="publish-preview__preflight-list">
              {blockingEditorDiagnostics.slice(0, 6).map((diagnostic) => (
                <li key={diagnostic.id}>
                  <strong>{diagnostic.title}</strong>
                  <span>{diagnostic.detail}</span>
                  <small>{diagnostic.suggestion}</small>
                </li>
              ))}
              {blockingEditorDiagnostics.length > 6 ? (
                <li>
                  <strong>{blockingEditorDiagnostics.length - 6} more blockers</strong>
                  <span>Review the editor checks panel in the current document.</span>
                </li>
              ) : null}
            </ul>
          </div>
        </details>
      ) : null}
      {confirming && (
        <details className="publish-preview" role="status" open>
          <summary>
            {previewError ? `Preview unavailable: ${previewError}` : previewText}
          </summary>
          {!previewError && previewData && (
            <div className="publish-preview__body">
              <div className="publish-preview__meta">
                <span>
                  Generated{" "}
                  {previewData.generatedAt
                    ? new Date(previewData.generatedAt).toLocaleString()
                    : "now"}
                </span>
                {sourceSnapshot?.branch && <span>Branch {sourceSnapshot.branch}</span>}
                {sourceSnapshot?.headSha && (
                  <span>Head {shortSha(sourceSnapshot.headSha)}</span>
                )}
                {sourceSnapshot?.codeSha && (
                  <span>Code {shortSha(sourceSnapshot.codeSha)}</span>
                )}
                {sourceSnapshot?.contentSha && (
                  <span>Content {shortSha(sourceSnapshot.contentSha)}</span>
                )}
                {typeof sourceSnapshot?.pendingDeploy === "boolean" && (
                  <span>
                    Pending deploy {sourceSnapshot.pendingDeploy ? "yes" : "no"}
                  </span>
                )}
                {typeof sourceSnapshot?.deployableVersionReady === "boolean" && (
                  <span>
                    Deployable version{" "}
                    {sourceSnapshot.deployableVersionReady ? "ready" : "stale"}
                  </span>
                )}
              </div>
              <div className="publish-preview__summary">
                {SUMMARY_LABELS.map(([key, label]) => (
                  <div key={key}>
                    <strong>{previewData.summary?.[key] ?? 0}</strong>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              <PreviewList
                title="Pages added"
                rows={previewData.samples?.pagesAdded ?? []}
              />
              <PreviewList
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
              {sourceSnapshot?.pendingDeployReason && (
                <p className="publish-preview__note">
                  {sourceSnapshot.pendingDeployReason}
                </p>
              )}
              {sourceSnapshot?.deployableVersionReason && (
                <p className="publish-preview__note">
                  {sourceSnapshot.deployableVersionReason}
                </p>
              )}
              {deployCandidateBlocked ? (
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
                      disabled={previewLoading}
                      onClick={() => void loadPreview()}
                    >
                      Recheck
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => {
                        void openExternalUrl(workflowRecovery.actionsUrl).catch((error) => {
                          setMessage(
                            "warn",
                            `Could not open the release action: ${String(error)}. URL: ${workflowRecovery.actionsUrl}`,
                          );
                        });
                      }}
                    >
                      {workflowRecovery.openLabel}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => void copyReleaseCommand()}
                    >
                      {workflowRecovery.copyLabel}
                    </button>
                  </div>
                </div>
              ) : null}
              {queuedDeploy ? (
                <div className="publish-preview__recovery">
                  <div>
                    <strong>Staging release queued</strong>
                    <span>
                      GitHub Actions is rebuilding staging. Recheck status when the
                      workflow finishes.
                    </span>
                  </div>
                  <div className="publish-preview__recovery-actions">
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled={previewLoading}
                      onClick={() => void loadPreview()}
                    >
                      Recheck
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={!queuedDeploy.workflowRunsListUrl}
                      onClick={() => {
                        const url = queuedDeploy.workflowRunsListUrl;
                        if (!url) return;
                        void openExternalUrl(url).catch((error) => {
                          setMessage(
                            "warn",
                            `Could not open GitHub Actions: ${String(error)}. URL: ${url}`,
                          );
                        });
                      }}
                    >
                      Open GitHub Actions
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </details>
      )}
    </div>
  );
}

function PreviewList({ title, rows }: { title: string; rows: string[] }) {
  return <ChangeList title={title} rows={rows} />;
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
