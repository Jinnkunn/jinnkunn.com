import { useCallback, useEffect, useState } from "react";
import { openExternalUrl } from "../../lib/tauri";
import { useSiteAdmin } from "./state";
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

type SourceSnapshot = {
  storeKind?: string;
  branch?: string;
  headSha?: string;
  pendingDeploy?: boolean | null;
  pendingDeployReason?: string;
  codeSha?: string;
  contentSha?: string;
  contentBranch?: string;
  deployableVersionReady?: boolean | null;
  deployableVersionReason?: string;
  deployableVersionId?: string;
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

const DEPLOY_ACTIONS_URL =
  "https://github.com/Jinnkunn/jinnkunn.com/actions/workflows/deploy-on-content.yml";
const RELEASE_STAGING_COMMAND = "npm run release:staging";

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

function parseSourceSnapshot(raw: unknown): SourceSnapshot | null {
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

function shortSha(value?: string): string {
  return normalizeString(value).slice(0, 7);
}

function deployCandidateBlockedMessage(source: SourceSnapshot | null): string {
  const content = shortSha(source?.contentSha);
  const branch = normalizeString(source?.contentBranch || source?.branch);
  const detail = source?.deployableVersionReason
    ? ` ${source.deployableVersionReason}`
    : "";
  const target = [content ? `content ${content}` : "", branch ? `branch ${branch}` : ""]
    .filter(Boolean)
    .join(" on ");
  return [
    target
      ? `Staging needs a rebuilt Worker candidate for ${target}.`
      : "Staging needs a rebuilt Worker candidate for the latest content.",
    "Wait for GitHub Actions “Deploy (auto)” to finish, or run npm run release:staging, then Recheck.",
    detail,
  ]
    .filter(Boolean)
    .join(" ");
}

function isDeployCandidateBlocked(source: SourceSnapshot | null): boolean {
  return source?.deployableVersionReady === false;
}

function deployCandidateTarget(source: SourceSnapshot | null): string {
  const content = shortSha(source?.contentSha);
  const branch = normalizeString(source?.contentBranch || source?.branch);
  if (content && branch) return `content ${content} on ${branch}`;
  if (content) return `content ${content}`;
  if (branch) return branch;
  return "latest content";
}

/**
 * Triggers /api/site-admin/deploy. Deploy promotes the currently-uploaded
 * worker version — it does not rebuild from source. In the common workflow,
 * CI rebuilds after a content commit; this button lets you manually kick the
 * Cloudflare promotion step after those artifacts land.
 */
export function PublishButton({
  label = "Publish",
  requirePendingChanges = false,
}: {
  label?: string;
  requirePendingChanges?: boolean;
}) {
  const { connection, environment, productionReadOnly, request, setMessage } = useSiteAdmin();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewText, setPreviewText] = useState("");
  const [previewData, setPreviewData] = useState<DeployPreviewData | null>(null);
  const [sourceSnapshot, setSourceSnapshot] = useState<SourceSnapshot | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const ready = Boolean(connection.baseUrl) && Boolean(connection.authToken);
  const loadStatusSnapshot = useCallback(async () => {
    if (!requirePendingChanges || !ready || productionReadOnly) return;
    setStatusLoading(true);
    const status = await request("/api/site-admin/status", "GET");
    setStatusLoading(false);
    if (status.ok) setSourceSnapshot(parseSourceSnapshot(status.data));
  }, [productionReadOnly, ready, request, requirePendingChanges]);

  /* eslint-disable react-hooks/set-state-in-effect -- Publish readiness syncs from the remote deploy status endpoint. */
  useEffect(() => {
    if (!requirePendingChanges || !ready || productionReadOnly) return;
    let cancelled = false;
    setStatusLoading(true);
    void request("/api/site-admin/status", "GET").then((status) => {
      if (cancelled) return;
      setStatusLoading(false);
      if (status.ok) setSourceSnapshot(parseSourceSnapshot(status.data));
    });
    return () => {
      cancelled = true;
    };
  }, [productionReadOnly, ready, request, requirePendingChanges]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
    setPreviewError("");
    const [preview, status] = await Promise.all([
      request("/api/site-admin/deploy-preview", "GET"),
      request("/api/site-admin/status", "GET"),
    ]);
    setPreviewLoading(false);
    const source = status.ok ? parseSourceSnapshot(status.data) : null;
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
    if (isDeployCandidateBlocked(source)) {
      setMessage("warn", deployCandidateBlockedMessage(source));
    }
  }

  async function copyReleaseCommand() {
    try {
      await navigator.clipboard.writeText(RELEASE_STAGING_COMMAND);
      setMessage("success", `Copied: ${RELEASE_STAGING_COMMAND}`);
    } catch {
      setMessage("warn", `Run locally: ${RELEASE_STAGING_COMMAND}`);
    }
  }

  async function trigger() {
    if (productionReadOnly) {
      setMessage(
        "warn",
        environment.helpText,
      );
      return;
    }
    if (!confirming || isDeployCandidateBlocked(sourceSnapshot)) {
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
        const source = status.ok ? parseSourceSnapshot(status.data) : sourceSnapshot;
        if (status.ok) setSourceSnapshot(source);
        setMessage("warn", deployCandidateBlockedMessage(source));
        setConfirming(true);
        return;
      }
      setMessage("error", `Publish failed: ${response.code}: ${response.error}`);
      return;
    }
    const [statusAfter, homeCheck, blogCheck] = await Promise.all([
      request("/api/site-admin/status", "GET"),
      isStagingOrigin(connection.baseUrl) ? request("/", "GET") : Promise.resolve(null),
      isStagingOrigin(connection.baseUrl) ? request("/blog", "GET") : Promise.resolve(null),
    ]);
    const data = (response.data ?? {}) as Record<string, unknown>;
    const provider = normalizeString(data.provider);
    const deploymentId = normalizeString(data.deploymentId);
    if (statusAfter.ok) {
      setSourceSnapshot(parseSourceSnapshot(statusAfter.data));
    }
    const verified =
      !isStagingOrigin(connection.baseUrl) ||
      (homeCheck?.status === 200 && blogCheck?.status === 200);
    const details = [
      provider ? `provider=${provider}` : "",
      deploymentId ? `deploymentId=${deploymentId}` : "",
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

  const deployCandidateBlocked = isDeployCandidateBlocked(sourceSnapshot);
  const pendingChangesKnown = sourceSnapshot !== null;
  const noPendingChanges =
    requirePendingChanges && pendingChangesKnown && sourceSnapshot.pendingDeploy !== true;

  return (
    <div className="publish-control">
      <button
        className={
          deployCandidateBlocked || noPendingChanges
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
          noPendingChanges
        }
        title={
          productionReadOnly
            ? environment.helpText
            : deployCandidateBlocked
            ? "Wait for the staging candidate rebuild, then recheck."
            : noPendingChanges
              ? "No saved source changes are waiting to publish."
              : "Promote the current worker version via Cloudflare API"
        }
      >
        {busy
          ? "Publishing…"
          : previewLoading || statusLoading
            ? "Checking…"
            : productionReadOnly
              ? label
            : deployCandidateBlocked
              ? "Recheck"
              : confirming
                ? "Confirm Publish"
                : noPendingChanges
                  ? "No changes"
                  : label}
      </button>
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
                      Rebuild the Worker candidate for{" "}
                      {deployCandidateTarget(sourceSnapshot)}, then recheck.
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
                        void openExternalUrl(DEPLOY_ACTIONS_URL).catch((error) => {
                          setMessage(
                            "warn",
                            `Could not open the deploy action: ${String(error)}. URL: ${DEPLOY_ACTIONS_URL}`,
                          );
                        });
                      }}
                    >
                      Open Deploy Action
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => void copyReleaseCommand()}
                    >
                      Copy release command
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
