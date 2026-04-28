import { useCallback, useEffect, useRef, useState } from "react";
import { PublishPipelineCard } from "./PublishPipelineCard";
import { SiteAdminEnvironmentBanner } from "./SiteAdminEnvironmentBanner";
import { useSiteAdmin } from "./state";
import type { StatusPayload } from "./types";
import { normalizeString, serializeJson } from "./utils";

const DEPLOY_ACTIONS_URL =
  "https://github.com/Jinnkunn/jinnkunn.com/actions/workflows/deploy-on-content.yml";
const RELEASE_STAGING_COMMAND = "npm run release:staging";

// Status payload must have `source`, `env`, and `build` to be considered
// valid. The server always returns the full shape on success.
function normalizeStatus(data: unknown): StatusPayload | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (!obj.source || !obj.env || !obj.build) return null;
  return obj as unknown as StatusPayload;
}

// Treat a token as "needs renewal" when fewer than 5 minutes remain.
// Wider than just `< 0` so the deploy precheck also catches the case
// where the token expires mid-deploy.
function tokenNeedsRenewal(iso: string): boolean {
  if (!iso) return false;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return false;
  return ms < 5 * 60 * 1000;
}

function shortSha(value?: string | null): string {
  return normalizeString(value).slice(0, 7) || "-";
}

function sourceStoreLabel(source: StatusPayload["source"] | undefined): string {
  const kind = normalizeString(source?.storeKind).toLowerCase();
  if (kind === "db") return "D1 content database";
  if (kind === "github") return "GitHub content branch";
  if (kind === "local") return "Local filesystem";
  return "Unknown source";
}

function sourceLocation(source: StatusPayload["source"] | undefined): string {
  const kind = normalizeString(source?.storeKind).toLowerCase();
  const repo = normalizeString(source?.repo);
  const branch = normalizeString(source?.branch);
  if (kind === "db") return repo || "D1 binding";
  if (repo && branch) return `${repo}:${branch}`;
  return branch || repo || "-";
}

function deployStateLabel(source: StatusPayload["source"] | undefined): string {
  if (!source) return "Load status";
  if (source.pendingDeploy === true) return "Content ahead of deployment";
  if (source.pendingDeploy === false) return "Deployment current";
  if (normalizeString(source.storeKind).toLowerCase() === "db") {
    return "DB source, no branch diff";
  }
  const reason = normalizeString(source.pendingDeployReason);
  return reason ? `Unknown (${reason})` : "Unknown";
}

function candidateLabel(source: StatusPayload["source"] | undefined): string {
  if (!source) return "Unknown";
  if (source.deployableVersionReady === true) return "Ready";
  if (source.deployableVersionReady === false) return "Stale";
  return "Unknown";
}

function nextActionLabel(
  data: StatusPayload | null,
  productionReadOnly: boolean,
): string {
  if (!data) return "Refresh status.";
  if (productionReadOnly) return "Production is read-only here. Promote separately.";
  if (data.source?.deployableVersionReady === false) {
    return "Rebuild the staging Worker candidate, then recheck.";
  }
  if (data.source?.pendingDeploy === true) return "Deploy the ready staging candidate.";
  if (data.source?.deployableVersionReady === true) return "No deploy action needed.";
  if (normalizeString(data.source?.storeKind).toLowerCase() === "db") {
    return "No branch diff is available for D1 source; use the candidate readiness signal.";
  }
  return "Refresh status before deploying.";
}

type ReleaseHealthTone = "ok" | "warn" | "blocked" | "muted";

interface ReleaseHealthItem {
  detail: string;
  label: string;
  tone: ReleaseHealthTone;
  value: string;
}

function releaseHealthItems(
  data: StatusPayload | null,
  productionReadOnly: boolean,
): ReleaseHealthItem[] {
  const source = data?.source;
  const storeKind = normalizeString(source?.storeKind).toLowerCase();
  const hasCode = Boolean(normalizeString(source?.codeSha));
  const hasContent = Boolean(normalizeString(source?.contentSha)) || storeKind === "db";
  const candidateReady = source?.deployableVersionReady;
  const pendingDeploy = source?.pendingDeploy;

  return [
    {
      detail: sourceLocation(source),
      label: "Content source",
      tone: source ? "ok" : "muted",
      value: sourceStoreLabel(source),
    },
    {
      detail: "Public web code and CSS that the Worker candidate was built from.",
      label: "Runtime code",
      tone: hasCode ? "ok" : "warn",
      value: shortSha(source?.codeSha),
    },
    {
      detail:
        storeKind === "db"
          ? "D1 content rows are the current source; branch diff is not available."
          : normalizeString(source?.contentBranch || source?.branch) || "Content branch unavailable.",
      label: "Content revision",
      tone: hasContent ? "ok" : "warn",
      value: source?.contentSha ? shortSha(source.contentSha) : storeKind === "db" ? "D1 rows" : "-",
    },
    {
      detail:
        source?.deployableVersionReason ||
        "Uploaded Worker version must match the current code and content source.",
      label: "Worker candidate",
      tone: candidateReady === false ? "blocked" : candidateReady === true ? "ok" : "warn",
      value: candidateLabel(source),
    },
    {
      detail: deployStateLabel(source),
      label: "Staging deploy",
      tone: pendingDeploy === true ? "warn" : candidateReady === false ? "blocked" : "ok",
      value: pendingDeploy === true ? "Pending" : storeKind === "db" ? "DB source" : "Current",
    },
    {
      detail: productionReadOnly
        ? "Production is inspect-only in Workspace."
        : "Production promotion remains explicit and runbook-driven.",
      label: "Production",
      tone: "muted",
      value: "Manual",
    },
  ];
}

export function StatusPanel() {
  const {
    connection,
    environment,
    productionReadOnly,
    request,
    setMessage,
    signInWithBrowser,
  } = useSiteAdmin();
  const [data, setData] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [confirmDeploy, setConfirmDeploy] = useState(false);
  const [checkingDeploy, setCheckingDeploy] = useState(false);
  const [error, setError] = useState("");
  const deployCheckTimerRef = useRef<number | null>(null);

  const refresh = useCallback(
    async (options: { silent?: boolean } = {}) => {
      setLoading(true);
      setError("");
      const response = await request("/api/site-admin/status", "GET");
      setLoading(false);
      if (!response.ok) {
        const msg = `${response.code}: ${response.error}`;
        setError(msg);
        if (!options.silent) {
          setMessage("error", `Load status failed: ${msg}`);
        }
        return false;
      }
      const normalized = normalizeStatus(response.data);
      if (!normalized) {
        setError("Invalid status payload");
        if (!options.silent) {
          setMessage("error", "Load status failed: invalid payload");
        }
        return false;
      }
      setData(normalized);
      if (!options.silent) setMessage("success", "Status loaded.");
      return true;
    },
    [request, setMessage],
  );

  const deploy = useCallback(async () => {
    if (productionReadOnly) {
      setMessage("warn", environment.helpText);
      return;
    }
    if (!confirmDeploy) {
      // Precheck: deploy is the most expensive POST in the app and runs
      // without further confirmation once started. If our locally-known
      // token expiry is past or imminent, renew up-front so the actual
      // deploy POST doesn't trigger a mid-flight browser sign-in. (The
      // global `request` wrapper would also auto-retry on 401, but for
      // this one button we'd rather front-load the auth dance.)
      if (!connection.authToken || tokenNeedsRenewal(connection.authExpiresAt)) {
        const newToken = await signInWithBrowser();
        if (!newToken) return;
      }
      setConfirmDeploy(true);
      return;
    }
    setConfirmDeploy(false);
    setDeploying(true);
    const response = await request("/api/site-admin/deploy", "POST", {});
    setDeploying(false);
    if (!response.ok) {
      setMessage("error", `Deploy failed: ${response.code}: ${response.error}`);
      return;
    }
    const d = (response.data ?? {}) as Record<string, unknown>;
    const provider = normalizeString(d.provider);
    const deploymentId = normalizeString(d.deploymentId);
    const details = [
      provider ? `provider=${provider}` : "",
      deploymentId ? `deploymentId=${deploymentId}` : "",
    ]
      .filter(Boolean)
      .join(", ");
    setMessage(
      "success",
      details
        ? `Deploy triggered (${details}). Refresh status to verify convergence.`
        : "Deploy triggered. Refresh status to verify convergence.",
    );
    if (deployCheckTimerRef.current !== null) {
      window.clearTimeout(deployCheckTimerRef.current);
    }
    setCheckingDeploy(true);
    deployCheckTimerRef.current = window.setTimeout(() => {
      void refresh({ silent: true }).finally(() => {
        setCheckingDeploy(false);
        deployCheckTimerRef.current = null;
      });
    }, 2500);
  }, [
    confirmDeploy,
    connection.authToken,
    connection.authExpiresAt,
    environment.helpText,
    productionReadOnly,
    refresh,
    request,
    setMessage,
    signInWithBrowser,
  ]);

  useEffect(() => {
    if (!confirmDeploy) return;
    const timer = window.setTimeout(() => setConfirmDeploy(false), 6000);
    return () => window.clearTimeout(timer);
  }, [confirmDeploy]);

  useEffect(() => {
    return () => {
      if (deployCheckTimerRef.current !== null) {
        window.clearTimeout(deployCheckTimerRef.current);
      }
    };
  }, []);

  const disableDeploy =
    loading ||
    deploying ||
    productionReadOnly ||
    !connection.baseUrl ||
    !connection.authToken ||
    data?.source?.deployableVersionReady === false;

  const copyReleaseCommand = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(RELEASE_STAGING_COMMAND);
      setMessage("success", `Copied: ${RELEASE_STAGING_COMMAND}`);
    } catch {
      setMessage("warn", `Run locally: ${RELEASE_STAGING_COMMAND}`);
    }
  }, [setMessage]);

  const notes: string[] = [];
  if (loading) notes.push("Loading status…");
  if (deploying) notes.push("Triggering deploy…");
  if (checkingDeploy) notes.push("Checking deploy status…");
  if (error) notes.push(error);
  if (!notes.length && data?.source?.pendingDeploy === true) {
    notes.push(
      "Source has changes ahead of active deployment. Run Deploy when ready.",
    );
  }
  if (data?.source?.deployableVersionReady === false) {
    notes.push(
      `${
        data.source.deployableVersionReason ||
        "Latest uploaded Worker version does not match the current content."
      } Wait for GitHub Actions “Deploy (auto)” to finish, or run npm run release:staging, then refresh.`,
    );
  }

  return (
    <section className="surface-card">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]">
            Status
          </h1>
          <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">
            Runtime provider, source store, and deploy readiness snapshot.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            className="btn btn--secondary"
            type="button"
            onClick={() => void refresh()}
            disabled={loading || deploying}
          >
            Refresh
          </button>
          <button
            className={confirmDeploy ? "btn btn--danger" : "btn btn--secondary"}
            type="button"
            onClick={() => void deploy()}
            disabled={disableDeploy}
          >
            {deploying ? "Deploying…" : confirmDeploy ? "Confirm Deploy" : "Deploy"}
          </button>
        </div>
      </header>

      <SiteAdminEnvironmentBanner actionLabel="deploy changes" />

      <PublishPipelineCard
        actionsUrl={DEPLOY_ACTIONS_URL}
        loading={loading}
        onCopyReleaseCommand={copyReleaseCommand}
        onRefresh={() => void refresh()}
        releaseCommand={RELEASE_STAGING_COMMAND}
        status={data}
      />

      <div className="status-readiness" role="status">
        <div>
          <span>Content source</span>
          <strong>{sourceStoreLabel(data?.source)}</strong>
          <code>{sourceLocation(data?.source)}</code>
        </div>
        <div>
          <span>Runtime code</span>
          <strong>{shortSha(data?.source?.codeSha)}</strong>
          <code>main code</code>
        </div>
        <div>
          <span>Worker candidate</span>
          <strong>{candidateLabel(data?.source)}</strong>
          <code>{shortSha(data?.source?.deployableVersionId)}</code>
        </div>
        <div>
          <span>Next action</span>
          <strong>{nextActionLabel(data, productionReadOnly)}</strong>
        </div>
      </div>

      <section className="release-health" aria-label="Site sync and release health">
        <div className="release-health__head">
          <div>
            <h2>Release Health</h2>
            <p>Source, content, Worker candidate, and deploy readiness in one view.</p>
          </div>
          <strong>{nextActionLabel(data, productionReadOnly)}</strong>
        </div>
        <div className="release-health__grid">
          {releaseHealthItems(data, productionReadOnly).map((item) => (
            <div
              className="release-health__item"
              data-tone={item.tone}
              key={item.label}
            >
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <p>{item.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <dl className="key-values">
        <div>
          <dt>Runtime Provider</dt>
          <dd>{data?.env?.runtimeProvider || "-"}</dd>
        </div>
        <div>
          <dt>Content Source</dt>
          <dd>{sourceStoreLabel(data?.source)}</dd>
        </div>
        <div>
          <dt>Source Location</dt>
          <dd>{sourceLocation(data?.source)}</dd>
        </div>
        <div>
          <dt>Source Head</dt>
          <dd>{shortSha(data?.source?.headSha)}</dd>
        </div>
        <div>
          <dt>Code SHA</dt>
          <dd>{shortSha(data?.source?.codeSha)}</dd>
        </div>
        <div>
          <dt>Content SHA</dt>
          <dd>
            {data?.source?.contentSha
              ? shortSha(data.source.contentSha)
              : normalizeString(data?.source?.storeKind).toLowerCase() === "db"
                ? "D1 rows"
                : "-"}
          </dd>
        </div>
        <div>
          <dt>Deployable Version</dt>
          <dd>{candidateLabel(data?.source)}</dd>
        </div>
        <div>
          <dt>Deploy State</dt>
          <dd>{deployStateLabel(data?.source)}</dd>
        </div>
        <div>
          <dt>Deploy Target Ready</dt>
          <dd>{data?.env?.hasDeployTarget ? "Yes" : "No"}</dd>
        </div>
      </dl>

      {notes.length > 0 && (
        <p className="m-0 text-[12px] text-text-muted">{notes.join(" ")}</p>
      )}

      <details className="surface-details">
        <summary>Raw Status Payload</summary>
        <pre className="debug-pane">{data ? serializeJson(data) : ""}</pre>
      </details>
    </section>
  );
}
