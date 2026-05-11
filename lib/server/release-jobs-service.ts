import { randomUUID } from "node:crypto";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { createD1Executor, type D1DatabaseLike } from "./d1-executor.ts";
import type { DbExecutor } from "./db-content-store.ts";

export type ReleaseJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

export type ReleaseJobAction =
  | "status"
  | "smart-release"
  | "publish-content-staging"
  | "deploy-staging-code"
  | "promote-production-code"
  | "publish-content-production-from-staging";

export type ReleaseJobTarget = "staging" | "production";

export type ReleaseJobCommand = {
  action: ReleaseJobAction;
  args: string[];
  npmScript: string;
  target: ReleaseJobTarget;
};

export type ReleaseJobRow = {
  id: string;
  action: ReleaseJobAction;
  script: string;
  target: ReleaseJobTarget;
  status: ReleaseJobStatus;
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
};

export type ReleaseJobEventRow = {
  id: string;
  jobId: string;
  seq: number;
  at: number;
  phase: string;
  stream: "stdout" | "stderr" | "status";
  message: string;
};

export type ReleaseAgentStatus = "idle" | "running";

export type ReleaseAgentRow = {
  agentId: string;
  status: ReleaseAgentStatus;
  currentJobId: string;
  capabilities: ReleaseJobAction[];
  lastSeenAt: number;
  updatedAt: number;
};

export type ReleaseJobServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; error: string };

const MAX_EVENT_MESSAGE_LENGTH = 8000;
export const RELEASE_JOB_STALE_AFTER_MS = 45 * 60 * 1000;

const RELEASE_JOB_COMMANDS: Record<ReleaseJobAction, ReleaseJobCommand> = {
  status: {
    action: "status",
    args: ["run", "release:status:json", "--", "--skip-routes"],
    npmScript: "release:status:json",
    target: "production",
  },
  "smart-release": {
    action: "smart-release",
    args: ["run", "release:site"],
    npmScript: "release:site",
    target: "production",
  },
  "publish-content-staging": {
    action: "publish-content-staging",
    args: ["run", "publish:content:staging"],
    npmScript: "publish:content:staging",
    target: "staging",
  },
  "deploy-staging-code": {
    action: "deploy-staging-code",
    args: ["run", "release:staging"],
    npmScript: "release:staging",
    target: "staging",
  },
  "promote-production-code": {
    action: "promote-production-code",
    args: ["run", "release:prod:from-staging"],
    npmScript: "release:prod:from-staging",
    target: "production",
  },
  "publish-content-production-from-staging": {
    action: "publish-content-production-from-staging",
    args: ["run", "publish:content:prod:from-staging"],
    npmScript: "publish:content:prod:from-staging",
    target: "production",
  },
};

const ACTIONS = new Set(Object.keys(RELEASE_JOB_COMMANDS));
const STATUSES = new Set(["queued", "running", "succeeded", "failed", "canceled"]);
const STREAMS = new Set(["stdout", "stderr", "status"]);
const AGENT_STATUSES = new Set(["idle", "running"]);

function isD1Like(value: unknown): value is D1DatabaseLike {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { prepare?: unknown }).prepare === "function"
  );
}

function tryGetD1Executor(): DbExecutor | null {
  try {
    const { env } = getCloudflareContext();
    const binding = (env as Record<string, unknown>).SITE_ADMIN_DB;
    return isD1Like(binding) ? createD1Executor(binding) : null;
  } catch {
    return null;
  }
}

function serviceError(
  error: string,
  status = 400,
  code = "BAD_REQUEST",
): ReleaseJobServiceResult<never> {
  return { ok: false, status, code, error };
}

function serviceOk<T>(data: T): ReleaseJobServiceResult<T> {
  return { ok: true, data };
}

export function normalizeReleaseJobAction(value: unknown): ReleaseJobAction | null {
  const action = typeof value === "string" ? value.trim() : "";
  return ACTIONS.has(action) ? (action as ReleaseJobAction) : null;
}

export function releaseJobCommand(action: ReleaseJobAction): ReleaseJobCommand {
  return RELEASE_JOB_COMMANDS[action];
}

export function listReleaseJobActions(): ReleaseJobCommand[] {
  return Object.values(RELEASE_JOB_COMMANDS);
}

function normalizeAgentId(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

function normalizeStatus(value: unknown): ReleaseJobStatus | null {
  const status = typeof value === "string" ? value.trim() : "";
  return STATUSES.has(status) ? (status as ReleaseJobStatus) : null;
}

function normalizeStream(value: unknown): ReleaseJobEventRow["stream"] {
  const stream = typeof value === "string" ? value.trim() : "";
  return STREAMS.has(stream) ? (stream as ReleaseJobEventRow["stream"]) : "status";
}

function normalizeAgentStatus(value: unknown): ReleaseAgentStatus {
  const status = typeof value === "string" ? value.trim() : "";
  return AGENT_STATUSES.has(status) ? (status as ReleaseAgentStatus) : "idle";
}

function normalizePhase(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

function normalizeMessage(value: unknown): string {
  const message = typeof value === "string" ? value : String(value ?? "");
  return message.slice(0, MAX_EVENT_MESSAGE_LENGTH);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    return asObject(JSON.parse(value));
  } catch {
    return {};
  }
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function numberOrZero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function rowToReleaseJob(row: Record<string, unknown>): ReleaseJobRow {
  const action = normalizeReleaseJobAction(row.action) ?? "status";
  const target = row.target === "staging" ? "staging" : "production";
  const status = normalizeStatus(row.status) ?? "queued";
  return {
    id: String(row.id || ""),
    action,
    script: String(row.script || releaseJobCommand(action).npmScript),
    target,
    status,
    actor: String(row.actor || "unknown"),
    agentId: String(row.agent_id || ""),
    phase: String(row.phase || ""),
    request: parseJsonObject(row.request_json),
    result: parseJsonObject(row.result_json),
    error: String(row.error || ""),
    createdAt: numberOrZero(row.created_at),
    updatedAt: numberOrZero(row.updated_at),
    claimedAt: numberOrNull(row.claimed_at),
    startedAt: numberOrNull(row.started_at),
    finishedAt: numberOrNull(row.finished_at),
  };
}

function rowToReleaseJobEvent(row: Record<string, unknown>): ReleaseJobEventRow {
  return {
    id: String(row.id || ""),
    jobId: String(row.job_id || ""),
    seq: numberOrZero(row.seq),
    at: numberOrZero(row.at),
    phase: String(row.phase || ""),
    stream: normalizeStream(row.stream),
    message: String(row.message || ""),
  };
}

function rowToReleaseAgent(row: Record<string, unknown>): ReleaseAgentRow {
  const capabilitiesJson = String(row.capabilities_json || "");
  let capabilities: ReleaseJobAction[] = [];
  try {
    const parsed = JSON.parse(capabilitiesJson);
    capabilities = Array.isArray(parsed)
      ? parsed
          .map(normalizeReleaseJobAction)
          .filter((item): item is ReleaseJobAction => Boolean(item))
      : [];
  } catch {
    capabilities = [];
  }
  return {
    agentId: String(row.agent_id || ""),
    status: normalizeAgentStatus(row.status),
    currentJobId: String(row.current_job_id || ""),
    capabilities,
    lastSeenAt: numberOrZero(row.last_seen_at),
    updatedAt: numberOrZero(row.updated_at),
  };
}

function getExecutor(executor?: DbExecutor): ReleaseJobServiceResult<DbExecutor> {
  const resolved = executor ?? tryGetD1Executor();
  if (!resolved) {
    return serviceError(
      "Release jobs require SITE_ADMIN_DB in the Cloudflare runtime.",
      503,
      "DB_BACKEND_UNAVAILABLE",
    );
  }
  return serviceOk(resolved);
}

export async function ensureReleaseJobTables(executor: DbExecutor): Promise<void> {
  await executor.execute({
    sql: `CREATE TABLE IF NOT EXISTS release_jobs (
      id            TEXT PRIMARY KEY,
      action        TEXT NOT NULL,
      script        TEXT NOT NULL,
      target        TEXT NOT NULL,
      status        TEXT NOT NULL,
      actor         TEXT NOT NULL,
      agent_id      TEXT,
      phase         TEXT,
      request_json  TEXT,
      result_json   TEXT,
      error         TEXT,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      claimed_at    INTEGER,
      started_at    INTEGER,
      finished_at   INTEGER
    )`,
  });
  await executor.execute({
    sql: `CREATE INDEX IF NOT EXISTS idx_release_jobs_status_created
      ON release_jobs (status, created_at ASC)`,
  });
  await executor.execute({
    sql: `CREATE INDEX IF NOT EXISTS idx_release_jobs_updated
      ON release_jobs (updated_at DESC)`,
  });
  await executor.execute({
    sql: `CREATE TABLE IF NOT EXISTS release_job_events (
      id       TEXT PRIMARY KEY,
      job_id   TEXT NOT NULL,
      seq      INTEGER NOT NULL,
      at       INTEGER NOT NULL,
      phase    TEXT NOT NULL,
      stream   TEXT NOT NULL,
      message  TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES release_jobs(id) ON DELETE CASCADE
    )`,
  });
  await executor.execute({
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_release_job_events_job_seq
      ON release_job_events (job_id, seq)`,
  });
  await executor.execute({
    sql: `CREATE TABLE IF NOT EXISTS release_agents (
      agent_id          TEXT PRIMARY KEY,
      status            TEXT NOT NULL,
      current_job_id    TEXT,
      capabilities_json TEXT,
      last_seen_at      INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    )`,
  });
  await executor.execute({
    sql: `CREATE INDEX IF NOT EXISTS idx_release_agents_seen
      ON release_agents (last_seen_at DESC)`,
  });
}

export async function createReleaseJob(input: {
  action: unknown;
  actor: string;
  request?: Record<string, unknown>;
  executor?: DbExecutor;
}): Promise<ReleaseJobServiceResult<ReleaseJobRow>> {
  const action = normalizeReleaseJobAction(input.action);
  if (!action) return serviceError("Unsupported release job action.");
  const executor = getExecutor(input.executor);
  if (!executor.ok) return executor;
  await ensureReleaseJobTables(executor.data);

  const command = releaseJobCommand(action);
  const now = Date.now();
  const id = randomUUID();
  await executor.data.execute({
    sql: `INSERT INTO release_jobs (
      id, action, script, target, status, actor, phase, request_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'queued', ?, 'queued', ?, ?, ?)`,
    args: [
      id,
      action,
      command.npmScript,
      command.target,
      input.actor || "unknown",
      JSON.stringify(input.request ?? {}),
      now,
      now,
    ],
  });
  const job = await getReleaseJob({ id, executor: executor.data });
  if (!job.ok) return job;
  return serviceOk(job.data.job);
}

export async function listReleaseJobs(input: {
  limit?: number;
  executor?: DbExecutor;
} = {}): Promise<ReleaseJobServiceResult<{ jobs: ReleaseJobRow[] }>> {
  const executor = getExecutor(input.executor);
  if (!executor.ok) return executor;
  await ensureReleaseJobTables(executor.data);
  await markStaleReleaseJobs({ executor: executor.data });
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(input.limit || 20))));
  const result = await executor.data.execute({
    sql: `SELECT * FROM release_jobs ORDER BY updated_at DESC LIMIT ?`,
    args: [limit],
  });
  return serviceOk({ jobs: result.rows.map(rowToReleaseJob) });
}

export async function getReleaseJob(input: {
  id: string;
  executor?: DbExecutor;
}): Promise<ReleaseJobServiceResult<{ job: ReleaseJobRow; events: ReleaseJobEventRow[] }>> {
  const id = String(input.id || "").trim();
  if (!id) return serviceError("Missing release job id.");
  const executor = getExecutor(input.executor);
  if (!executor.ok) return executor;
  await ensureReleaseJobTables(executor.data);
  await markStaleReleaseJobs({ executor: executor.data });
  const jobResult = await executor.data.execute({
    sql: `SELECT * FROM release_jobs WHERE id = ? LIMIT 1`,
    args: [id],
  });
  const row = jobResult.rows[0];
  if (!row) return serviceError("Release job not found.", 404, "RELEASE_JOB_NOT_FOUND");
  const events = await listReleaseJobEvents({ id, executor: executor.data });
  if (!events.ok) return events;
  return serviceOk({ job: rowToReleaseJob(row), events: events.data.events });
}

export async function listReleaseJobEvents(input: {
  id: string;
  afterSeq?: number;
  limit?: number;
  executor?: DbExecutor;
}): Promise<ReleaseJobServiceResult<{ events: ReleaseJobEventRow[] }>> {
  const id = String(input.id || "").trim();
  if (!id) return serviceError("Missing release job id.");
  const executor = getExecutor(input.executor);
  if (!executor.ok) return executor;
  await ensureReleaseJobTables(executor.data);
  await markStaleReleaseJobs({ executor: executor.data });
  const afterSeq = Math.max(0, Math.trunc(Number(input.afterSeq || 0)));
  const limit = Math.max(1, Math.min(500, Math.trunc(Number(input.limit || 200))));
  const result = await executor.data.execute({
    sql: `SELECT * FROM release_job_events
           WHERE job_id = ? AND seq > ?
           ORDER BY seq ASC
           LIMIT ?`,
    args: [id, afterSeq, limit],
  });
  return serviceOk({ events: result.rows.map(rowToReleaseJobEvent) });
}

export async function heartbeatReleaseAgent(input: {
  agentId: string;
  status?: unknown;
  currentJobId?: unknown;
  capabilities?: unknown[];
  executor?: DbExecutor;
}): Promise<ReleaseJobServiceResult<ReleaseAgentRow>> {
  const agentId = normalizeAgentId(input.agentId);
  if (!agentId) return serviceError("Missing agent id.");
  const executor = getExecutor(input.executor);
  if (!executor.ok) return executor;
  await ensureReleaseJobTables(executor.data);

  const status = normalizeAgentStatus(input.status);
  const currentJobId =
    typeof input.currentJobId === "string" ? input.currentJobId.trim().slice(0, 160) : "";
  const capabilities = Array.isArray(input.capabilities)
    ? input.capabilities
        .map(normalizeReleaseJobAction)
        .filter((item): item is ReleaseJobAction => Boolean(item))
    : listReleaseJobActions().map((item) => item.action);
  const now = Date.now();
  await executor.data.execute({
    sql: `INSERT INTO release_agents (
      agent_id, status, current_job_id, capabilities_json, last_seen_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET
      status = excluded.status,
      current_job_id = excluded.current_job_id,
      capabilities_json = excluded.capabilities_json,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at`,
    args: [
      agentId,
      status,
      currentJobId || null,
      JSON.stringify(capabilities),
      now,
      now,
    ],
  });
  const result = await executor.data.execute({
    sql: `SELECT * FROM release_agents WHERE agent_id = ? LIMIT 1`,
    args: [agentId],
  });
  return serviceOk(rowToReleaseAgent(result.rows[0] ?? { agent_id: agentId }));
}

export async function getReleaseRunnerStatus(input: {
  executor?: DbExecutor;
  limit?: number;
} = {}): Promise<
  ReleaseJobServiceResult<{
    agents: ReleaseAgentRow[];
    queuedCount: number;
    runningCount: number;
  }>
> {
  const executor = getExecutor(input.executor);
  if (!executor.ok) return executor;
  await ensureReleaseJobTables(executor.data);
  await markStaleReleaseJobs({ executor: executor.data });
  const limit = Math.max(1, Math.min(20, Math.trunc(Number(input.limit || 8))));
  const agents = await executor.data.execute({
    sql: `SELECT * FROM release_agents ORDER BY last_seen_at DESC LIMIT ?`,
    args: [limit],
  });
  const counts = await executor.data.execute({
    sql: `SELECT status, COUNT(*) AS count
            FROM release_jobs
           WHERE status IN ('queued', 'running')
           GROUP BY status`,
  });
  let queuedCount = 0;
  let runningCount = 0;
  for (const row of counts.rows) {
    if (row.status === "queued") queuedCount = numberOrZero(row.count);
    if (row.status === "running") runningCount = numberOrZero(row.count);
  }
  return serviceOk({
    agents: agents.rows.map(rowToReleaseAgent),
    queuedCount,
    runningCount,
  });
}

export async function markStaleReleaseJobs(input: {
  executor?: DbExecutor;
  now?: number;
  staleAfterMs?: number;
} = {}): Promise<ReleaseJobServiceResult<{ staleCount: number }>> {
  const executor = getExecutor(input.executor);
  if (!executor.ok) return executor;
  await ensureReleaseJobTables(executor.data);
  const now = Number.isFinite(input.now) ? Math.trunc(Number(input.now)) : Date.now();
  const staleAfterMs = Math.max(
    60_000,
    Math.trunc(Number(input.staleAfterMs || RELEASE_JOB_STALE_AFTER_MS)),
  );
  const cutoff = now - staleAfterMs;
  const stale = await executor.data.execute({
    sql: `SELECT id, agent_id, updated_at
            FROM release_jobs
           WHERE status = 'running' AND updated_at > 0 AND updated_at <= ?`,
    args: [cutoff],
  });
  let staleCount = 0;
  for (const row of stale.rows) {
    const id = String(row.id || "");
    if (!id) continue;
    const update = await executor.data.execute({
      sql: `UPDATE release_jobs
               SET status = 'failed',
                   phase = 'stale',
                   error = ?,
                   finished_at = ?,
                   updated_at = ?
             WHERE id = ? AND status = 'running' AND updated_at <= ?`,
      args: [
        `Release job became stale after ${Math.round(staleAfterMs / 60_000)} minutes without runner updates.`,
        now,
        now,
        id,
        cutoff,
      ],
    });
    if (update.rowsAffected <= 0) continue;
    staleCount += 1;
    await appendReleaseJobEvent({
      id,
      phase: "stale",
      stream: "stderr",
      message: "Release job became stale and was marked failed.",
      executor: executor.data,
    });
    const agentId = normalizeAgentId(row.agent_id);
    if (agentId) {
      await executor.data.execute({
        sql: `UPDATE release_agents
                 SET status = 'idle',
                     current_job_id = NULL,
                     updated_at = ?
               WHERE agent_id = ? AND current_job_id = ?`,
        args: [now, agentId, id],
      });
    }
  }
  return serviceOk({ staleCount });
}

export async function claimReleaseJob(input: {
  agentId: string;
  capabilities?: unknown[];
  preferredJobId?: unknown;
  executor?: DbExecutor;
}): Promise<ReleaseJobServiceResult<{ job: ReleaseJobRow | null; command?: ReleaseJobCommand }>> {
  const agentId = normalizeAgentId(input.agentId);
  if (!agentId) return serviceError("Missing agent id.");
  const executor = getExecutor(input.executor);
  if (!executor.ok) return executor;
  await ensureReleaseJobTables(executor.data);
  await markStaleReleaseJobs({ executor: executor.data });

  const capabilities = Array.isArray(input.capabilities)
    ? input.capabilities
        .map(normalizeReleaseJobAction)
        .filter((item): item is ReleaseJobAction => Boolean(item))
    : listReleaseJobActions().map((item) => item.action);
  await heartbeatReleaseAgent({
    agentId,
    capabilities,
    status: "idle",
    executor: executor.data,
  });
  if (capabilities.length === 0) return serviceOk({ job: null });

  const preferredJobId =
    typeof input.preferredJobId === "string"
      ? input.preferredJobId.trim().slice(0, 160)
      : "";
  const placeholders = capabilities.map(() => "?").join(", ");
  const queued = preferredJobId
    ? await executor.data.execute({
        sql: `SELECT * FROM release_jobs
               WHERE id = ? AND status = 'queued' AND action IN (${placeholders})
               LIMIT 1`,
        args: [preferredJobId, ...capabilities],
      })
    : await executor.data.execute({
        sql: `SELECT * FROM release_jobs
               WHERE status = 'queued' AND action IN (${placeholders})
               ORDER BY created_at ASC
               LIMIT 1`,
        args: capabilities,
      });
  const row = queued.rows[0];
  if (!row) return serviceOk({ job: null });

  const id = String(row.id || "");
  const now = Date.now();
  const update = await executor.data.execute({
    sql: `UPDATE release_jobs
             SET status = 'running',
                 phase = 'claimed',
                 agent_id = ?,
                 claimed_at = ?,
                 started_at = ?,
                 updated_at = ?
           WHERE id = ? AND status = 'queued'`,
    args: [agentId, now, now, now, id],
  });
  if (update.rowsAffected <= 0) return serviceOk({ job: null });

  await heartbeatReleaseAgent({
    agentId,
    capabilities,
    currentJobId: id,
    status: "running",
    executor: executor.data,
  });

  await appendReleaseJobEvent({
    id,
    phase: "claimed",
    stream: "status",
    message: `Claimed by ${agentId}`,
    executor: executor.data,
  });
  const job = await getReleaseJob({ id, executor: executor.data });
  if (!job.ok) return job;
  return serviceOk({
    job: job.data.job,
    command: releaseJobCommand(job.data.job.action),
  });
}

export async function cancelReleaseJob(input: {
  id: string;
  actor?: string;
  executor?: DbExecutor;
}): Promise<ReleaseJobServiceResult<{ job: ReleaseJobRow; events: ReleaseJobEventRow[] }>> {
  const id = String(input.id || "").trim();
  if (!id) return serviceError("Missing release job id.");
  const executor = getExecutor(input.executor);
  if (!executor.ok) return executor;
  await ensureReleaseJobTables(executor.data);
  await markStaleReleaseJobs({ executor: executor.data });

  const current = await getReleaseJob({ id, executor: executor.data });
  if (!current.ok) return current;
  if (!["queued", "running"].includes(current.data.job.status)) {
    return serviceOk(current.data);
  }

  const now = Date.now();
  const actor = String(input.actor || "unknown").trim().slice(0, 160) || "unknown";
  const update = await executor.data.execute({
    sql: `UPDATE release_jobs
             SET status = 'canceled',
                 phase = 'canceled',
                 error = ?,
                 finished_at = ?,
                 updated_at = ?
           WHERE id = ? AND status IN ('queued', 'running')`,
    args: [`Canceled by ${actor}.`, now, now, id],
  });
  if (update.rowsAffected <= 0) {
    const refreshed = await getReleaseJob({ id, executor: executor.data });
    return refreshed.ok ? serviceOk(refreshed.data) : refreshed;
  }
  await appendReleaseJobEvent({
    id,
    phase: "canceled",
    stream: "status",
    message: `Canceled by ${actor}.`,
    executor: executor.data,
  });
  const cancelled = await getReleaseJob({ id, executor: executor.data });
  return cancelled.ok ? serviceOk(cancelled.data) : cancelled;
}

export async function retryReleaseJob(input: {
  id: string;
  actor?: string;
  executor?: DbExecutor;
}): Promise<ReleaseJobServiceResult<ReleaseJobRow>> {
  const id = String(input.id || "").trim();
  if (!id) return serviceError("Missing release job id.");
  const executor = getExecutor(input.executor);
  if (!executor.ok) return executor;
  await ensureReleaseJobTables(executor.data);
  await markStaleReleaseJobs({ executor: executor.data });
  const original = await getReleaseJob({ id, executor: executor.data });
  if (!original.ok) return original;
  if (!["failed", "canceled"].includes(original.data.job.status)) {
    return serviceError("Only failed or canceled release jobs can be retried.");
  }
  const retry = await createReleaseJob({
    action: original.data.job.action,
    actor: input.actor || original.data.job.actor || "unknown",
    request: {
      ...original.data.job.request,
      retryOf: original.data.job.id,
    },
    executor: executor.data,
  });
  if (!retry.ok) return retry;
  await appendReleaseJobEvent({
    id: retry.data.id,
    phase: "queued",
    stream: "status",
    message: `Retry of ${original.data.job.id}.`,
    executor: executor.data,
  });
  return retry;
}

export async function appendReleaseJobEvent(input: {
  id: string;
  phase?: unknown;
  stream?: unknown;
  message: unknown;
  executor?: DbExecutor;
}): Promise<ReleaseJobServiceResult<ReleaseJobEventRow>> {
  const id = String(input.id || "").trim();
  if (!id) return serviceError("Missing release job id.");
  const executor = getExecutor(input.executor);
  if (!executor.ok) return executor;
  await ensureReleaseJobTables(executor.data);

  const phase = normalizePhase(input.phase) || "running";
  const stream = normalizeStream(input.stream);
  const message = normalizeMessage(input.message);
  const now = Date.now();
  const seqResult = await executor.data.execute({
    sql: `SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
            FROM release_job_events
           WHERE job_id = ?`,
    args: [id],
  });
  const seq = Math.max(1, numberOrZero(seqResult.rows[0]?.next_seq));
  const eventId = randomUUID();
  await executor.data.execute({
    sql: `INSERT INTO release_job_events (id, job_id, seq, at, phase, stream, message)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [eventId, id, seq, now, phase, stream, message],
  });
  await executor.data.execute({
    sql: `UPDATE release_jobs
             SET phase = ?,
                 updated_at = ?
           WHERE id = ? AND status = 'running'`,
    args: [phase, now, id],
  });
  return serviceOk({ id: eventId, jobId: id, seq, at: now, phase, stream, message });
}

export async function completeReleaseJob(input: {
  id: string;
  agentId?: string;
  status: unknown;
  error?: unknown;
  result?: Record<string, unknown>;
  executor?: DbExecutor;
}): Promise<ReleaseJobServiceResult<ReleaseJobRow>> {
  const id = String(input.id || "").trim();
  if (!id) return serviceError("Missing release job id.");
  const status = normalizeStatus(input.status);
  if (!status || !["succeeded", "failed", "canceled"].includes(status)) {
    return serviceError("Release job completion status is invalid.");
  }
  const executor = getExecutor(input.executor);
  if (!executor.ok) return executor;
  await ensureReleaseJobTables(executor.data);

  const now = Date.now();
  const phase = status === "succeeded" ? "complete" : status;
  const error = status === "succeeded" ? "" : normalizeMessage(input.error);
  const update = await executor.data.execute({
    sql: `UPDATE release_jobs
             SET status = ?,
                 phase = ?,
                 error = ?,
                 result_json = ?,
                 finished_at = ?,
                 updated_at = ?
           WHERE id = ? AND status = 'running'`,
    args: [
      status,
      phase,
      error || null,
      JSON.stringify(input.result ?? {}),
      now,
      now,
      id,
    ],
  });
  if (update.rowsAffected <= 0) {
    const current = await getReleaseJob({ id, executor: executor.data });
    return current.ok ? serviceOk(current.data.job) : current;
  }
  await appendReleaseJobEvent({
    id,
    phase,
    stream: status === "succeeded" ? "status" : "stderr",
    message: status === "succeeded" ? "Release job completed." : error || "Release job failed.",
    executor: executor.data,
  });
  const job = await getReleaseJob({ id, executor: executor.data });
  if (!job.ok) return job;
  const agentId = normalizeAgentId(input.agentId);
  if (agentId) {
    await heartbeatReleaseAgent({
      agentId,
      currentJobId: "",
      status: "idle",
      executor: executor.data,
    });
  }
  return serviceOk(job.data.job);
}
