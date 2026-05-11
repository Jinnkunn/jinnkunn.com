export type ReleaseExecutionMode = "local" | "remote";

export type RemoteReleaseJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

export type RemoteReleaseJobAction =
  | "status"
  | "publish-content-staging"
  | "deploy-staging-code"
  | "promote-production-code"
  | "publish-content-production-from-staging";

export interface RemoteReleaseJobRow {
  id: string;
  action: string;
  script: string;
  target: string;
  status: RemoteReleaseJobStatus;
  actor: string;
  agentId: string;
  phase: string;
  request: Record<string, unknown>;
  result: Record<string, unknown>;
  error: string;
  createdAt: number;
  updatedAt: number;
  claimedAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface RemoteReleaseAgentRow {
  agentId: string;
  status: "idle" | "running";
  currentJobId: string;
  capabilities: string[];
  lastSeenAt: number;
  updatedAt: number;
}

export interface RemoteReleaseRunnerStatus {
  agents: RemoteReleaseAgentRow[];
  observedAt: number;
  queuedCount: number;
  runningCount: number;
}

export interface RemoteReleaseWakeResult {
  configured: boolean;
  ok: boolean;
  status: number;
  error: string;
}

type ReleaseTone = "ok" | "warn" | "blocked" | "muted";

interface ReleaseRunnerFormatters {
  formatRelativeTime: (ms: number) => string;
  scriptLabel: (script: string) => string;
  shortId: (value: string) => string;
}

export function ReleaseRunnerStatusCard({
  executionMode,
  formatRelativeTime,
  jobs,
  onRefresh,
  onRunStatusCheck,
  shortId,
  statusCheckDisabled,
  status,
}: {
  executionMode: ReleaseExecutionMode;
  formatRelativeTime: ReleaseRunnerFormatters["formatRelativeTime"];
  jobs: RemoteReleaseJobRow[];
  onRefresh: () => void;
  onRunStatusCheck: () => void;
  shortId: ReleaseRunnerFormatters["shortId"];
  statusCheckDisabled: boolean;
  status: RemoteReleaseRunnerStatus | null;
}) {
  const agent = status?.agents[0] ?? null;
  const latestJob = jobs[0] ?? null;
  const activeJob =
    jobs.find((job) => job.status === "running") ??
    jobs.find((job) => job.status === "queued") ??
    null;
  const ageMs =
    agent?.lastSeenAt && status
      ? status.observedAt - agent.lastSeenAt
      : Number.POSITIVE_INFINITY;
  const online = Boolean(agent && ageMs < 30_000);
  const stale = Boolean(agent && !online);
  const tone: ReleaseTone = online
    ? agent?.status === "running"
      ? "warn"
      : "ok"
    : stale
      ? "blocked"
      : "muted";
  const title = online
    ? agent?.status === "running"
      ? "Mac mini runner working"
      : "Mac mini runner online"
    : stale
      ? "Mac mini runner stale"
      : "Mac mini runner not seen";
  const detail = online
    ? `Last heartbeat ${formatRelativeTime(agent?.lastSeenAt || 0)}.`
    : stale
      ? `Last heartbeat ${formatRelativeTime(agent?.lastSeenAt || 0)}; check the tunnel, Access policy, or LaunchAgent if jobs do not start.`
      : "No heartbeat has reached Site Admin yet. Check Cloudflare Tunnel, Access service token, and the runner bearer token.";
  const wakeTone: ReleaseTone =
    online
      ? "ok"
      : status?.queuedCount
        ? "blocked"
        : stale
          ? "warn"
          : "muted";
  const wakeLabel =
    online
      ? activeJob
        ? "Claiming"
        : "Ready"
      : status?.queuedCount
        ? "Pending"
        : stale
          ? "Stale"
          : "Waiting";
  return (
    <section
      className="release-center__runner-status"
      data-tone={tone}
      aria-label="Remote release runner status"
    >
      <div className="release-center__runner-main">
        <span className="release-center__runner-dot" aria-hidden="true" />
        <div>
          <strong>{title}</strong>
          <small>
            {executionMode === "remote" ? "Remote runner selected. " : "Remote runner standby. "}
            {detail}
          </small>
        </div>
      </div>
      <dl className="release-center__runner-facts">
        <div>
          <dt>Heartbeat</dt>
          <dd>{agent ? formatRelativeTime(agent.lastSeenAt) : "None"}</dd>
        </div>
        <div>
          <dt>Queue</dt>
          <dd>{status ? `${status.queuedCount} / ${status.runningCount}` : "Unknown"}</dd>
        </div>
        <div>
          <dt>Current</dt>
          <dd>{activeJob ? shortId(activeJob.id) : agent?.currentJobId ? shortId(agent.currentJobId) : "Idle"}</dd>
        </div>
        <div>
          <dt>Last job</dt>
          <dd>{latestJob ? `${remoteJobStatusLabel(latestJob)} · ${formatRelativeTime(latestJob.updatedAt)}` : "None"}</dd>
        </div>
      </dl>
      <dl className="release-center__runner-guards" aria-label="Runner guardrails">
        <div data-tone={wakeTone}>
          <dt>Wake</dt>
          <dd>{wakeLabel}</dd>
        </div>
        <div data-tone={online || stale ? "ok" : "muted"}>
          <dt>Tunnel</dt>
          <dd>{online || stale ? "Seen" : "No signal"}</dd>
        </div>
        <div data-tone="ok">
          <dt>Access</dt>
          <dd>Service token</dd>
        </div>
        <div data-tone="ok">
          <dt>Auth</dt>
          <dd>Bearer token</dd>
        </div>
        <div data-tone="muted">
          <dt>Fallback</dt>
          <dd>60s poll</dd>
        </div>
      </dl>
      <div className="release-center__runner-actions">
        <button
          className="btn btn--secondary"
          type="button"
          disabled={statusCheckDisabled}
          onClick={onRunStatusCheck}
        >
          Run status check
        </button>
        <button className="btn btn--secondary" type="button" onClick={onRefresh}>
          Refresh runner
        </button>
      </div>
    </section>
  );
}

function remoteJobStatusTone(status: RemoteReleaseJobStatus): ReleaseTone {
  if (status === "succeeded") return "ok";
  if (status === "failed" || status === "canceled") return "blocked";
  if (status === "running" || status === "queued") return "warn";
  return "muted";
}

function remoteJobStatusLabel(job: RemoteReleaseJobRow): string {
  if (job.status === "queued") return "Queued";
  if (job.status === "running") return job.phase ? `Running · ${job.phase}` : "Running";
  if (job.status === "succeeded") return "Succeeded";
  if (job.status === "failed") return "Failed";
  return "Canceled";
}

export function ReleaseRemoteJobsCard({
  activeJobId,
  formatRelativeTime,
  jobs,
  onOpen,
  onRetry,
  scriptLabel,
  shortId,
}: {
  activeJobId: string | null;
  formatRelativeTime: ReleaseRunnerFormatters["formatRelativeTime"];
  jobs: RemoteReleaseJobRow[];
  onOpen: (jobId: string) => void;
  onRetry: (jobId: string) => void;
  scriptLabel: ReleaseRunnerFormatters["scriptLabel"];
  shortId: ReleaseRunnerFormatters["shortId"];
}) {
  return (
    <section className="release-center__remote-jobs" aria-label="Recent remote release jobs">
      <header>
        <div>
          <h2>Recent Remote Jobs</h2>
          <p>Latest Mac mini runner activity. Open a row to inspect its logs.</p>
        </div>
        <strong>{jobs.length ? `${jobs.length} shown` : "No jobs"}</strong>
      </header>
      {jobs.length > 0 ? (
        <div className="release-center__remote-job-list">
          {jobs.map((item) => {
            const active = activeJobId === item.id;
            const canRetry = item.status === "failed" || item.status === "canceled";
            return (
              <div
                className="release-center__remote-job-row"
                data-active={active ? "true" : "false"}
                data-tone={remoteJobStatusTone(item.status)}
                key={item.id}
              >
                <button type="button" onClick={() => onOpen(item.id)}>
                  <span>{scriptLabel(item.script)}</span>
                  <strong>{remoteJobStatusLabel(item)}</strong>
                  <small>
                    {shortId(item.id)} · {item.target || "site"} · updated {formatRelativeTime(item.updatedAt)}
                  </small>
                </button>
                <div className="release-center__remote-job-actions">
                  {item.agentId ? <span>{shortId(item.agentId)}</span> : null}
                  {canRetry ? (
                    <button className="btn btn--secondary" type="button" onClick={() => onRetry(item.id)}>
                      Retry
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="release-center__empty">No remote release jobs have been recorded yet.</p>
      )}
    </section>
  );
}
