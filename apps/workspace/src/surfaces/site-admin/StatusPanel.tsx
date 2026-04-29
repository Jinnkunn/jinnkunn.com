import { useCallback, useState } from "react";
import { PublishPipelineCard } from "./PublishPipelineCard";
import { SiteAdminEnvironmentBanner } from "./SiteAdminEnvironmentBanner";
import {
  candidateLabel,
  deployStateLabel,
  formatSourceRevision,
  nextActionLabel,
  normalizeStatusPayload,
  releaseWorkflowRecovery,
  shortId,
  shortSha,
  sourceLocation,
  sourceStoreKind,
  sourceStoreLabel,
} from "./release-flow-model";
import { useSiteAdmin } from "./state";
import type { StatusPayload } from "./types";
import { normalizeString, serializeJson } from "./utils";

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
  environmentLabel: string,
): ReleaseHealthItem[] {
  const source = data?.source;
  const active = data?.deployments?.active;
  const latestUploaded = data?.deployments?.latestUploaded;
  const storeKind = sourceStoreKind(source);
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
      value: formatSourceRevision(source),
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
      detail: active?.createdOn
        ? `${environmentLabel} active deployment from ${new Date(active.createdOn).toLocaleString()}`
        : `${environmentLabel} active deployment metadata is unavailable.`,
      label: "Active deploy",
      tone: active?.versionId ? "ok" : "warn",
      value: shortId(active?.versionId),
    },
    {
      detail: latestUploaded?.createdOn
        ? `Latest uploaded Worker candidate from ${new Date(latestUploaded.createdOn).toLocaleString()}`
        : "Latest uploaded Worker candidate metadata is unavailable.",
      label: "Latest upload",
      tone: latestUploaded?.versionId
        ? candidateReady === false
          ? "blocked"
          : "ok"
        : "warn",
      value: shortId(latestUploaded?.versionId),
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
    environment,
    productionReadOnly,
    request,
    setMessage,
  } = useSiteAdmin();
  const [data, setData] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
      const normalized = normalizeStatusPayload(response.data);
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

  const copyReleaseCommand = useCallback(async () => {
    const command = releaseWorkflowRecovery(data?.source).command;
    try {
      await navigator.clipboard.writeText(command);
      setMessage("success", `Copied: ${command}`);
    } catch {
      setMessage("warn", `Run locally: ${command}`);
    }
  }, [data?.source, setMessage]);

  const notes: string[] = [];
  if (loading) notes.push("Loading status…");
  if (error) notes.push(error);
  if (!notes.length && data?.source?.pendingDeploy === true) {
    notes.push(
      "Source has changes ahead of active deployment. Use the global Publish button when ready.",
    );
  }
  if (data?.source?.deployableVersionReady === false) {
    const workflow = releaseWorkflowRecovery(data.source);
    notes.push(
      `${
        data.source.deployableVersionReason ||
        "Latest uploaded Worker version does not match the current content."
      } ${workflow.waitText}`,
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
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </header>

      <SiteAdminEnvironmentBanner actionLabel="deploy changes" />

      <PublishPipelineCard
        loading={loading}
        onCopyReleaseCommand={copyReleaseCommand}
        onRefresh={() => void refresh()}
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
            <p>Source, content, active deploy, Worker candidate, and release readiness.</p>
          </div>
          <strong>{nextActionLabel(data, productionReadOnly)}</strong>
        </div>
        <div className="release-health__grid">
          {releaseHealthItems(data, productionReadOnly, environment.label).map((item) => (
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
              : sourceStoreKind(data?.source) === "db"
                ? "D1 rows"
                : "-"}
          </dd>
        </div>
        <div>
          <dt>Deployable Version</dt>
          <dd>{candidateLabel(data?.source)}</dd>
        </div>
        <div>
          <dt>Active Version</dt>
          <dd>{shortId(data?.deployments?.active?.versionId)}</dd>
        </div>
        <div>
          <dt>Latest Uploaded Version</dt>
          <dd>{shortId(data?.deployments?.latestUploaded?.versionId)}</dd>
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
