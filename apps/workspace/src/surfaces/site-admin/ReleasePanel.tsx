import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import {
  openExternalUrl,
  workspaceMcpContentPublishSuggestionClear,
  workspaceMcpContentPublishSuggestionGet,
} from "../../lib/tauri";
import { notify } from "../../lib/notify";
import {
  siteAdminCancelReleaseJob,
  siteAdminLocalReleaseSource,
  siteAdminReleaseHistory,
  siteAdminRunReleaseCommand,
  siteAdminStartReleaseJob,
  siteAdminStartRollbackJob,
  type SiteAdminLocalReleaseSource,
  type SiteAdminReleaseHistoryEntry,
  type SiteAdminReleaseJobEvent,
  type SiteAdminReleaseJobState,
  type SiteAdminReleaseScript,
} from "../../modules/site-admin/tauri";
import { dispatchReleaseState } from "../../shell/useTrayBindings";
import {
  branchLabel,
  candidateLabel,
  deriveReleasePlan,
  LEGACY_RELEASE_PROD_COMMAND,
  PUBLISH_CONTENT_PROD_COMMAND,
  PUBLISH_CONTENT_PROD_CLEAR_COMMAND,
  PUBLISH_CONTENT_PROD_CLEAR_SCRIPT,
  PUBLISH_CONTENT_PROD_FROM_STAGING_COMMAND,
  PUBLISH_CONTENT_PROD_FROM_STAGING_SCRIPT,
  PUBLISH_CONTENT_PROD_SCRIPT,
  PUBLISH_CONTENT_PROD_ROLLBACK_COMMAND,
  PUBLISH_CONTENT_PROD_ROLLBACK_SCRIPT,
  PUBLISH_CONTENT_STAGING_CLEAR_COMMAND,
  PUBLISH_CONTENT_STAGING_CLEAR_SCRIPT,
  PUBLISH_CONTENT_STAGING_COMMAND,
  PUBLISH_CONTENT_STAGING_ROLLBACK_COMMAND,
  PUBLISH_CONTENT_STAGING_ROLLBACK_SCRIPT,
  PUBLISH_CONTENT_STAGING_SCRIPT,
  RELEASE_PROD_FROM_STAGING_COMMAND,
  RELEASE_PROD_FROM_STAGING_DRY_RUN_COMMAND,
  RELEASE_PROD_FROM_STAGING_SCRIPT,
  RELEASE_STAGING_COMMAND,
  RELEASE_STAGING_SCRIPT,
  type ReleaseActionKind,
  type ReleasePlan,
  type ReleaseTarget,
  releaseWorkflowRecovery,
  shortId,
  shortSha,
  normalizeStatusPayload,
} from "./release-flow-model";
import {
  clearContentPublishSuggestion,
  listenForContentPublishSuggestion,
  readContentPublishSuggestion,
  type ContentPublishSuggestion,
} from "./publish-suggestion";
import {
  ReleaseRemoteJobsCard,
  ReleaseRunnerStatusCard,
  type ReleaseExecutionMode,
  type RemoteReleaseAgentRow,
  type RemoteReleaseJobAction,
  type RemoteReleaseJobRow,
  type RemoteReleaseJobStatus,
  type RemoteReleaseRunnerStatus,
  type RemoteReleaseWakeResult,
} from "./release-runner-cards";
import { useSiteAdmin } from "./state";
import type { StatusPayload } from "./types";
import { getSiteAdminEnvironment, normalizeString } from "./utils";

const PRODUCTION_RUNBOOK_PATH = "docs/runbooks/production-promotion.md";
const PRODUCTION_HISTORY_FILE = "docs/runbooks/production-version-history.md";
const PREFLIGHT_COMMAND = [
  "git switch main",
  "git pull --ff-only",
  "git status --short",
  RELEASE_PROD_FROM_STAGING_DRY_RUN_COMMAND,
  "npm run verify:staging:authenticated",
  "npm run check:staging-visual",
].join("\n");

type ReleaseTone = "ok" | "warn" | "blocked" | "muted";
type ReleaseStage =
  | "switch-profile"
  | "needs-staging"
  | "checking"
  | "ready"
  | "current"
  | "running"
  | "failed";

type ReleaseLogLine = {
  id: string;
  atMs: number;
  phase: string;
  stream: string;
  message: string;
};

interface RemoteReleaseJobEventRow {
  id: string;
  jobId: string;
  seq: number;
  at: number;
  phase: string;
  stream: "stdout" | "stderr" | "status";
  message: string;
}

type ReleaseCheck = {
  detail: string;
  label: string;
  tone: ReleaseTone;
  value: string;
};

interface LiveReleaseRoute {
  ok: boolean;
  path: string;
  reason?: string;
  skipped?: boolean;
  staging: {
    status: number;
    location?: string;
    staticShell: string;
    staticOverlay: string;
    hash: string;
  };
  production: {
    status: number;
    location?: string;
    staticShell: string;
    staticOverlay: string;
    hash: string;
  };
}

interface LiveReleaseStatus {
  checkedAt: string;
  plan?: {
    kind: ReleaseActionKind;
    label: string;
    reason: string;
    script: ReleasePlan["script"];
  };
  routeParity?: {
    ok: boolean;
    checkedCount?: number;
    mismatchCount: number;
    skippedCount?: number;
    error?: string;
    routes: LiveReleaseRoute[];
  } | null;
  overlays?: {
    staging?: {
      status?: {
        snapshotSha?: string;
        fileCount?: number;
        exists?: boolean;
        publishedAt?: string;
      };
    };
    production?: {
      status?: {
        snapshotSha?: string;
        fileCount?: number;
        exists?: boolean;
        publishedAt?: string;
      };
    };
  };
}

function isOnlyProductionHistoryDirty(files: string[] | undefined): boolean {
  return Boolean(
    files?.length && files.every((file) => file === PRODUCTION_HISTORY_FILE),
  );
}

function parseJsonObjectFromTail(raw: string): unknown {
  const text = String(raw || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function parseLiveReleaseStatus(raw: string): LiveReleaseStatus | null {
  const parsed = parseJsonObjectFromTail(raw);
  if (!parsed || typeof parsed !== "object") return null;
  return parsed as LiveReleaseStatus;
}

function releasePlanFromLiveStatus(
  liveStatus: LiveReleaseStatus | null,
): ReleasePlan | null {
  const plan = liveStatus?.plan;
  if (!plan) return null;
  const validKinds: ReleaseActionKind[] = [
    "publish-content-staging",
    "deploy-staging-code",
    "promote-production-code",
    "publish-content-production-from-staging",
    "noop",
    "blocked",
  ];
  if (!validKinds.includes(plan.kind)) return null;
  const tone: ReleasePlan["tone"] =
    plan.kind === "noop"
      ? "ok"
      : plan.kind === "blocked"
        ? "blocked"
        : "warn";
  return {
    detail: plan.reason,
    disabled: plan.kind === "blocked",
    kind: plan.kind,
    label: plan.label,
    reason: plan.reason,
    script: plan.script || "",
    tone,
  };
}

interface EnvironmentSnapshot {
  workerName: string;
  versionId: string;
  deploymentId: string;
  codeSha: string;
  contentSha: string;
  contentBranch: string;
}

interface ContentDeltaEntry {
  relPath: string;
  sizeBytes: number;
  sha: string;
  updatedAtMs: number;
  updatedBy: string | null;
}

interface ContentDelta {
  totalRows: number;
  changedRows: number;
  files: ContentDeltaEntry[];
  truncated: boolean;
  error: string;
}

type PromotePreview =
  | {
      ok: true;
      mainSha: string;
      stagingSha: string;
      staging: EnvironmentSnapshot;
      production: EnvironmentSnapshot | null;
      stagingMatchesMain: boolean;
      productionDifferent: boolean;
      runsListUrl: string;
      contentDelta: ContentDelta;
    }
  | {
      ok: false;
      code: string;
      detail: string;
    };

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function pickNewerContentSuggestion(
  current: ContentPublishSuggestion | null,
  next: ContentPublishSuggestion | null,
): ContentPublishSuggestion | null {
  if (!next) return current;
  if (!current || next.atMs >= current.atMs) return next;
  return current;
}

function mergeContentSuggestions(
  ...suggestions: Array<ContentPublishSuggestion | null>
): ContentPublishSuggestion | null {
  return suggestions.reduce<ContentPublishSuggestion | null>(
    (current, next) => pickNewerContentSuggestion(current, next),
    null,
  );
}

async function clearContentPublishSuggestionEverywhere(): Promise<void> {
  clearContentPublishSuggestion();
  if (isTauriRuntime()) {
    await workspaceMcpContentPublishSuggestionClear().catch(() => undefined);
  }
  clearContentPublishSuggestion();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function asNullableNumber(value: unknown): number | null {
  const n = asNumber(value);
  return n > 0 ? n : null;
}

function asFiniteNumberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function parseSnapshot(raw: unknown): EnvironmentSnapshot | null {
  const rec = asRecord(raw);
  if (Object.keys(rec).length === 0) return null;
  return {
    workerName: asString(rec.workerName),
    versionId: asString(rec.versionId),
    deploymentId: asString(rec.deploymentId),
    codeSha: asString(rec.codeSha),
    contentSha: asString(rec.contentSha),
    contentBranch: asString(rec.contentBranch),
  };
}

function parseContentDeltaEntry(raw: unknown): ContentDeltaEntry | null {
  const rec = asRecord(raw);
  const relPath = asString(rec.relPath);
  if (!relPath) return null;
  return {
    relPath,
    sizeBytes: typeof rec.sizeBytes === "number" ? rec.sizeBytes : 0,
    sha: asString(rec.sha),
    updatedAtMs: typeof rec.updatedAtMs === "number" ? rec.updatedAtMs : 0,
    updatedBy: typeof rec.updatedBy === "string" ? rec.updatedBy : null,
  };
}

function parseContentDelta(raw: unknown): ContentDelta {
  const rec = asRecord(raw);
  const filesRaw = Array.isArray(rec.files) ? rec.files : [];
  return {
    totalRows: typeof rec.totalRows === "number" ? rec.totalRows : 0,
    changedRows: typeof rec.changedRows === "number" ? rec.changedRows : 0,
    files: filesRaw
      .map(parseContentDeltaEntry)
      .filter((entry): entry is ContentDeltaEntry => entry !== null),
    truncated: rec.truncated === true,
    error: asString(rec.error),
  };
}

function parsePromotePreview(raw: unknown): PromotePreview {
  const wrapper = asRecord(raw);
  const inner = asRecord(wrapper.preview);
  if (inner.ok === false) {
    return {
      ok: false,
      code: asString(inner.code) || "ERROR",
      detail: asString(inner.detail),
    };
  }
  if (inner.ok === true) {
    const staging = parseSnapshot(inner.staging);
    if (!staging) {
      return {
        ok: false,
        code: "INVALID_PREVIEW",
        detail: "preview missing staging snapshot",
      };
    }
    return {
      ok: true,
      mainSha: asString(inner.mainSha),
      stagingSha: asString(inner.stagingSha),
      staging,
      production: parseSnapshot(inner.production),
      stagingMatchesMain: inner.stagingMatchesMain === true,
      productionDifferent: inner.productionDifferent !== false,
      runsListUrl: asString(inner.runsListUrl),
      contentDelta: parseContentDelta(inner.contentDelta),
    };
  }
  return {
    ok: false,
    code: "INVALID_PREVIEW",
    detail: "preview envelope missing ok flag",
  };
}

function productionCommandFor(
  status: StatusPayload | null,
  preview: PromotePreview | null,
): string {
  const contentSha = normalizeString(status?.source?.contentSha);
  const contentBranch = normalizeString(
    status?.source?.contentBranch || status?.source?.branch,
  );
  const lines = [RELEASE_PROD_FROM_STAGING_COMMAND];
  if (preview?.ok && preview.mainSha) {
    lines.push(`# release source: ${shortSha(preview.mainSha)}`);
  }
  if (contentSha || contentBranch) {
    lines.push(
      `# staging content: ${contentSha ? shortSha(contentSha) : "unknown"} ${contentBranch}`,
    );
  }
  return lines.join("\n");
}

function releaseChecks(
  status: StatusPayload | null,
  isStaging: boolean,
  preview: PromotePreview | null,
  localSource: SiteAdminLocalReleaseSource | null,
): ReleaseCheck[] {
  const source = status?.source;
  const candidateReady = source?.deployableVersionReady;
  const pendingDeploy = source?.pendingDeploy;
  const codeSha = normalizeString(source?.codeSha);
  const contentSha = normalizeString(source?.contentSha);
  const previewReady = preview?.ok === true;
  const productionDifferent = previewReady ? preview.productionDifferent : false;
  const localSha = normalizeString(localSource?.sha);
  const stagingCodeSha = normalizeString(previewReady ? preview.staging.codeSha : codeSha);
  const productionHistoryOnlyDirty = isOnlyProductionHistoryDirty(localSource?.dirty_files);
  const localDirty = Boolean(localSource?.dirty && !productionHistoryOnlyDirty);
  const localMismatch = Boolean(localSha && stagingCodeSha && localSha !== stagingCodeSha);
  return [
    ...(localSource
      ? [
          {
            detail: localDirty
              ? `${localSource.dirty_file_count} local file${localSource.dirty_file_count === 1 ? "" : "s"} must be committed before production promotion.`
              : localMismatch
                ? `Staging is ${shortSha(stagingCodeSha)}, but local release source is ${shortSha(localSha)}. Deploy staging first.`
                : productionHistoryOnlyDirty
                  ? "Only the production version history audit log changed; release jobs can continue."
                : "Local release source matches staging.",
            label: "Local source",
            tone: localDirty || localMismatch ? "blocked" : productionHistoryOnlyDirty ? "warn" : "ok",
            value: localDirty ? "Dirty" : localMismatch ? "Mismatch" : productionHistoryOnlyDirty ? "History log" : shortSha(localSha),
          } satisfies ReleaseCheck,
        ]
      : []),
    {
      detail: isStaging
        ? "Connected to the staging candidate."
        : "Switch to Staging before deploying or promoting.",
      label: "Profile",
      tone: isStaging ? "ok" : "blocked",
      value: isStaging ? "Staging" : "Not staging",
    },
    {
      detail:
        previewReady && preview.stagingMatchesMain
          ? "Live staging matches the release source."
          : previewReady
            ? "Staging runtime and active deployment disagree."
            : "Load staging preflight to compare both environments.",
      label: "Staging preflight",
      tone: previewReady && preview.stagingMatchesMain ? "ok" : "blocked",
      value: previewReady && preview.stagingMatchesMain ? "Matched" : "Needs staging",
    },
    {
      detail:
        source?.deployableVersionReason ||
        "Latest uploaded Worker version should match current code/content.",
      label: "Worker candidate",
      tone: candidateReady === true ? "ok" : candidateReady === false ? "blocked" : "warn",
      value: candidateLabel(source),
    },
    {
      detail:
        pendingDeploy === true
          ? "Deploy staging first, then promote the verified candidate."
          : "Staging appears current for this source.",
      label: "Staging deploy",
      tone: pendingDeploy === true ? "blocked" : "ok",
      value: pendingDeploy === true ? "Pending" : "Current",
    },
    {
      detail: codeSha ? "Code SHA reported by staging." : "Status did not include a code SHA.",
      label: "Code SHA",
      tone: codeSha ? "ok" : "warn",
      value: shortSha(codeSha),
    },
    {
      detail: contentSha
        ? `Content comes from ${branchLabel(source)}.`
        : "Content SHA is unavailable.",
      label: "Content SHA",
      tone: contentSha ? "ok" : "warn",
      value: contentSha ? shortSha(contentSha) : "-",
    },
    {
      detail: previewReady
        ? productionDifferent
          ? "Production differs from the verified staging candidate."
          : "Production already runs the same active snapshot."
        : preview?.detail || "Load staging preflight.",
      label: "Production delta",
      tone: previewReady ? (productionDifferent ? "warn" : "ok") : "muted",
      value: previewReady ? (productionDifferent ? "Differs" : "Current") : "Unknown",
    },
    {
      detail: !previewReady
        ? "Load staging preflight."
        : preview.contentDelta.error
          ? `Could not compute content delta: ${preview.contentDelta.error}`
          : preview.contentDelta.changedRows === 0
            ? "No staging D1 edits since production deploy."
            : `${preview.contentDelta.changedRows} content file${preview.contentDelta.changedRows === 1 ? "" : "s"} will land on production.`,
      label: "Content delta",
      tone: !previewReady
        ? "muted"
        : preview.contentDelta.error
          ? "warn"
          : preview.contentDelta.changedRows === 0
            ? "ok"
            : "warn",
      value: !previewReady
        ? "Unknown"
        : preview.contentDelta.error
          ? "Unavailable"
          : preview.contentDelta.changedRows === 0
            ? "No edits"
            : `${preview.contentDelta.changedRows} file${preview.contentDelta.changedRows === 1 ? "" : "s"}`,
    },
  ];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatRelativeTime(ms: number, now = Date.now()): string {
  if (!ms) return "";
  const delta = now - ms;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

function scriptLabel(script: string): string {
  if (script === "release:status:json" || script === "release:status:staging:json") return "Checking release status";
  if (script === "release:site") return "Smart Release";
  if (script === PUBLISH_CONTENT_STAGING_SCRIPT) return "Publishing content";
  if (script === PUBLISH_CONTENT_PROD_SCRIPT) return "Publishing production content";
  if (script === PUBLISH_CONTENT_PROD_FROM_STAGING_SCRIPT) return "Publishing production content from staging";
  if (script === PUBLISH_CONTENT_STAGING_ROLLBACK_SCRIPT) return "Rolling back staging content";
  if (script === PUBLISH_CONTENT_PROD_ROLLBACK_SCRIPT) return "Rolling back production content";
  if (script === PUBLISH_CONTENT_STAGING_CLEAR_SCRIPT) return "Clearing staging content overlay";
  if (script === PUBLISH_CONTENT_PROD_CLEAR_SCRIPT) return "Clearing production content overlay";
  if (script === RELEASE_STAGING_SCRIPT) return "Deploying staging";
  if (script === RELEASE_PROD_FROM_STAGING_SCRIPT) return "Promoting production";
  if (script.startsWith("rollback:production")) return "Rolling back production";
  return script || "Release job";
}

function remoteActionForScript(
  script: SiteAdminReleaseScript,
): RemoteReleaseJobAction | null {
  if (script === "release:status:json" || script === "release:status:staging:json") return "status";
  if (script === PUBLISH_CONTENT_STAGING_SCRIPT) return "publish-content-staging";
  if (script === RELEASE_STAGING_SCRIPT) return "deploy-staging-code";
  if (script === RELEASE_PROD_FROM_STAGING_SCRIPT) return "promote-production-code";
  if (script === PUBLISH_CONTENT_PROD_FROM_STAGING_SCRIPT) {
    return "publish-content-production-from-staging";
  }
  return null;
}

function parseRemoteReleaseJob(raw: unknown): RemoteReleaseJobRow | null {
  const rec = asRecord(raw);
  const id = asString(rec.id);
  if (!id) return null;
  const status = asString(rec.status);
  const normalizedStatus: RemoteReleaseJobStatus =
    status === "queued" ||
    status === "running" ||
    status === "succeeded" ||
    status === "failed" ||
    status === "canceled"
      ? status
      : "queued";
  return {
    id,
    action: asString(rec.action),
    actor: asString(rec.actor),
    agentId: asString(rec.agentId),
    createdAt: asNumber(rec.createdAt),
    claimedAt: asNullableNumber(rec.claimedAt),
    error: asString(rec.error),
    finishedAt: asNullableNumber(rec.finishedAt),
    phase: asString(rec.phase) || normalizedStatus,
    request: asRecord(rec.request),
    result: asRecord(rec.result),
    script: asString(rec.script),
    startedAt: asNullableNumber(rec.startedAt),
    status: normalizedStatus,
    target: asString(rec.target),
    updatedAt: asNumber(rec.updatedAt),
  };
}

function parseRemoteReleaseJobEvent(raw: unknown): RemoteReleaseJobEventRow | null {
  const rec = asRecord(raw);
  const id = asString(rec.id);
  const jobId = asString(rec.jobId);
  if (!id || !jobId) return null;
  const stream = asString(rec.stream);
  return {
    id,
    at: asNumber(rec.at),
    jobId,
    message: asString(rec.message),
    phase: asString(rec.phase) || "running",
    seq: asNumber(rec.seq),
    stream: stream === "stdout" || stream === "stderr" ? stream : "status",
  };
}

function parseRemoteReleaseJobPayload(
  raw: unknown,
): { job: RemoteReleaseJobRow; events: RemoteReleaseJobEventRow[] } | null {
  const rec = asRecord(raw);
  const job = parseRemoteReleaseJob(rec.job);
  if (!job) return null;
  const events = Array.isArray(rec.events)
    ? rec.events
        .map(parseRemoteReleaseJobEvent)
        .filter((event): event is RemoteReleaseJobEventRow => event !== null)
    : [];
  return { job, events };
}

function parseRemoteReleaseAgent(raw: unknown): RemoteReleaseAgentRow | null {
  const rec = asRecord(raw);
  const agentId = asString(rec.agentId);
  if (!agentId) return null;
  const status = asString(rec.status);
  const capabilities = Array.isArray(rec.capabilities)
    ? rec.capabilities.map(asString).filter(Boolean)
    : [];
  return {
    agentId,
    capabilities,
    currentJobId: asString(rec.currentJobId),
    lastSeenAt: asNumber(rec.lastSeenAt),
    status: status === "running" ? "running" : "idle",
    updatedAt: asNumber(rec.updatedAt),
  };
}

function parseRemoteReleaseRunnerStatus(raw: unknown): RemoteReleaseRunnerStatus | null {
  const rec = asRecord(raw);
  const agents = Array.isArray(rec.agents)
    ? rec.agents
        .map(parseRemoteReleaseAgent)
        .filter((agent): agent is RemoteReleaseAgentRow => agent !== null)
    : [];
  return {
    agents,
    observedAt: Date.now(),
    queuedCount: asNumber(rec.queuedCount),
    runningCount: asNumber(rec.runningCount),
  };
}

function parseRemoteReleaseWake(raw: unknown): RemoteReleaseWakeResult | null {
  const rec = asRecord(raw);
  if (!("configured" in rec) && !("ok" in rec)) return null;
  return {
    configured: Boolean(rec.configured),
    error: asString(rec.error),
    ok: Boolean(rec.ok),
    status: asNumber(rec.status),
  };
}

function localStatusFromRemote(
  status: RemoteReleaseJobStatus,
): SiteAdminReleaseJobState["status"] {
  if (status === "succeeded") return "succeeded";
  if (status === "failed") return "failed";
  if (status === "canceled") return "cancelled";
  return "running";
}

function remoteReleaseJobToLocalState(
  job: RemoteReleaseJobRow,
): SiteAdminReleaseJobState {
  const startedAt = job.startedAt || job.claimedAt || job.createdAt || Date.now();
  const finishedAt = job.finishedAt;
  const durationMs = finishedAt ? Math.max(0, finishedAt - startedAt) : null;
  const exitCode = asFiniteNumberOrNull(job.result.exitCode);
  return {
    command: `Mac mini runner · npm run ${job.script || job.action}`,
    cwd: "remote release runner",
    duration_ms: durationMs,
    error: job.error,
    exit_code: exitCode,
    finished_at_ms: finishedAt,
    job_id: job.id,
    phase: job.status === "queued" ? "queued for Mac mini runner" : job.phase,
    script: job.script || job.action,
    started_at_ms: startedAt,
    status: localStatusFromRemote(job.status),
    stderr_tail: job.error,
    stdout_tail: asString(job.result.stdoutTail),
  };
}

function remoteEventsToLogLines(
  job: RemoteReleaseJobRow,
  events: RemoteReleaseJobEventRow[],
): ReleaseLogLine[] {
  if (events.length === 0) {
    return [
      {
        id: `${job.id}:queued`,
        atMs: job.createdAt || Date.now(),
        message: "Queued for Mac mini runner.",
        phase: "queued",
        stream: "status",
      },
    ];
  }
  return events.slice(-180).map((event) => ({
    id: event.id,
    atMs: event.at,
    message: event.message,
    phase: event.phase,
    stream: event.stream,
  }));
}

function actionForState({
  isStaging,
  job,
  localDirty,
  localStagingMismatch,
  preview,
  productionAlreadyCurrent,
  ready,
  readyToPromote,
  status,
}: {
  isStaging: boolean;
  job: SiteAdminReleaseJobState | null;
  localDirty: boolean;
  localStagingMismatch: boolean;
  preview: PromotePreview | null;
  productionAlreadyCurrent: boolean;
  ready: boolean;
  readyToPromote: boolean;
  status: StatusPayload | null;
}) {
  const running = job?.status === "running";
  if (!isStaging) {
    return {
      stage: "switch-profile" as ReleaseStage,
      label: "Switch to Staging",
      detail: "Production is inspect-only. Start releases from Staging.",
      disabled: false,
      kind: "switch" as const,
    };
  }
  if (running) {
    return {
      stage: "running" as ReleaseStage,
      label: "Release running",
      detail: `${scriptLabel(job.script)} · ${job.phase}`,
      disabled: true,
      kind: "none" as const,
    };
  }
  if (!ready) {
    return {
      stage: "failed" as ReleaseStage,
      label: "Connect to Staging",
      detail: "Sign in to the staging profile before releasing.",
      disabled: true,
      kind: "none" as const,
    };
  }
  if (localDirty) {
    return {
      stage: "failed" as ReleaseStage,
      label: "Commit Changes",
      detail: "Production promotion requires a clean local release source.",
      disabled: true,
      kind: "none" as const,
    };
  }
  if (
    localStagingMismatch ||
    status?.source?.deployableVersionReady === false ||
    status?.source?.pendingDeploy === true ||
    (preview?.ok === true && !preview.stagingMatchesMain)
  ) {
    return {
      stage: "needs-staging" as ReleaseStage,
      label: "Deploy Staging",
      detail: localStagingMismatch
        ? "Staging is behind the local release source. Deploy staging first."
        : "Build and deploy the committed release source to staging.",
      disabled: false,
      kind: "staging" as const,
    };
  }
  if (readyToPromote) {
    return {
      stage: "ready" as ReleaseStage,
      label: "Promote Production",
      detail: "Production will receive the verified staging candidate.",
      disabled: false,
      kind: "promote" as const,
    };
  }
  if (productionAlreadyCurrent) {
    return {
      stage: "current" as ReleaseStage,
      label: "Refresh Status",
      detail: "Production already matches staging.",
      disabled: false,
      kind: "refresh" as const,
    };
  }
  return {
    stage: "checking" as ReleaseStage,
    label: "Run Preflight",
    detail: "Refresh staging and production comparison.",
    disabled: false,
    kind: "preflight" as const,
  };
}

function appendLogLine(
  current: ReleaseLogLine[],
  event: SiteAdminReleaseJobEvent,
): ReleaseLogLine[] {
  const message = event.message.trimEnd();
  if (!message) return current;
  return [
    ...current,
    {
      id: `${event.job_id}:${Date.now()}:${current.length}`,
      atMs: Date.now(),
      phase: event.phase,
      stream: event.stream,
      message,
    },
  ].slice(-180);
}

export function ReleasePanel() {
  const {
    connection,
    environment,
    profiles,
    request,
    setMessage,
    switchProfile,
  } = useSiteAdmin();
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [preview, setPreview] = useState<PromotePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [job, setJob] = useState<SiteAdminReleaseJobState | null>(null);
  const [jobLog, setJobLog] = useState<ReleaseLogLine[]>([]);
  const [releaseTarget, setReleaseTarget] = useState<ReleaseTarget>("production");
  const [releaseExecutionMode, setReleaseExecutionMode] =
    useState<ReleaseExecutionMode>("remote");
  const [activeRemoteJobId, setActiveRemoteJobId] = useState<string | null>(null);
  const [runnerStatus, setRunnerStatus] = useState<RemoteReleaseRunnerStatus | null>(null);
  const [remoteJobs, setRemoteJobs] = useState<RemoteReleaseJobRow[]>([]);
  const [pendingProductionContinuation, setPendingProductionContinuation] = useState(false);
  const [history, setHistory] = useState<SiteAdminReleaseHistoryEntry[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [liveStatus, setLiveStatus] = useState<LiveReleaseStatus | null>(null);
  const [liveStatusError, setLiveStatusError] = useState("");
  const [localSource, setLocalSource] = useState<SiteAdminLocalReleaseSource | null>(null);
  const [contentSuggestion, setContentSuggestion] =
    useState<ContentPublishSuggestion | null>(() => readContentPublishSuggestion());
  const [rollbackCandidate, setRollbackCandidate] =
    useState<SiteAdminReleaseHistoryEntry | null>(null);

  const stagingProfile = useMemo(
    () =>
      profiles.find(
        (profile) => getSiteAdminEnvironment(profile.baseUrl).kind === "staging",
      ) ?? null,
    [profiles],
  );
  const isStaging = environment.kind === "staging";
  const canRunLocalRelease = isTauriRuntime();
  const ready = Boolean(connection.baseUrl && connection.authToken);
  const stagingWorkflow = releaseWorkflowRecovery(status?.source);
  const productionAlreadyCurrent = preview?.ok === true && !preview.productionDifferent;
  const localSha = normalizeString(localSource?.sha);
  const stagingCodeSha = normalizeString(
    preview?.ok === true ? preview.staging.codeSha : status?.source?.codeSha,
  );
  const productionHistoryOnlyDirty = isOnlyProductionHistoryDirty(localSource?.dirty_files);
  const localDirty = Boolean(localSource?.dirty && !productionHistoryOnlyDirty);
  const localStagingMismatch = Boolean(
    isStaging &&
      localSource &&
      !localDirty &&
      localSha &&
      stagingCodeSha &&
      localSha !== stagingCodeSha,
  );
  const readyToPromote =
    isStaging &&
    !localDirty &&
    !localStagingMismatch &&
    status?.source?.deployableVersionReady === true &&
    status.source.pendingDeploy !== true &&
    preview?.ok === true &&
    preview.stagingMatchesMain &&
    !productionAlreadyCurrent;
  const checks = releaseChecks(status, isStaging, preview, localSource);
  const blockers = checks.filter((check) => check.tone !== "ok");
  const blockingChecks = blockers.filter((check) => check.tone === "blocked");
  const primaryAction = actionForState({
    isStaging,
    job,
    localDirty,
    localStagingMismatch,
    preview,
    productionAlreadyCurrent,
    ready,
    readyToPromote,
    status,
  });
  const stagingContent = latestContentOverlayEntry(history, "staging");
  const productionContent = latestContentOverlayEntry(history, "production");
  const stagingOverlaySnapshot =
    normalizeString(liveStatus?.overlays?.staging?.status?.snapshotSha) ||
    overlaySnapshotFromEntry(stagingContent);
  const productionOverlaySnapshot =
    normalizeString(liveStatus?.overlays?.production?.status?.snapshotSha) ||
    overlaySnapshotFromEntry(productionContent);
  const productionCodeMatchesStaging = Boolean(
    preview?.ok === true &&
      preview.production &&
      normalizeString(preview.production.codeSha) === normalizeString(preview.staging.codeSha),
  );
  const fallbackSmartPlan = deriveReleasePlan({
    contentChanged: Boolean(contentSuggestion),
    isStaging,
    jobRunning: job?.status === "running",
    localDirty,
    localStagingMismatch,
    productionAlreadyCurrent,
    productionCodeMatchesStaging,
    productionOverlaySnapshot,
    ready,
    readyToPromote,
    stagingOverlaySnapshot,
    status,
    target: releaseTarget,
  });
  const livePlan =
    ready && job?.status !== "running"
      ? releasePlanFromLiveStatus(liveStatus)
      : null;
  const stagingOverlayPublishedAtMs = Date.parse(
    liveStatus?.overlays?.staging?.status?.publishedAt || "",
  );
  const contentSuggestionSatisfiedByStagingOverlay = Boolean(
    contentSuggestion &&
      stagingOverlayPublishedAtMs &&
      stagingOverlayPublishedAtMs >= contentSuggestion.atMs,
  );
  const canContinueAfterStagingContent =
    (pendingProductionContinuation || contentSuggestionSatisfiedByStagingOverlay) &&
    (livePlan?.kind === "publish-content-production-from-staging" ||
      livePlan?.kind === "promote-production-code");
  const liveSmartPlan =
    !contentSuggestion || canContinueAfterStagingContent
      ? livePlan
      : null;
  const continuationPlan: ReleasePlan | null =
    pendingProductionContinuation &&
    releaseTarget === "production" &&
    isStaging &&
    ready &&
    !localDirty &&
    job?.status !== "running"
      ? productionCodeMatchesStaging
        ? {
            detail: "The staging step finished. Copy the verified staging content overlay to production.",
            disabled: false,
            kind: "publish-content-production-from-staging",
            label: "Publish Same Content to Production",
            reason: "Staging content is verified; production is next.",
            script: PUBLISH_CONTENT_PROD_FROM_STAGING_SCRIPT,
            tone: "warn",
          }
        : {
            detail: "The staging step finished. Promote the verified staging Worker before copying content.",
            disabled: false,
            kind: "promote-production-code",
            label: "Promote Production",
            reason: "Staging is verified; production is next.",
            script: RELEASE_PROD_FROM_STAGING_SCRIPT,
            tone: "warn",
          }
      : null;
  const smartPlan = continuationPlan || liveSmartPlan || fallbackSmartPlan;

  const loadHistory = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      setHistory(await siteAdminReleaseHistory(12));
      setHistoryError("");
    } catch (err) {
      setHistoryError(String(err));
    }
  }, []);

  const loadLocalSource = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      setLocalSource(await siteAdminLocalReleaseSource());
    } catch {
      setLocalSource(null);
    }
  }, []);

  const loadLiveStatus = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const script =
        releaseTarget === "staging"
          ? "release:status:staging:json"
          : "release:status:json";
      const result = await siteAdminRunReleaseCommand(script);
      const parsed = parseLiveReleaseStatus(result.stdout_tail);
      if (!parsed) {
        setLiveStatusError("Live release status returned invalid JSON.");
        return;
      }
      setLiveStatus(parsed);
      setLiveStatusError("");
    } catch (err) {
      setLiveStatusError(String(err));
    }
  }, [releaseTarget]);

  const loadStatus = useCallback(
    async (options: { silent?: boolean } = {}) => {
      setLoading(true);
      setError("");
      const response = await request("/api/site-admin/status", "GET");
      setLoading(false);
      if (!response.ok) {
        const msg = `${response.code}: ${response.error}`;
        setError(msg);
        if (!options.silent) setMessage("error", `Load release status failed: ${msg}`);
        return;
      }
      const normalized = normalizeStatusPayload(response.data);
      if (!normalized) {
        setError("Invalid status payload");
        if (!options.silent) {
          setMessage("error", "Load release status failed: invalid payload");
        }
        return;
      }
      setStatus(normalized);
      if (isStaging) {
        const previewResponse = await request(
          "/api/site-admin/promote-to-production",
          "GET",
        );
        if (previewResponse.ok) {
          setPreview(parsePromotePreview(previewResponse.data));
        } else {
          setPreview({
            ok: false,
            code: previewResponse.code || "ERROR",
            detail: previewResponse.error,
          });
        }
      } else {
        setPreview(null);
      }
      if (!options.silent) setMessage("success", "Release status loaded.");
    },
    [isStaging, request, setMessage],
  );

  const loadRemoteReleaseJob = useCallback(
    async (jobId: string): Promise<RemoteReleaseJobRow | null> => {
      const response = await request(`/api/site-admin/release-jobs/${jobId}`, "GET");
      if (!response.ok) {
        setMessage(
          "error",
          `Remote release job refresh failed: ${response.code}: ${response.error}`,
        );
        return null;
      }
      const parsed = parseRemoteReleaseJobPayload(response.data);
      if (!parsed) {
        setMessage("error", "Remote release job returned an invalid payload.");
        return null;
      }
      setJob(remoteReleaseJobToLocalState(parsed.job));
      setJobLog(remoteEventsToLogLines(parsed.job, parsed.events));
      return parsed.job;
    },
    [request, setMessage],
  );

  const loadRemoteRunnerStatus = useCallback(async () => {
    if (!ready) {
      setRunnerStatus(null);
      setRemoteJobs([]);
      return;
    }
    const response = await request("/api/site-admin/release-jobs?limit=8", "GET");
    if (!response.ok) {
      setRunnerStatus(null);
      setRemoteJobs([]);
      return;
    }
    const data = asRecord(response.data);
    const parsed = parseRemoteReleaseRunnerStatus(data.runners);
    const jobs = Array.isArray(data.jobs)
      ? data.jobs
          .map(parseRemoteReleaseJob)
          .filter((item): item is RemoteReleaseJobRow => item !== null)
      : [];
    setRunnerStatus(parsed);
    setRemoteJobs(jobs.slice(0, 5));
  }, [ready, request]);

  useEffect(() => {
    void loadStatus({ silent: true });
    void loadHistory();
    void loadLocalSource();
    void loadLiveStatus();
    void loadRemoteRunnerStatus();
  }, [loadHistory, loadLiveStatus, loadLocalSource, loadRemoteRunnerStatus, loadStatus]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const intervalMs = releaseExecutionMode === "remote" ? 5_000 : 15_000;
    const refresh = () => {
      void loadRemoteRunnerStatus().catch(() => {
        if (!cancelled) setRunnerStatus(null);
      });
    };
    refresh();
    const interval = window.setInterval(refresh, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [loadRemoteRunnerStatus, ready, releaseExecutionMode]);

  useEffect(
    () => listenForContentPublishSuggestion(setContentSuggestion),
    [],
  );

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    const refreshMcpContentSuggestion = () => {
      void workspaceMcpContentPublishSuggestionGet()
        .then((suggestion) => {
          if (!cancelled) {
            setContentSuggestion(
              mergeContentSuggestions(readContentPublishSuggestion(), suggestion),
            );
          }
        })
        .catch(() => undefined);
    };
    refreshMcpContentSuggestion();
    const interval = window.setInterval(refreshMcpContentSuggestion, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    void listen<SiteAdminReleaseJobEvent>("site-admin://release-job", (event) => {
      if (cancelled) return;
      const payload = event.payload;
      setJob(payload.state);
      setJobLog((current) => appendLogLine(current, payload));
      if (payload.state.status !== "running") {
        dispatchReleaseState({ kind: "idle" });
        const shouldContinueToProduction =
          releaseTarget === "production" &&
          payload.state.status === "succeeded" &&
          (payload.state.script === RELEASE_STAGING_SCRIPT ||
            payload.state.script === PUBLISH_CONTENT_STAGING_SCRIPT);
        if (shouldContinueToProduction) setPendingProductionContinuation(true);
        void loadStatus({ silent: true });
        void loadHistory();
        void loadLocalSource();
        void loadLiveStatus();
        if (payload.state.status === "succeeded") {
          if (
            payload.state.script === RELEASE_STAGING_SCRIPT ||
            payload.state.script === PUBLISH_CONTENT_STAGING_SCRIPT ||
            payload.state.script === PUBLISH_CONTENT_PROD_SCRIPT ||
            payload.state.script === PUBLISH_CONTENT_PROD_FROM_STAGING_SCRIPT
          ) {
            void clearContentPublishSuggestionEverywhere().finally(() => {
              setContentSuggestion(null);
            });
          }
          void notify({
            title: `${scriptLabel(payload.state.script)} complete`,
            body: payload.state.error || "Cloudflare release command finished.",
          });
        }
      }
    })
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [loadHistory, loadLiveStatus, loadLocalSource, loadStatus, releaseTarget]);

  useEffect(() => {
    if (!activeRemoteJobId) return;
    let cancelled = false;
    let timer: number | undefined;

    const refreshRemoteJob = async () => {
      const remoteJob = await loadRemoteReleaseJob(activeRemoteJobId);
      if (cancelled || !remoteJob) return;
      if (
        remoteJob.status === "succeeded" ||
        remoteJob.status === "failed" ||
        remoteJob.status === "canceled"
      ) {
        setActiveRemoteJobId(null);
        dispatchReleaseState({ kind: "idle" });
        const shouldContinueToProduction =
          releaseTarget === "production" &&
          remoteJob.status === "succeeded" &&
          (remoteJob.script === RELEASE_STAGING_SCRIPT ||
            remoteJob.script === PUBLISH_CONTENT_STAGING_SCRIPT);
        if (shouldContinueToProduction) setPendingProductionContinuation(true);
        void loadStatus({ silent: true });
        void loadHistory();
        void loadLocalSource();
        void loadLiveStatus();
        void loadRemoteRunnerStatus();
        if (remoteJob.status === "succeeded") {
          if (
            (remoteJob.script === PUBLISH_CONTENT_STAGING_SCRIPT &&
              releaseTarget === "staging") ||
            remoteJob.script === PUBLISH_CONTENT_PROD_SCRIPT ||
            remoteJob.script === PUBLISH_CONTENT_PROD_FROM_STAGING_SCRIPT ||
            remoteJob.script === RELEASE_PROD_FROM_STAGING_SCRIPT
          ) {
            void clearContentPublishSuggestionEverywhere().finally(() => {
              setContentSuggestion(null);
            });
          }
          void notify({
            title: `${scriptLabel(remoteJob.script)} complete`,
            body: "Mac mini release runner finished.",
          });
        }
        return;
      }
      timer = window.setTimeout(refreshRemoteJob, 2_500);
    };

    void refreshRemoteJob();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [
    activeRemoteJobId,
    loadHistory,
    loadLiveStatus,
    loadLocalSource,
    loadRemoteRunnerStatus,
    loadRemoteReleaseJob,
    loadStatus,
    releaseTarget,
  ]);

  useEffect(() => {
    if (!pendingProductionContinuation || job?.status === "running") return;
    if (smartPlan.kind === "noop" || smartPlan.kind === "blocked") {
      setPendingProductionContinuation(false);
    }
  }, [job?.status, pendingProductionContinuation, smartPlan.kind]);

  const copyText = useCallback(
    async (label: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setMessage("success", `Copied ${label}.`);
      } catch {
        setMessage("warn", `${label}:\n${text}`);
      }
    },
    [setMessage],
  );

  const openActions = useCallback(
    async (url: string) => {
      if (!url) return;
      try {
        await openExternalUrl(url);
      } catch (err) {
        setMessage("warn", `Could not open GitHub fallback: ${String(err)}. URL: ${url}`);
      }
    },
    [setMessage],
  );

  const startRemoteRelease = useCallback(
    async (script: SiteAdminReleaseScript) => {
      const action = remoteActionForScript(script);
      if (!action) {
        setMessage(
          "warn",
          `${scriptLabel(script)} is only available on a local desktop runner for now.`,
        );
        return;
      }
      setJobLog([]);
      setPendingProductionContinuation(false);
      setRollbackCandidate(null);
      const queuedAt = Date.now();
      setJob({
        command: `Mac mini runner · npm run ${script}`,
        cwd: "remote release runner",
        duration_ms: null,
        error: "",
        exit_code: null,
        finished_at_ms: null,
        job_id: `remote-pending-${queuedAt}`,
        phase: "queueing",
        script,
        started_at_ms: queuedAt,
        status: "running",
        stderr_tail: "",
        stdout_tail: "",
      });
      try {
        const response = await request("/api/site-admin/release-jobs", "POST", {
          action,
          request: {
            releaseTarget,
            source: "release-center",
          },
        });
        if (!response.ok) {
          throw new Error(`${response.code}: ${response.error}`);
        }
        const parsed = parseRemoteReleaseJobPayload(response.data);
        if (!parsed) throw new Error("Remote release job returned an invalid payload.");
        const wake = parseRemoteReleaseWake(asRecord(response.data).wake);
        setActiveRemoteJobId(parsed.job.id);
        setJob(remoteReleaseJobToLocalState(parsed.job));
        setJobLog(remoteEventsToLogLines(parsed.job, parsed.events));
        void loadRemoteRunnerStatus();
        dispatchReleaseState({
          kind: "running",
          info: `${scriptLabel(script)} queued for Mac mini runner…`,
        });
        if (wake?.configured && !wake.ok) {
          setMessage(
            "warn",
            `${scriptLabel(script)} queued, but Mac mini wake failed: ${wake.error || `HTTP ${wake.status}`}`,
          );
        } else if (wake?.ok) {
          setMessage("success", `${scriptLabel(script)} queued and Mac mini wake sent.`);
        } else {
          setMessage("success", `${scriptLabel(script)} queued for Mac mini runner.`);
        }
      } catch (err) {
        const message = String(err);
        setActiveRemoteJobId(null);
        setJob((current) =>
          current
            ? {
                ...current,
                error: message,
                exit_code: 1,
                finished_at_ms: Date.now(),
                phase: "failed",
                status: "failed",
              }
            : current,
        );
        setMessage("error", `Remote release job failed to start: ${message}`);
      }
    },
    [loadRemoteRunnerStatus, releaseTarget, request, setMessage],
  );

  const startRemoteStatusCheck = useCallback(async () => {
    await startRemoteRelease("release:status:json");
  }, [startRemoteRelease]);

  const openRemoteJob = useCallback(
    async (jobId: string) => {
      const remoteJob = await loadRemoteReleaseJob(jobId);
      if (!remoteJob) return;
      if (remoteJob.status === "queued" || remoteJob.status === "running") {
        setActiveRemoteJobId(remoteJob.id);
      } else {
        setActiveRemoteJobId(null);
      }
    },
    [loadRemoteReleaseJob],
  );

  const startRelease = useCallback(
    async (script: SiteAdminReleaseScript) => {
      if (releaseExecutionMode === "remote" || !isTauriRuntime()) {
        await startRemoteRelease(script);
        return;
      }
      setJobLog([]);
      setPendingProductionContinuation(false);
      setRollbackCandidate(null);
      try {
        const next = await siteAdminStartReleaseJob(script);
        setJob(next);
        dispatchReleaseState({
          kind: "running",
          info:
            script === RELEASE_STAGING_SCRIPT
              ? "Deploying staging locally…"
              : script.startsWith("publish:content")
                ? `${scriptLabel(script)}…`
                : "Promoting production locally…",
        });
      } catch (err) {
        setMessage("error", `Release job failed to start: ${String(err)}`);
      }
    },
    [releaseExecutionMode, setMessage, startRemoteRelease],
  );

  const startRollback = useCallback(async () => {
    if (!rollbackCandidate?.version_id) return;
    if (!isTauriRuntime()) {
      setMessage("warn", "Production rollback is available in the Tauri app.");
      return;
    }
    setJobLog([]);
    try {
      const next = await siteAdminStartRollbackJob(rollbackCandidate.version_id);
      setJob(next);
      setRollbackCandidate(null);
      dispatchReleaseState({
        kind: "running",
        info: `Rolling production back to ${rollbackCandidate.version_id.slice(0, 8)}…`,
      });
    } catch (err) {
      setMessage("error", `Rollback failed to start: ${String(err)}`);
    }
  }, [rollbackCandidate, setMessage]);

  const cancelJob = useCallback(async () => {
    if (!job?.job_id || job.status !== "running") return;
    if (activeRemoteJobId) {
      try {
        const response = await request(
          `/api/site-admin/release-jobs/${activeRemoteJobId}/cancel`,
          "POST",
        );
        if (!response.ok) {
          throw new Error(`${response.code}: ${response.error}`);
        }
        const parsed = parseRemoteReleaseJobPayload(response.data);
        if (parsed) {
          setJob(remoteReleaseJobToLocalState(parsed.job));
          setJobLog(remoteEventsToLogLines(parsed.job, parsed.events));
        }
        setActiveRemoteJobId(null);
        dispatchReleaseState({ kind: "idle" });
        void loadRemoteRunnerStatus();
        setMessage("warn", "Remote release cancellation requested.");
      } catch (err) {
        setMessage("error", `Cancel remote release failed: ${String(err)}`);
      }
      return;
    }
    try {
      await siteAdminCancelReleaseJob(job.job_id);
      setMessage("warn", "Release cancellation requested.");
    } catch (err) {
      setMessage("error", `Cancel release failed: ${String(err)}`);
    }
  }, [activeRemoteJobId, job, loadRemoteRunnerStatus, request, setMessage]);

  const retryRemoteJob = useCallback(
    async (jobId: string) => {
      if (!jobId || jobId.startsWith("remote-pending-")) return;
      try {
        const response = await request(`/api/site-admin/release-jobs/${jobId}/retry`, "POST");
        if (!response.ok) {
          throw new Error(`${response.code}: ${response.error}`);
        }
        const parsed = parseRemoteReleaseJobPayload(response.data);
        if (!parsed) throw new Error("Remote release retry returned an invalid payload.");
        const wake = parseRemoteReleaseWake(asRecord(response.data).wake);
        setActiveRemoteJobId(parsed.job.id);
        setJob(remoteReleaseJobToLocalState(parsed.job));
        setJobLog(remoteEventsToLogLines(parsed.job, parsed.events));
        void loadRemoteRunnerStatus();
        dispatchReleaseState({
          kind: "running",
          info: `${scriptLabel(parsed.job.script)} retry queued for Mac mini runner…`,
        });
        if (wake?.configured && !wake.ok) {
          setMessage(
            "warn",
            `${scriptLabel(parsed.job.script)} retry queued, but Mac mini wake failed: ${wake.error || `HTTP ${wake.status}`}`,
          );
        } else {
          setMessage("success", `${scriptLabel(parsed.job.script)} retry queued.`);
        }
      } catch (err) {
        setMessage("error", `Retry remote release failed: ${String(err)}`);
      }
    },
    [loadRemoteRunnerStatus, request, setMessage],
  );

  const runSmartRelease = useCallback(() => {
    if (smartPlan.kind === "deploy-staging-code") {
      void startRelease(RELEASE_STAGING_SCRIPT);
      return;
    }
    if (smartPlan.kind === "publish-content-staging") {
      void startRelease(PUBLISH_CONTENT_STAGING_SCRIPT);
      return;
    }
    if (smartPlan.kind === "promote-production-code") {
      void startRelease(RELEASE_PROD_FROM_STAGING_SCRIPT);
      return;
    }
    if (smartPlan.kind === "publish-content-production-from-staging") {
      void startRelease(PUBLISH_CONTENT_PROD_FROM_STAGING_SCRIPT);
      return;
    }
    if (smartPlan.kind === "noop") {
      void loadStatus();
      void loadHistory();
      void loadLiveStatus();
      return;
    }
    setMessage("warn", smartPlan.detail);
  }, [
    loadStatus,
    loadHistory,
    loadLiveStatus,
    setMessage,
    smartPlan.detail,
    smartPlan.kind,
    startRelease,
  ]);

  const smartReleaseIsProductionAction =
    smartPlan.kind === "promote-production-code" ||
    smartPlan.kind === "publish-content-production-from-staging";
  const smartReleaseButtonLabel =
    smartPlan.kind === "noop"
      ? "Refresh Status"
      : smartPlan.kind === "blocked"
        ? "Smart Release"
        : smartPlan.label;

  return (
    <section className="surface-card release-panel release-center">
      <header className="release-center__hero" data-stage={primaryAction.stage}>
        <div className="release-center__hero-copy">
          <span>Release Center</span>
          <h1>Smart Release</h1>
          <p>{smartPlan.reason} {smartPlan.detail}</p>
          <div className="release-center__controls">
            <ReleaseTargetControl
              disabled={job?.status === "running"}
              value={releaseTarget}
              onChange={setReleaseTarget}
            />
          </div>
        </div>
        <div className="release-center__hero-actions">
          <span
            className="release-panel__health-pill"
            data-tone={job?.status === "running" ? "warn" : smartPlan.tone}
            title={job?.status === "running" ? scriptLabel(job.script) : smartPlan.detail}
          >
            {job?.status === "running"
              ? `${scriptLabel(job.script)} · ${job.phase}`
              : smartPlan.label}
          </span>
          <button
            className={
              smartReleaseIsProductionAction
                ? "btn btn--danger"
                : "btn btn--primary"
            }
            type="button"
            disabled={smartPlan.disabled || loading}
            onClick={runSmartRelease}
            title={smartPlan.detail}
          >
            {loading
              ? "Checking…"
              : smartReleaseButtonLabel}
          </button>
          {job?.status === "running" ? (
            <button className="btn btn--secondary" type="button" onClick={() => void cancelJob()}>
              Cancel
            </button>
          ) : (
            <button
              className="btn btn--secondary"
              type="button"
              onClick={() => {
                void loadStatus();
                void loadHistory();
                void loadLiveStatus();
              }}
              disabled={loading}
            >
              Refresh
            </button>
          )}
        </div>
      </header>

      {error ? <div className="release-panel__error">{error}</div> : null}

      <ReleaseRunnerStatusCard
        executionMode={releaseExecutionMode}
        formatRelativeTime={formatRelativeTime}
        onRefresh={() => void loadRemoteRunnerStatus()}
        onRunStatusCheck={() => void startRemoteStatusCheck()}
        shortId={shortId}
        statusCheckDisabled={!ready || job?.status === "running"}
        status={runnerStatus}
      />

      <ReleaseRemoteJobsCard
        activeJobId={activeRemoteJobId || (job?.cwd === "remote release runner" ? job.job_id : null)}
        formatRelativeTime={formatRelativeTime}
        jobs={remoteJobs}
        onOpen={(jobId) => void openRemoteJob(jobId)}
        onRetry={(jobId) => void retryRemoteJob(jobId)}
        scriptLabel={scriptLabel}
        shortId={shortId}
      />

      <ReleaseEnvironmentNotice
        contentChanged={Boolean(contentSuggestion)}
        pendingProductionContinuation={pendingProductionContinuation}
        plan={smartPlan}
        preview={preview}
        productionCodeMatchesStaging={productionCodeMatchesStaging}
        productionSnapshot={productionOverlaySnapshot}
        releaseTarget={releaseTarget}
        stagingSnapshot={stagingOverlaySnapshot}
      />

      <ReleaseStepper
        liveStatus={liveStatus}
        plan={smartPlan}
        preview={preview}
        productionCodeMatchesStaging={productionCodeMatchesStaging}
        routeParity={liveStatus?.routeParity || null}
      />

      <ReleaseFlowMap
        isStaging={isStaging}
        localDirty={localDirty}
        localSource={localSource}
        localStagingMismatch={localStagingMismatch}
        preview={preview}
        productionAlreadyCurrent={productionAlreadyCurrent}
        status={status}
      />

      <ContentOverlayStatusPanel
        contentSuggestion={contentSuggestion}
        history={history}
        liveStatus={liveStatus}
        liveStatusError={liveStatusError}
        localSource={localSource}
        preview={preview}
        status={status}
      />

      <RouteParityPanel
        error={liveStatusError}
        routeParity={liveStatus?.routeParity || null}
      />

      {!isStaging ? (
        <div className="release-panel__notice" role="status">
          <div>
            <strong>Production promotion starts from Staging</strong>
            <span>
              Production remains inspect-only. Switch to Staging, deploy the candidate,
              then promote the verified build.
            </span>
          </div>
          {stagingProfile ? (
            <button
              className="btn btn--secondary"
              type="button"
              onClick={() => switchProfile(stagingProfile.id)}
            >
              Switch to Staging
            </button>
          ) : null}
        </div>
      ) : null}

      <ReleaseBlockers checks={checks} blockingCount={blockingChecks.length} />

      {rollbackCandidate ? (
        <RollbackConfirmPanel
          entry={rollbackCandidate}
          onCancel={() => setRollbackCandidate(null)}
          onConfirm={() => void startRollback()}
        />
      ) : null}

      <ReleaseJobPanel
        job={job}
        lines={jobLog}
        onRetry={
          job?.cwd === "remote release runner" &&
          (job.status === "failed" || job.status === "cancelled")
            ? () => void retryRemoteJob(job.job_id)
            : undefined
        }
      />

      <ReleaseHistoryPanel
        entries={history}
        error={historyError}
        onCopyRollback={(entry) => void copyText("rollback command", entry.rollback_command)}
        onRollback={(entry) => setRollbackCandidate(entry)}
      />

      {preview?.ok === true &&
      !preview.contentDelta.error &&
      preview.contentDelta.files.length > 0 ? (
        <ContentDeltaDetails delta={preview.contentDelta} />
      ) : null}

      <details className="release-panel__commands" aria-label="Recovery and advanced release commands">
        <summary>Recovery / Advanced</summary>
        <div className="release-center__advanced-runner">
          <div>
            <h2>Runner Override</h2>
            <p>
              Daily releases use the Mac mini runner through the Site Admin API.
              Switch to this Mac only when recovering a local desktop release.
            </p>
          </div>
          <ReleaseRunnerControl
            canRunLocal={canRunLocalRelease}
            disabled={job?.status === "running"}
            value={releaseExecutionMode}
            onChange={setReleaseExecutionMode}
          />
        </div>
        <div className="release-panel__commands-grid">
          <div>
            <h2>Staging Content</h2>
            <pre>{PUBLISH_CONTENT_STAGING_COMMAND}</pre>
          </div>
          <div>
            <h2>Staging Content Rollback</h2>
            <pre>{PUBLISH_CONTENT_STAGING_ROLLBACK_COMMAND}</pre>
          </div>
          <div>
            <h2>Staging Overlay Clear</h2>
            <pre>{PUBLISH_CONTENT_STAGING_CLEAR_COMMAND}</pre>
          </div>
          <div>
            <h2>Staging Code</h2>
            <pre>{RELEASE_STAGING_COMMAND}</pre>
          </div>
          <div>
            <h2>Preflight</h2>
            <pre>{PREFLIGHT_COMMAND}</pre>
          </div>
          <div>
            <h2>Production Promotion</h2>
            <pre>{productionCommandFor(status, preview)}</pre>
          </div>
          <div>
            <h2>Production Content From Staging</h2>
            <pre>{PUBLISH_CONTENT_PROD_FROM_STAGING_COMMAND}</pre>
          </div>
          <div>
            <h2>Production Content Rollback</h2>
            <pre>{PUBLISH_CONTENT_PROD_ROLLBACK_COMMAND}</pre>
          </div>
          <div>
            <h2>Production Overlay Clear</h2>
            <pre>{PUBLISH_CONTENT_PROD_CLEAR_COMMAND}</pre>
          </div>
        </div>
        <details className="release-center__danger-zone">
          <summary>Dangerous recovery commands</summary>
          <p>
            These bypass the normal staging-first Smart Release path. Use only
            when recovering a broken release.
          </p>
          <div className="release-panel__commands-grid">
            <div>
              <h2>Production Content Direct</h2>
              <pre>{PUBLISH_CONTENT_PROD_COMMAND}</pre>
            </div>
            <div>
              <h2>Legacy Guarded Fallback</h2>
              <pre>{LEGACY_RELEASE_PROD_COMMAND}</pre>
            </div>
          </div>
        </details>
        <div className="release-center__advanced-actions">
          <button
            className="btn btn--secondary"
            type="button"
            onClick={() => void copyText("preflight command", PREFLIGHT_COMMAND)}
          >
            Copy Preflight
          </button>
          <button
            className="btn btn--secondary"
            type="button"
            onClick={() =>
              void copyText(
                "production promotion command",
                productionCommandFor(status, preview),
              )
            }
          >
            Copy Promote Command
          </button>
          <button
            className="btn btn--secondary"
            type="button"
            onClick={() => void openActions(stagingWorkflow.actionsUrl)}
          >
            GitHub Dispatch Fallback
          </button>
          <button
            className="btn btn--secondary"
            type="button"
            disabled={job?.status === "running"}
            onClick={() => void startRelease(PUBLISH_CONTENT_STAGING_ROLLBACK_SCRIPT)}
          >
            Rollback Staging Content
          </button>
          <button
            className="btn btn--secondary"
            type="button"
            disabled={job?.status === "running"}
            onClick={() => void startRelease(PUBLISH_CONTENT_STAGING_CLEAR_SCRIPT)}
          >
            Clear Staging Overlay
          </button>
        </div>
      </details>

      <footer className="release-panel__footer">
        <span>Runbook: {PRODUCTION_RUNBOOK_PATH}</span>
        <button
          className="btn btn--secondary"
          type="button"
          onClick={() => void copyText("runbook path", PRODUCTION_RUNBOOK_PATH)}
        >
          Copy Runbook Path
        </button>
      </footer>
    </section>
  );
}

function ReleaseTargetControl({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (target: ReleaseTarget) => void;
  value: ReleaseTarget;
}) {
  return (
    <div className="release-center__target" aria-label="Release target">
      <button
        aria-pressed={value === "staging"}
        disabled={disabled}
        type="button"
        onClick={() => onChange("staging")}
      >
        Staging only
      </button>
      <button
        aria-pressed={value === "production"}
        disabled={disabled}
        type="button"
        onClick={() => onChange("production")}
      >
        Staging to Production
      </button>
    </div>
  );
}

function ReleaseRunnerControl({
  canRunLocal,
  disabled,
  onChange,
  value,
}: {
  canRunLocal: boolean;
  disabled: boolean;
  onChange: (mode: ReleaseExecutionMode) => void;
  value: ReleaseExecutionMode;
}) {
  if (!canRunLocal) {
    return (
      <div className="release-center__target" aria-label="Release runner">
        <button aria-pressed="true" disabled type="button">
          Mac mini runner
        </button>
      </div>
    );
  }
  return (
    <div className="release-center__target" aria-label="Release runner">
      <button
        aria-pressed={value === "local"}
        disabled={disabled}
        type="button"
        onClick={() => onChange("local")}
      >
        This Mac
      </button>
      <button
        aria-pressed={value === "remote"}
        disabled={disabled}
        type="button"
        onClick={() => onChange("remote")}
      >
        Mac mini runner
      </button>
    </div>
  );
}

function ReleaseStepper({
  liveStatus,
  plan,
  preview,
  productionCodeMatchesStaging,
  routeParity,
}: {
  liveStatus: LiveReleaseStatus | null;
  plan: ReleasePlan;
  preview: PromotePreview | null;
  productionCodeMatchesStaging: boolean;
  routeParity: LiveReleaseStatus["routeParity"] | null;
}) {
  const steps = [
    {
      key: "source",
      label: "Source",
      state: plan.kind === "blocked" && plan.label === "Commit changes" ? "blocked" : "ok",
      detail: liveStatus?.checkedAt ? `Checked ${formatRelativeTime(Date.parse(liveStatus.checkedAt))}` : "Local source",
    },
    {
      key: "staging",
      label: "Staging",
      state:
        plan.kind === "deploy-staging-code" || plan.kind === "publish-content-staging"
          ? "active"
          : "ok",
      detail:
        plan.kind === "deploy-staging-code"
          ? "Deploy code"
          : plan.kind === "publish-content-staging"
            ? "Publish content"
            : "Current",
    },
    {
      key: "verify",
      label: "Verify",
      state: preview?.ok === true ? "ok" : "muted",
      detail: preview?.ok === true ? "Preflight loaded" : "Waiting",
    },
    {
      key: "production",
      label: "Production",
      state:
        plan.kind === "promote-production-code" ||
        plan.kind === "publish-content-production-from-staging"
          ? "active"
          : productionCodeMatchesStaging
            ? "ok"
            : "muted",
      detail:
        plan.kind === "promote-production-code"
          ? "Promote code"
          : plan.kind === "publish-content-production-from-staging"
            ? "Copy content"
            : productionCodeMatchesStaging
              ? "Code matched"
              : "Pending",
    },
    {
      key: "routes",
      label: "Routes",
      state: routeParity
        ? routeParity.ok
          ? routeParity.skippedCount
            ? "muted"
            : "ok"
          : "blocked"
        : "muted",
      detail: routeParity
        ? routeParity.skippedCount
          ? `${routeParity.skippedCount} gated`
          : routeParity.ok
            ? "Matched"
          : `${routeParity.mismatchCount} mismatch${routeParity.mismatchCount === 1 ? "" : "es"}`
        : "Not checked",
    },
  ];
  return (
    <section className="release-center__stepper" aria-label="Release steps">
      {steps.map((step, index) => (
        <div className="release-center__step" data-state={step.state} key={step.key}>
          <span>{index + 1}</span>
          <div>
            <strong>{step.label}</strong>
            <small>{step.detail}</small>
          </div>
        </div>
      ))}
    </section>
  );
}

function ReleaseEnvironmentNotice({
  contentChanged,
  pendingProductionContinuation,
  plan,
  preview,
  productionCodeMatchesStaging,
  productionSnapshot,
  releaseTarget,
  stagingSnapshot,
}: {
  contentChanged: boolean;
  pendingProductionContinuation: boolean;
  plan: ReleasePlan;
  preview: PromotePreview | null;
  productionCodeMatchesStaging: boolean;
  productionSnapshot: string;
  releaseTarget: ReleaseTarget;
  stagingSnapshot: string;
}) {
  const overlayDiffers = Boolean(stagingSnapshot) && stagingSnapshot !== productionSnapshot;
  if (pendingProductionContinuation) {
    return (
      <section className="release-center__notice" data-tone="warn" aria-label="Production continuation">
        <strong>Production is next</strong>
        <span>
          The staging step finished. Use the top Smart Release action to move production to
          the same verified candidate.
        </span>
      </section>
    );
  }
  if (releaseTarget === "staging" && preview?.ok === true && preview.productionDifferent) {
    return (
      <section className="release-center__notice" data-tone="muted" aria-label="Staging-only release target">
        <strong>Staging only selected</strong>
        <span>
          Staging can be current while production still differs. Switch to Staging to Production
          when public pages should match.
        </span>
      </section>
    );
  }
  if (releaseTarget === "production" && contentChanged) {
    return (
      <section className="release-center__notice" data-tone="warn" aria-label="Content release route">
        <strong>Content release is two step</strong>
        <span>
          Smart Release publishes the staging overlay first. When staging is verified, the same
          top action copies that content to production.
        </span>
      </section>
    );
  }
  if (releaseTarget === "production" && preview?.ok === true && preview.productionDifferent) {
    const stagingCode = shortSha(preview.staging.codeSha);
    const productionCode = preview.production ? shortSha(preview.production.codeSha) : "none";
    const detail = !productionCodeMatchesStaging
      ? `Staging is ${stagingCode}; production is ${productionCode}. Public pages can differ until production is promoted.`
      : overlayDiffers
        ? `Worker code matches, but production content overlay is behind staging. Copy the verified staging overlay next.`
        : "Production still differs from staging. Refresh if a release just finished.";
    return (
      <section className="release-center__notice" data-tone="warn" aria-label="Production behind staging">
        <strong>Production behind staging</strong>
        <span>{detail} Next: {plan.label}.</span>
      </section>
    );
  }
  return null;
}

function ReleaseFlowMap({
  isStaging,
  localDirty,
  localSource,
  localStagingMismatch,
  preview,
  productionAlreadyCurrent,
  status,
}: {
  isStaging: boolean;
  localDirty: boolean;
  localSource: SiteAdminLocalReleaseSource | null;
  localStagingMismatch: boolean;
  preview: PromotePreview | null;
  productionAlreadyCurrent: boolean;
  status: StatusPayload | null;
}) {
  const sourceTone: ReleaseTone = localDirty || localStagingMismatch
    ? "blocked"
    : status?.source?.deployableVersionReady === false
      ? "blocked"
      : status
        ? "ok"
        : "muted";
  const sourceTitle = localSource
    ? localSource.dirty
      ? "Dirty"
      : shortSha(localSource.sha)
    : shortSha(status?.source?.codeSha);
  const sourceDetail = localSource
    ? localSource.dirty
      ? `${localSource.dirty_file_count} local file${localSource.dirty_file_count === 1 ? "" : "s"} changed`
      : `${localSource.branch} · staging ${shortSha(preview?.ok ? preview.staging.codeSha : status?.source?.codeSha)}`
    : `content ${shortSha(status?.source?.contentSha)} · ${branchLabel(status?.source)}`;
  const stagingTone: ReleaseTone =
    localStagingMismatch
      ? "blocked"
      : preview?.ok && preview.stagingMatchesMain
      ? "ok"
      : status?.source?.pendingDeploy === true
        ? "warn"
        : "muted";
  const productionTone: ReleaseTone =
    preview?.ok
      ? productionAlreadyCurrent
        ? "ok"
        : "warn"
      : "muted";
  return (
    <section className="release-center__route" aria-label="Release route">
      <ReleaseNode
        label="Source"
        title={sourceTitle}
        detail={sourceDetail}
        tone={sourceTone}
      />
      <span className="release-center__route-arrow" aria-hidden="true" />
      <ReleaseNode
        current={isStaging}
        label="Staging"
        title={preview?.ok ? shortId(preview.staging.versionId) : candidateLabel(status?.source)}
        detail={
          preview?.ok
            ? `code ${shortSha(preview.staging.codeSha)} · content ${shortSha(preview.staging.contentSha)}`
            : "load preflight"
        }
        tone={stagingTone}
      />
      <span className="release-center__route-arrow" aria-hidden="true" />
      <ReleaseNode
        label="Production"
        title={
          preview?.ok
            ? preview.production
              ? shortId(preview.production.versionId)
              : "No deployment"
            : "Not loaded"
        }
        detail={
          preview?.ok && preview.production
            ? `code ${shortSha(preview.production.codeSha)} · content ${shortSha(preview.production.contentSha)}`
            : "read from staging preflight"
        }
        tone={productionTone}
      />
    </section>
  );
}

function latestContentOverlayEntry(
  entries: SiteAdminReleaseHistoryEntry[],
  env: "staging" | "production",
): SiteAdminReleaseHistoryEntry | null {
  return entries.find(
    (entry) =>
      entry.env === env &&
      (entry.overlay_snapshot_sha ||
        entry.overlay_backup_snapshot_id ||
        entry.overlay_rollback_snapshot_id ||
        entry.note.includes("content overlay")),
  ) ?? null;
}

function overlaySnapshotFromEntry(entry: SiteAdminReleaseHistoryEntry | null): string {
  return normalizeString(
    entry?.overlay_snapshot_sha ||
      entry?.overlay_rollback_snapshot_id ||
      entry?.sha ||
      "",
  );
}

function ContentOverlayStatusPanel({
  contentSuggestion,
  history,
  liveStatus,
  liveStatusError,
  localSource,
  preview,
  status,
}: {
  contentSuggestion: ContentPublishSuggestion | null;
  history: SiteAdminReleaseHistoryEntry[];
  liveStatus: LiveReleaseStatus | null;
  liveStatusError: string;
  localSource: SiteAdminLocalReleaseSource | null;
  preview: PromotePreview | null;
  status: StatusPayload | null;
}) {
  const stagingContent = latestContentOverlayEntry(history, "staging");
  const productionContent = latestContentOverlayEntry(history, "production");
  const stagingSnapshot =
    normalizeString(liveStatus?.overlays?.staging?.status?.snapshotSha) ||
    overlaySnapshotFromEntry(stagingContent);
  const productionSnapshot =
    normalizeString(liveStatus?.overlays?.production?.status?.snapshotSha) ||
    overlaySnapshotFromEntry(productionContent);
  return (
    <section className="release-center__content-status" aria-label="Code and content publish status">
      <header>
        <div>
          <h2>Code vs Content</h2>
          <p>Current code versions and static overlay snapshots for each environment.</p>
        </div>
        {contentSuggestion ? (
          <strong data-tone="warn">
            Saved {formatRelativeTime(contentSuggestion.atMs)}
          </strong>
        ) : liveStatusError ? (
          <strong data-tone="warn">Live status unavailable</strong>
        ) : liveStatus ? (
          <strong data-tone="ok">Live status</strong>
        ) : (
          <strong data-tone="ok">No pending save</strong>
        )}
      </header>
      <div className="release-center__content-grid">
        <div className="release-center__content-cell">
          <span>Local Code</span>
          <strong>{localSource?.dirty ? "Dirty" : shortSha(localSource?.sha)}</strong>
          <small>{localSource?.branch || "local release source"}</small>
        </div>
        <div className="release-center__content-cell">
          <span>Staging Code</span>
          <strong>
            {preview?.ok ? shortSha(preview.staging.codeSha) : shortSha(status?.source?.codeSha)}
          </strong>
          <small>{preview?.ok ? shortId(preview.staging.versionId) : candidateLabel(status?.source)}</small>
        </div>
        <div className="release-center__content-cell">
          <span>Production Code</span>
          <strong>
            {preview?.ok && preview.production ? shortSha(preview.production.codeSha) : "-"}
          </strong>
          <small>{preview?.ok && preview.production ? shortId(preview.production.versionId) : "load preflight"}</small>
        </div>
        <div className="release-center__content-cell">
          <span>Staging Overlay</span>
          <strong>{shortSha(stagingSnapshot)}</strong>
          <small>{stagingContent?.recorded_at || "not published in this app"}</small>
        </div>
        <div className="release-center__content-cell">
          <span>Production Overlay</span>
          <strong>{shortSha(productionSnapshot)}</strong>
          <small>{productionContent?.recorded_at || "not published in this app"}</small>
        </div>
      </div>
    </section>
  );
}

function RouteParityPanel({
  error,
  routeParity,
}: {
  error: string;
  routeParity: LiveReleaseStatus["routeParity"] | null;
}) {
  if (!routeParity && !error) return null;
  return (
    <section className="release-center__route-parity" aria-label="Route parity">
      <header>
        <div>
          <h2>Route Parity</h2>
          <p>Live staging and production route hashes, including static shell headers.</p>
        </div>
        <strong data-tone={routeParity?.ok ? "ok" : "warn"}>
          {routeParity?.skippedCount
            ? `${routeParity.skippedCount} gated`
            : routeParity?.ok
              ? "Matched"
              : error
                ? "Unavailable"
                : `${routeParity?.mismatchCount || 0} mismatch`}
        </strong>
      </header>
      {error ? <p className="release-center__route-parity-error">{error}</p> : null}
      {routeParity?.routes?.length ? (
        <div className="release-center__route-parity-list">
          {routeParity.routes.map((route) => (
            <div
              className="release-center__route-parity-row"
              data-ok={route.ok ? "true" : "false"}
              data-skipped={route.skipped ? "true" : undefined}
              key={route.path}
            >
              <strong>{route.path}</strong>
              <span>
                stg {route.staging.status} shell {route.staging.staticShell || "-"}
              </span>
              <span>prod {route.production.status} shell {route.production.staticShell || "-"}</span>
              <small>
                {route.skipped
                  ? route.reason || "Gated staging route"
                  : `${route.staging.hash.slice(0, 7)} / ${route.production.hash.slice(0, 7)}`}
              </small>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ReleaseNode({
  current,
  detail,
  label,
  title,
  tone,
}: {
  current?: boolean;
  detail: string;
  label: string;
  title: string;
  tone: ReleaseTone;
}) {
  return (
    <div className="release-center__node" data-current={current ? "true" : undefined} data-tone={tone}>
      <span>{label}</span>
      <strong>{title || "-"}</strong>
      <small>{detail}</small>
    </div>
  );
}

function ReleaseBlockers({
  blockingCount,
  checks,
}: {
  blockingCount: number;
  checks: ReleaseCheck[];
}) {
  const visible = checks.filter((check) => check.tone !== "ok");
  return (
    <section className="release-center__blockers" aria-label="Release blockers">
      <header>
        <div>
          <h2>{blockingCount > 0 ? "Needs attention" : "Release gates"}</h2>
          <p>
            {visible.length === 0
              ? "All visible gates are clear."
              : "Only gates that need attention are shown here."}
          </p>
        </div>
        <strong data-ready={blockingCount === 0 ? "true" : "false"}>
          {blockingCount === 0 ? "Clear" : `${blockingCount} blocker${blockingCount === 1 ? "" : "s"}`}
        </strong>
      </header>
      {visible.length > 0 ? (
        <div className="release-center__gate-list">
          {visible.map((check) => (
            <div className="release-center__gate" data-tone={check.tone} key={check.label}>
              <span>{check.label}</span>
              <strong>{check.value}</strong>
              <p>{check.detail}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="release-center__gate release-center__gate--clear" data-tone="ok">
          <span>Ready</span>
          <strong>No blockers</strong>
          <p>Use the primary action above for the next release step.</p>
        </div>
      )}
      <details className="release-center__all-gates">
        <summary>Show all gates</summary>
        <div className="release-panel__check-grid">
          {checks.map((check) => (
            <div className="release-panel__check" data-tone={check.tone} key={check.label}>
              <span>{check.label}</span>
              <strong>{check.value}</strong>
              <p>{check.detail}</p>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

function RollbackConfirmPanel({
  entry,
  onCancel,
  onConfirm,
}: {
  entry: SiteAdminReleaseHistoryEntry;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <section className="release-center__confirm" data-tone="blocked" aria-label="Confirm production rollback">
      <div>
        <span>Production rollback</span>
        <h2>Rollback to {shortId(entry.version_id)}?</h2>
        <p>
          This runs a local Cloudflare rollback and then verifies production against
          the selected version.
        </p>
      </div>
      <pre>{entry.rollback_command}</pre>
      <div className="release-center__confirm-actions">
        <button className="btn btn--secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn--danger" type="button" onClick={onConfirm}>
          Rollback production
        </button>
      </div>
    </section>
  );
}

function ReleaseJobPanel({
  job,
  lines,
  onRetry,
}: {
  job: SiteAdminReleaseJobState | null;
  lines: ReleaseLogLine[];
  onRetry?: () => void;
}) {
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    log.scrollTop = log.scrollHeight;
  }, [job?.phase, job?.status, lines.length]);

  if (!job && lines.length === 0) return null;
  return (
    <section className="release-center__job" data-status={job?.status || "idle"} aria-label="Release activity">
      <header>
        <div>
          <h2>{job ? scriptLabel(job.script) : "Release activity"}</h2>
          <p>{job ? `${job.status} · ${job.phase}` : "No release job has run in this session."}</p>
        </div>
        <div className="release-center__job-actions">
          {job?.duration_ms ? <strong>{Math.round(job.duration_ms / 1000)}s</strong> : null}
          {onRetry ? (
            <button className="btn btn--secondary" type="button" onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </div>
      </header>
      <div ref={logRef} className="release-center__log" role="log" aria-live="polite">
        {lines.length > 0 ? (
          lines.map((line) => (
            <div className="release-center__log-line" data-stream={line.stream} key={line.id}>
              <span>{line.phase}</span>
              <code>{line.message}</code>
            </div>
          ))
        ) : (
          <p>Waiting for release output…</p>
        )}
      </div>
      {job?.error ? <div className="release-panel__action-error">{job.error}</div> : null}
    </section>
  );
}

function ReleaseHistoryPanel({
  entries,
  error,
  onCopyRollback,
  onRollback,
}: {
  entries: SiteAdminReleaseHistoryEntry[];
  error: string;
  onCopyRollback: (entry: SiteAdminReleaseHistoryEntry) => void;
  onRollback: (entry: SiteAdminReleaseHistoryEntry) => void;
}) {
  return (
    <section className="release-center__history" aria-label="Release history">
      <header>
        <div>
          <h2>Release History</h2>
          <p>Recent local releases and production snapshots.</p>
        </div>
        <span>{entries.length}</span>
      </header>
      {error ? <div className="release-panel__action-error">{error}</div> : null}
      {entries.length > 0 ? (
        <div className="release-center__history-list">
          {entries.map((entry, index) => (
            <div
              className="release-center__history-row"
              data-status={entry.status}
              key={`${entry.source}:${entry.version_id}:${entry.recorded_at}:${index}`}
            >
              <div>
                <span>{entry.env || entry.source}</span>
                <strong>{entry.version_id ? shortId(entry.version_id) : shortSha(entry.sha)}</strong>
                <small>
                  {entry.recorded_at || "-"} · {entry.status}
                  {entry.note ? ` · ${entry.note}` : ""}
                </small>
              </div>
              <div className="release-center__history-actions">
                {entry.rollback_command ? (
                  <button className="btn btn--secondary" type="button" onClick={() => onCopyRollback(entry)}>
                    Copy Rollback
                  </button>
                ) : null}
                {entry.env === "production" && entry.version_id ? (
                  <button className="btn btn--danger" type="button" onClick={() => onRollback(entry)}>
                    Rollback
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="release-center__empty">No local release history yet.</div>
      )}
    </section>
  );
}

function ContentDeltaDetails({ delta }: { delta: ContentDelta }) {
  return (
    <details
      className="release-panel__content-delta"
      aria-label="Files that will land on production"
    >
      <summary>
        <span>What will land on production</span>
        <strong>
          {delta.changedRows} file{delta.changedRows === 1 ? "" : "s"}
        </strong>
      </summary>
      <ul>
        {delta.files.map((file) => (
          <li key={file.relPath}>
            <code>{file.relPath}</code>
            <span aria-hidden="true">·</span>
            <span>{formatBytes(file.sizeBytes)}</span>
            {file.updatedAtMs ? (
              <>
                <span aria-hidden="true">·</span>
                <time
                  dateTime={new Date(file.updatedAtMs).toISOString()}
                  title={new Date(file.updatedAtMs).toLocaleString()}
                >
                  {formatRelativeTime(file.updatedAtMs)}
                </time>
              </>
            ) : null}
            {file.updatedBy ? (
              <>
                <span aria-hidden="true">·</span>
                <span>by {file.updatedBy}</span>
              </>
            ) : null}
          </li>
        ))}
        {delta.truncated ? (
          <li className="release-panel__content-delta-more">
            + {delta.changedRows - delta.files.length} more
          </li>
        ) : null}
      </ul>
    </details>
  );
}
