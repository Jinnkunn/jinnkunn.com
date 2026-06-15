import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
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
  PUBLISH_NOW_PROD_FROM_STAGING_COMMAND,
  PUBLISH_NOW_PROD_FROM_STAGING_SCRIPT,
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
import type {
  ReleaseExecutionMode,
  RemoteReleaseAgentRow,
  RemoteReleaseJobAction,
  RemoteReleaseJobRow,
  RemoteReleaseJobStatus,
  RemoteReleaseRunnerStatus,
  RemoteReleaseWakeResult,
} from "./release-runner-cards";
import { ReleaseJobPanel, type ReleaseLogLine } from "./ReleaseActivityPanels";
import {
  ReleaseRunnerControl,
  ReleaseTargetControl,
} from "./ReleaseControls";
import { useSiteAdmin } from "./state";
import type { StatusPayload } from "./types";
import { getSiteAdminEnvironment, normalizeString } from "./utils";

const PRODUCTION_RUNBOOK_PATH = "docs/runbooks/production-promotion.md";
const PRODUCTION_HISTORY_FILE = "docs/runbooks/production-version-history.md";
const ContentDeltaDetails = lazy(() =>
  import("./ContentDeltaDetails").then((module) => ({
    default: module.ContentDeltaDetails,
  })),
);
const ReleaseHistoryPanel = lazy(() =>
  import("./ReleaseHistoryPanel").then((module) => ({
    default: module.ReleaseHistoryPanel,
  })),
);
const ReleaseRunnerDiagnostics = lazy(() =>
  import("./ReleaseRunnerDiagnostics").then((module) => ({
    default: module.ReleaseRunnerDiagnostics,
  })),
);
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
  contentPreview?: {
    contentInputSha: string;
    fileCount: number;
    files: string[];
    truncated?: boolean;
    staging: {
      action: "noop" | "deploy-code-first" | "publish-overlay";
      current: boolean;
      overlayContentInputSha: string;
      overlaySnapshotSha: string;
      workerCodeSha: string;
    };
    production: {
      action:
        | "noop"
        | "copy-staging-overlay"
        | "wait-for-staging-overlay"
        | "promote-code-first";
      current: boolean;
      overlaySnapshotSha: string;
      stagingOverlaySnapshotSha: string;
      workerCodeSha: string;
    };
  };
  plan?: {
    kind: ReleaseActionKind;
    label: string;
    reason: string;
    script: ReleasePlan["script"];
  };
  routeParity?: {
    auth?: {
      login?: string;
      reason?: string;
      stagingAuthenticated?: boolean;
    };
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
    "publish-now-production-from-staging",
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

interface ReleaseAutoCommitSummary {
  files: string[];
  newSha: string;
  pushed: boolean | null;
  pushError: string;
  source: "report" | "log";
}

interface ReleaseBuildCacheSummary {
  attempted: boolean;
  expectedContentSha: string;
  hit: boolean;
  reason: string;
  restored: string[];
  source: "report" | "log";
  storedContentSha: string;
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

function parseReleaseAutoCommitObject(
  raw: unknown,
): ReleaseAutoCommitSummary | null {
  const rec = asRecord(raw);
  const commit = asRecord(rec.contentAutoCommit);
  if (Object.keys(commit).length === 0) return null;
  const newSha = asString(commit.newSha);
  if (!newSha) return null;
  const files = Array.isArray(commit.files)
    ? commit.files.map(asString).filter(Boolean)
    : [];
  return {
    files,
    newSha,
    pushed: typeof commit.pushed === "boolean" ? commit.pushed : null,
    pushError: asString(commit.pushError),
    source: "report",
  };
}

function parseReleaseAutoCommitFromText(
  raw: string,
): ReleaseAutoCommitSummary | null {
  const parsed = parseJsonObjectFromTail(raw);
  const fromReport = parseReleaseAutoCommitObject(parsed);
  if (fromReport) return fromReport;
  const match = raw.match(
    /auto-committed .*?→\s*([a-f0-9]{7,40})(?:\s*\((pushed|push failed: ([^)]+))\))?/i,
  );
  if (!match?.[1]) return null;
  return {
    files: [],
    newSha: match[1],
    pushed:
      match[2] === "pushed"
        ? true
        : match[2]?.startsWith("push failed")
          ? false
          : null,
    pushError: match[3] || "",
    source: "log",
  };
}

function parseReleaseBuildCacheObject(raw: unknown): ReleaseBuildCacheSummary | null {
  const rec = asRecord(raw);
  const cache = asRecord(rec.buildCache);
  if (Object.keys(cache).length === 0) return null;
  const restored = Array.isArray(cache.restored)
    ? cache.restored.map(asString).filter(Boolean)
    : [];
  return {
    attempted: Boolean(cache.attempted),
    expectedContentSha: asString(cache.expectedContentSha),
    hit: Boolean(cache.hit),
    reason: asString(cache.reason),
    restored,
    source: "report",
    storedContentSha: asString(cache.storedContentSha),
  };
}

function parseReleaseBuildCacheFromText(
  raw: string,
): ReleaseBuildCacheSummary | null {
  const parsed = parseJsonObjectFromTail(raw);
  const fromReport = parseReleaseBuildCacheObject(parsed);
  if (fromReport) return fromReport;
  const hit = raw.match(
    /reusing build:cf cache .*?restored:\s*([^)]+)\)/i,
  );
  if (hit?.[1]) {
    return {
      attempted: true,
      expectedContentSha: "",
      hit: true,
      reason: "matched code and content",
      restored: hit[1].split(",").map((value) => value.trim()).filter(Boolean),
      source: "log",
      storedContentSha: "",
    };
  }
  const stored = raw.match(
    /stored build:cf cache .*?content=([a-f0-9]{7,40})\s*\(([^)]+)\)/i,
  );
  if (stored?.[1]) {
    return {
      attempted: false,
      expectedContentSha: "",
      hit: false,
      reason: `stored ${stored[2] || "build artifacts"}`,
      restored: [],
      source: "log",
      storedContentSha: stored[1],
    };
  }
  return null;
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
        detail: "preview missing Draft snapshot",
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
              ? `${localSource.dirty_file_count} local file${localSource.dirty_file_count === 1 ? "" : "s"} must be committed before Live publishing.`
              : localMismatch
                ? `Draft preview is ${shortSha(stagingCodeSha)}, but local release source is ${shortSha(localSha)}. Update Draft first.`
                : productionHistoryOnlyDirty
                  ? "Only the Live version history audit log changed; release jobs can continue."
                : "Local release source matches Draft.",
            label: "Local source",
            tone: localDirty || localMismatch ? "blocked" : productionHistoryOnlyDirty ? "warn" : "ok",
            value: localDirty ? "Dirty" : localMismatch ? "Mismatch" : productionHistoryOnlyDirty ? "History log" : shortSha(localSha),
          } satisfies ReleaseCheck,
        ]
      : []),
    {
      detail: isStaging
        ? "Connected to the Draft workspace."
        : "Switch to Draft before publishing.",
      label: "Profile",
      tone: isStaging ? "ok" : "blocked",
      value: isStaging ? "Draft" : "Not Draft",
    },
    {
      detail:
        previewReady && preview.stagingMatchesMain
          ? "Draft preview matches the release source."
          : previewReady
            ? "Draft runtime and active deployment disagree."
            : "Load preflight to compare Draft and Live.",
      label: "Draft preflight",
      tone: previewReady && preview.stagingMatchesMain ? "ok" : "blocked",
      value: previewReady && preview.stagingMatchesMain ? "Matched" : "Needs Draft",
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
          ? "Update Draft first, then publish the verified candidate to Live."
          : "Draft appears current for this source.",
      label: "Draft deploy",
      tone: pendingDeploy === true ? "blocked" : "ok",
      value: pendingDeploy === true ? "Pending" : "Current",
    },
    {
      detail: codeSha ? "Code SHA reported by Draft preview." : "Status did not include a code SHA.",
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
          ? "Live differs from the verified Draft candidate."
          : "Live already runs the same active snapshot."
        : preview?.detail || "Load preflight.",
      label: "Live delta",
      tone: previewReady ? (productionDifferent ? "warn" : "ok") : "muted",
      value: previewReady ? (productionDifferent ? "Differs" : "Current") : "Unknown",
    },
    {
      detail: !previewReady
        ? "Load preflight."
        : preview.contentDelta.error
          ? `Could not compute content delta: ${preview.contentDelta.error}`
          : preview.contentDelta.changedRows === 0
            ? "No Draft edits since the last Live publish."
            : `${preview.contentDelta.changedRows} content file${preview.contentDelta.changedRows === 1 ? "" : "s"} will land on Live.`,
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
  if (script === "verify:release-runner") return "Runner self-test";
  if (script === "release:site") return "Smart Release";
  if (script === PUBLISH_CONTENT_STAGING_SCRIPT) return "Publishing Draft preview";
  if (script === PUBLISH_CONTENT_PROD_SCRIPT) return "Publishing Live content";
  if (script === PUBLISH_CONTENT_PROD_FROM_STAGING_SCRIPT) return "Publishing Draft to Live";
  if (script === PUBLISH_NOW_PROD_FROM_STAGING_SCRIPT) return "Publishing Now to Live";
  if (script === PUBLISH_CONTENT_STAGING_ROLLBACK_SCRIPT) return "Rolling back Draft content";
  if (script === PUBLISH_CONTENT_PROD_ROLLBACK_SCRIPT) return "Rolling back Live content";
  if (script === PUBLISH_CONTENT_STAGING_CLEAR_SCRIPT) return "Clearing Draft overlay";
  if (script === PUBLISH_CONTENT_PROD_CLEAR_SCRIPT) return "Clearing Live overlay";
  if (script === RELEASE_STAGING_SCRIPT) return "Updating Draft preview";
  if (script === RELEASE_PROD_FROM_STAGING_SCRIPT) return "Updating Live site";
  if (script.startsWith("rollback:production")) return "Rolling back Live";
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
  if (script === PUBLISH_NOW_PROD_FROM_STAGING_SCRIPT) {
    return "publish-now-production-from-staging";
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
      label: "Switch to Draft",
      detail: "Live is inspect-only. Start publishing from Draft.",
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
      label: "Connect to Draft",
      detail: "Sign in to the Draft workspace before publishing.",
      disabled: true,
      kind: "none" as const,
    };
  }
  if (localDirty) {
    return {
      stage: "failed" as ReleaseStage,
      label: "Commit Changes",
      detail: "Live publishing requires a clean local release source.",
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
      label: "Update Draft Preview",
      detail: localStagingMismatch
        ? "Draft preview is behind the local release source. Update Draft first."
        : "Build and deploy the committed release source to Draft preview.",
      disabled: false,
      kind: "staging" as const,
    };
  }
  if (readyToPromote) {
    return {
      stage: "ready" as ReleaseStage,
      label: "Update Live Site",
      detail: "Live will receive the verified Draft candidate.",
      disabled: false,
      kind: "promote" as const,
    };
  }
  if (productionAlreadyCurrent) {
    return {
      stage: "current" as ReleaseStage,
      label: "Refresh Status",
      detail: "Live already matches Draft.",
      disabled: false,
      kind: "refresh" as const,
    };
  }
  return {
    stage: "checking" as ReleaseStage,
    label: "Run Preflight",
    detail: "Refresh Draft and Live comparison.",
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
  const [liveStatusLoading, setLiveStatusLoading] = useState(false);
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
            detail: "The Draft preview is verified. Copy the same content to Live.",
            disabled: false,
            kind: "publish-content-production-from-staging",
            label: "Publish Draft to Live",
            reason: "Draft content is verified; Live is next.",
            script: PUBLISH_CONTENT_PROD_FROM_STAGING_SCRIPT,
            tone: "warn",
          }
        : {
            detail: "The Draft preview is verified. Update Live code before copying content.",
            disabled: false,
            kind: "promote-production-code",
            label: "Update Live Site",
            reason: "Draft is verified; Live is next.",
            script: RELEASE_PROD_FROM_STAGING_SCRIPT,
            tone: "warn",
          }
      : null;
  const smartPlan = continuationPlan || liveSmartPlan || fallbackSmartPlan;
  const autoCommitSummary = useMemo(
    () =>
      parseReleaseAutoCommitFromText(
        [job?.stdout_tail ?? "", ...jobLog.map((line) => line.message)]
          .filter(Boolean)
          .join("\n"),
      ),
    [job?.stdout_tail, jobLog],
  );
  const buildCacheSummary = useMemo(
    () =>
      parseReleaseBuildCacheFromText(
        [job?.stdout_tail ?? "", ...jobLog.map((line) => line.message)]
          .filter(Boolean)
          .join("\n"),
      ),
    [job?.stdout_tail, jobLog],
  );

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
    setLiveStatusLoading(true);
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
    } finally {
      setLiveStatusLoading(false);
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
        void loadRemoteRunnerStatus();
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
  }, [
    loadHistory,
    loadLiveStatus,
    loadLocalSource,
    loadRemoteRunnerStatus,
    loadStatus,
    releaseTarget,
  ]);

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

  const startRemoteRunnerSelfTest = useCallback(async () => {
    setJobLog([]);
    setPendingProductionContinuation(false);
    setRollbackCandidate(null);
    const queuedAt = Date.now();
    setJob({
      command: "Mac mini runner · npm run verify:release-runner -- --skip-job",
      cwd: "remote release runner",
      duration_ms: null,
      error: "",
      exit_code: null,
      finished_at_ms: null,
      job_id: `remote-pending-${queuedAt}`,
      phase: "queueing",
      script: "verify:release-runner",
      started_at_ms: queuedAt,
      status: "running",
      stderr_tail: "",
      stdout_tail: "",
    });
    try {
      const response = await request("/api/site-admin/release-jobs", "POST", {
        action: "runner-self-test",
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
        info: "Runner self-test queued for Mac mini runner…",
      });
      if (wake?.configured && !wake.ok) {
        setMessage(
          "warn",
          `Runner self-test queued, but Mac mini wake failed: ${wake.error || `HTTP ${wake.status}`}`,
        );
      } else if (wake?.ok) {
        setMessage("success", "Runner self-test queued and Mac mini wake sent.");
      } else {
        setMessage("success", "Runner self-test queued for Mac mini runner.");
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
      setMessage("error", `Runner self-test failed to start: ${message}`);
    }
  }, [loadRemoteRunnerStatus, releaseTarget, request, setMessage]);

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
              ? "Updating Draft preview locally…"
              : script.startsWith("publish:content")
                ? `${scriptLabel(script)}…`
                : "Updating Live locally…",
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
      setMessage("warn", "Live rollback is available in the Tauri app.");
      return;
    }
    setJobLog([]);
    try {
      const next = await siteAdminStartRollbackJob(rollbackCandidate.version_id);
      setJob(next);
      setRollbackCandidate(null);
      dispatchReleaseState({
        kind: "running",
        info: `Rolling Live back to ${rollbackCandidate.version_id.slice(0, 8)}…`,
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
    if (smartPlan.kind === "publish-now-production-from-staging") {
      void startRelease(PUBLISH_NOW_PROD_FROM_STAGING_SCRIPT);
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
    smartPlan.kind === "publish-content-production-from-staging" ||
    smartPlan.kind === "publish-now-production-from-staging";
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
          <span>Site publishing</span>
          <h1>Draft to Live</h1>
          <p>
            Draft is where edits land first. Live changes only after the verified Draft
            preview is published. {smartPlan.reason} {smartPlan.detail}
          </p>
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
      <ReleaseBuildCacheNotice summary={buildCacheSummary} />
      <ReleaseAutoCommitNotice summary={autoCommitSummary} />
      <ReleaseRoutineSummary
        blockingCount={blockingChecks.length}
        job={job}
        plan={smartPlan}
        releaseExecutionMode={releaseExecutionMode}
        releaseTarget={releaseTarget}
        runnerStatus={runnerStatus}
      />

      {!isStaging ? (
        <div className="release-panel__notice" role="status">
          <div>
            <strong>Publishing starts from Draft</strong>
            <span>
              Live remains inspect-only here. Switch to Draft, update the preview,
              then publish the verified result to Live.
            </span>
          </div>
          {stagingProfile ? (
            <button
              className="btn btn--secondary"
              type="button"
              onClick={() => switchProfile(stagingProfile.id)}
            >
              Switch to Draft
            </button>
          ) : null}
        </div>
      ) : null}

      {blockingChecks.length > 0 ? (
        <ReleaseBlockers checks={checks} blockingCount={blockingChecks.length} />
      ) : null}

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
        scriptLabel={scriptLabel}
        onRetry={
          job?.cwd === "remote release runner" &&
          (job.status === "failed" || job.status === "cancelled")
            ? () => void retryRemoteJob(job.job_id)
            : undefined
        }
      />

      <details className="release-panel__commands release-center__diagnostics">
        <summary>Details / Diagnostics</summary>
        <Suspense
          fallback={
            <div className="release-center__empty">Loading runner diagnostics…</div>
          }
        >
          <ReleaseRunnerDiagnostics
            activeRemoteJobId={activeRemoteJobId}
            executionMode={releaseExecutionMode}
            formatRelativeTime={formatRelativeTime}
            job={job}
            jobs={remoteJobs}
            onOpenRemoteJob={(jobId) => void openRemoteJob(jobId)}
            onRefresh={() => void loadRemoteRunnerStatus()}
            onRetryRemoteJob={(jobId) => void retryRemoteJob(jobId)}
            onRunSelfTest={() => void startRemoteRunnerSelfTest()}
            onRunStatusCheck={() => void startRemoteStatusCheck()}
            ready={ready}
            scriptLabel={scriptLabel}
            shortId={shortId}
            status={runnerStatus}
          />
        </Suspense>

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
          productionOverlaySnapshot={productionOverlaySnapshot}
          stagingOverlaySnapshot={stagingOverlaySnapshot}
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

        <ContentDiffPreviewPanel
          contentDelta={preview?.ok === true ? preview.contentDelta : null}
          preview={liveStatus?.contentPreview || null}
        />

        {preview?.ok === true &&
        !preview.contentDelta.error &&
        preview.contentDelta.files.length > 0 ? (
          <Suspense
            fallback={<div className="release-center__empty">Loading file list…</div>}
          >
            <ContentDeltaDetails
              delta={preview.contentDelta}
              formatBytes={formatBytes}
              formatRelativeTime={formatRelativeTime}
            />
          </Suspense>
        ) : null}

        <RouteParityPanel
          checking={liveStatusLoading}
          disabled={job?.status === "running"}
          error={liveStatusError}
          onCheck={() => void loadLiveStatus()}
          routeParity={liveStatus?.routeParity || null}
        />
      </details>

      <details className="release-panel__commands release-center__history">
        <summary>Publish History</summary>
        <Suspense fallback={<div className="release-center__empty">Loading history…</div>}>
          <ReleaseHistoryPanel
            entries={history}
            error={historyError}
            onCopyRollback={(entry) =>
              void copyText("rollback command", entry.rollback_command)
            }
            onRollback={(entry) => setRollbackCandidate(entry)}
          />
        </Suspense>
      </details>

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
            <h2>Draft Content</h2>
            <pre>{PUBLISH_CONTENT_STAGING_COMMAND}</pre>
          </div>
          <div>
            <h2>Draft Content Rollback</h2>
            <pre>{PUBLISH_CONTENT_STAGING_ROLLBACK_COMMAND}</pre>
          </div>
          <div>
            <h2>Draft Overlay Clear</h2>
            <pre>{PUBLISH_CONTENT_STAGING_CLEAR_COMMAND}</pre>
          </div>
          <div>
            <h2>Draft Code</h2>
            <pre>{RELEASE_STAGING_COMMAND}</pre>
          </div>
          <div>
            <h2>Preflight</h2>
            <pre>{PREFLIGHT_COMMAND}</pre>
          </div>
          <div>
            <h2>Live Code</h2>
            <pre>{productionCommandFor(status, preview)}</pre>
          </div>
          <div>
            <h2>Live Content From Draft</h2>
            <pre>{PUBLISH_CONTENT_PROD_FROM_STAGING_COMMAND}</pre>
          </div>
          <div>
            <h2>Live Now From Draft</h2>
            <pre>{PUBLISH_NOW_PROD_FROM_STAGING_COMMAND}</pre>
          </div>
          <div>
            <h2>Live Content Rollback</h2>
            <pre>{PUBLISH_CONTENT_PROD_ROLLBACK_COMMAND}</pre>
          </div>
          <div>
            <h2>Live Overlay Clear</h2>
            <pre>{PUBLISH_CONTENT_PROD_CLEAR_COMMAND}</pre>
          </div>
        </div>
        <details className="release-center__danger-zone">
          <summary>Dangerous recovery commands</summary>
          <p>
            These bypass the normal Draft-first Smart Release path. Use only
            when recovering a broken release.
          </p>
          <div className="release-panel__commands-grid">
            <div>
              <h2>Live Content Direct</h2>
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
                "Live publish command",
                productionCommandFor(status, preview),
              )
            }
          >
            Copy Live Command
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
            Rollback Draft Content
          </button>
          <button
            className="btn btn--secondary"
            type="button"
            disabled={job?.status === "running"}
            onClick={() => void startRelease(PUBLISH_CONTENT_STAGING_CLEAR_SCRIPT)}
          >
            Clear Draft Overlay
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
      label: "Draft saved",
      state: plan.kind === "blocked" && plan.label === "Commit changes" ? "blocked" : "ok",
      detail: liveStatus?.checkedAt ? `Checked ${formatRelativeTime(Date.parse(liveStatus.checkedAt))}` : "Editing source",
    },
    {
      key: "staging",
      label: "Draft preview",
      state:
        plan.kind === "deploy-staging-code" || plan.kind === "publish-content-staging"
          ? "active"
          : "ok",
      detail:
        plan.kind === "deploy-staging-code"
          ? "Update code"
          : plan.kind === "publish-content-staging"
            ? "Publish content"
            : "Current",
    },
    {
      key: "verify",
      label: "Review",
      state: preview?.ok === true ? "ok" : "muted",
      detail: preview?.ok === true ? "Preflight loaded" : "Waiting",
    },
    {
      key: "production",
      label: "Live site",
      state:
        plan.kind === "promote-production-code" ||
        plan.kind === "publish-content-production-from-staging" ||
        plan.kind === "publish-now-production-from-staging"
          ? "active"
          : productionCodeMatchesStaging
            ? "ok"
            : "muted",
      detail:
        plan.kind === "promote-production-code"
          ? "Update code"
          : plan.kind === "publish-content-production-from-staging"
            ? "Copy content"
            : plan.kind === "publish-now-production-from-staging"
              ? "Copy Now"
            : productionCodeMatchesStaging
              ? "Code matched"
              : "Pending",
    },
    {
      key: "routes",
      label: "Route check",
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

function ReleaseRoutineSummary({
  blockingCount,
  job,
  plan,
  releaseExecutionMode,
  releaseTarget,
  runnerStatus,
}: {
  blockingCount: number;
  job: SiteAdminReleaseJobState | null;
  plan: ReleasePlan;
  releaseExecutionMode: ReleaseExecutionMode;
  releaseTarget: ReleaseTarget;
  runnerStatus: RemoteReleaseRunnerStatus | null;
}) {
  const runner = runnerStatus?.agents[0] ?? null;
  const runnerOnline = Boolean(
    runner && runnerStatus && runnerStatus.observedAt - runner.lastSeenAt < 30_000,
  );
  const draftNeedsUpdate =
    plan.kind === "deploy-staging-code" || plan.kind === "publish-content-staging";
  const liveNeedsUpdate =
    plan.kind === "promote-production-code" ||
    plan.kind === "publish-content-production-from-staging" ||
    plan.kind === "publish-now-production-from-staging";
  const items = [
    {
      detail:
        job?.status === "running"
          ? job.phase
          : draftNeedsUpdate
            ? plan.kind === "deploy-staging-code"
              ? "Latest code is not in the Draft preview yet"
              : "Saved content is waiting in Draft"
            : blockingCount > 0
              ? "Resolve blockers before updating Draft"
              : "Draft preview is ready",
      key: "draft",
      label: "Draft",
      tone:
        blockingCount > 0
          ? "blocked"
          : draftNeedsUpdate || job?.status === "running"
            ? "warn"
            : "ok",
      value:
        job?.status === "running"
          ? "Working"
          : draftNeedsUpdate
            ? "Needs update"
            : "Ready",
    },
    {
      detail:
        releaseTarget === "staging"
          ? "This run updates Draft preview only"
          : liveNeedsUpdate
            ? plan.detail
            : plan.kind === "noop"
              ? "Live already matches the verified Draft"
              : "Live waits for a verified Draft preview",
      key: "live",
      label: "Live",
      tone:
        releaseTarget === "staging"
          ? "muted"
          : liveNeedsUpdate
            ? "warn"
            : plan.kind === "noop"
              ? "ok"
              : "muted",
      value:
        releaseTarget === "staging"
          ? "Not targeted"
          : liveNeedsUpdate
            ? "Needs update"
            : plan.kind === "noop"
              ? "Current"
              : "Waiting",
    },
    {
      detail:
        plan.kind === "noop"
          ? "Nothing to run"
          : job?.status === "running"
            ? `${scriptLabel(job.script)} via ${
                releaseExecutionMode === "remote" ? "Mac mini" : "This Mac"
              }`
            : `${plan.reason} ${
                releaseExecutionMode === "remote"
                  ? runnerOnline
                    ? "Mac mini is online."
                    : "Mac mini can pick it up by fallback polling."
                  : "Local recovery runner selected."
              }`,
      key: "next",
      label: "Next step",
      tone:
        plan.kind === "blocked"
          ? "blocked"
          : plan.kind === "noop"
            ? "ok"
            : "warn",
      value: job?.status === "running" ? "Running" : plan.label,
    },
  ];

  return (
    <section className="release-center__routine-summary" aria-label="Routine release summary">
      {items.map((item) => (
        <div data-tone={item.tone} key={item.key}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          <small>{item.detail}</small>
        </div>
      ))}
    </section>
  );
}

function ReleaseAutoCommitNotice({
  summary,
}: {
  summary: ReleaseAutoCommitSummary | null;
}) {
  if (!summary) return null;
  const pushed =
    summary.pushed === true
      ? "pushed to GitHub"
      : summary.pushed === false
        ? `commit created, push failed${summary.pushError ? `: ${summary.pushError}` : ""}`
        : "commit created";
  const fileCount = summary.files.length
    ? `${summary.files.length} content file${summary.files.length === 1 ? "" : "s"}`
    : "content changes";
  return (
    <section
      className="release-center__notice release-center__auto-commit"
      data-tone={summary.pushed === false ? "warn" : "ok"}
      aria-label="Content auto commit"
    >
      <strong>Content committed</strong>
      <span>
        {fileCount} were saved as {shortSha(summary.newSha)} and {pushed}.
      </span>
    </section>
  );
}

function ReleaseBuildCacheNotice({
  summary,
}: {
  summary: ReleaseBuildCacheSummary | null;
}) {
  if (!summary) return null;
  if (summary.hit) {
    const restored = summary.restored.length
      ? summary.restored.join(" + ")
      : "build artifacts";
    return (
      <section
        className="release-center__notice release-center__build-cache"
        data-tone="ok"
        aria-label="Build cache reused"
      >
        <strong>Draft build reused</strong>
        <span>
          Live restored {restored}; code and content matched
          {summary.expectedContentSha ? ` (${shortSha(summary.expectedContentSha)})` : ""}.
        </span>
      </section>
    );
  }
  if (summary.storedContentSha || summary.reason.startsWith("stored ")) {
    return (
      <section
        className="release-center__notice release-center__build-cache"
        data-tone="ok"
        aria-label="Build cache stored"
      >
        <strong>Build cache ready</strong>
        <span>
          Draft stored reusable artifacts for content {shortSha(summary.storedContentSha)}.
        </span>
      </section>
    );
  }
  if (summary.attempted) {
    return (
      <section
        className="release-center__notice release-center__build-cache"
        data-tone="warn"
        aria-label="Build cache missed"
      >
        <strong>Build cache missed</strong>
        <span>{summary.reason || "Live rebuilt because no matching Draft artifact was available."}</span>
      </section>
    );
  }
  return null;
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
      <section className="release-center__notice" data-tone="warn" aria-label="Live continuation">
        <strong>Live is next</strong>
        <span>
          Draft preview is verified. Use the top action to publish the same candidate to Live.
        </span>
      </section>
    );
  }
  if (releaseTarget === "staging" && preview?.ok === true && preview.productionDifferent) {
    return (
      <section className="release-center__notice" data-tone="muted" aria-label="Draft-only release target">
        <strong>Draft preview only</strong>
        <span>
          Draft can be current while Live still differs. Switch to Live site
          when public pages should match.
        </span>
      </section>
    );
  }
  if (releaseTarget === "production" && contentChanged) {
    return (
      <section className="release-center__notice" data-tone="warn" aria-label="Content release route">
        <strong>Content publishes in two steps</strong>
        <span>
          The first click updates Draft preview. After you verify it, the same
          top action publishes that exact content to Live.
        </span>
      </section>
    );
  }
  if (releaseTarget === "production" && preview?.ok === true && preview.productionDifferent) {
    const stagingCode = shortSha(preview.staging.codeSha);
    const productionCode = preview.production ? shortSha(preview.production.codeSha) : "none";
    const detail = !productionCodeMatchesStaging
      ? `Draft is ${stagingCode}; Live is ${productionCode}. Public pages can differ until Live is updated.`
      : overlayDiffers
        ? `Worker code matches, but Live content is behind Draft. Publish the verified Draft content next.`
        : "Live still differs from Draft. Refresh if a release just finished.";
    return (
      <section className="release-center__notice" data-tone="warn" aria-label="Live behind Draft">
        <strong>Live behind Draft</strong>
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
  productionOverlaySnapshot,
  stagingOverlaySnapshot,
  status,
}: {
  isStaging: boolean;
  localDirty: boolean;
  localSource: SiteAdminLocalReleaseSource | null;
  localStagingMismatch: boolean;
  preview: PromotePreview | null;
  productionAlreadyCurrent: boolean;
  productionOverlaySnapshot: string;
  stagingOverlaySnapshot: string;
  status: StatusPayload | null;
}) {
  const sourceTone: ReleaseTone = localDirty || localStagingMismatch
    ? "blocked"
    : status?.source?.deployableVersionReady === false
      ? "blocked"
      : status
        ? "ok"
        : "muted";
  const localCodeSha = localSource?.sha || status?.source?.codeSha || "";
  const localContentSha = status?.source?.contentSha || "";
  const stagingCode = preview?.ok ? preview.staging.codeSha : status?.source?.codeSha || "";
  const stagingContentSha = preview?.ok ? preview.staging.contentSha : status?.source?.contentSha || "";
  const productionCode = preview?.ok && preview.production ? preview.production.codeSha : "";
  const productionContentSha =
    preview?.ok && preview.production ? preview.production.contentSha : "";
  const sourceTitle = localSource
    ? localSource.dirty
      ? "Local changes"
      : shortSha(localSource.sha)
    : shortSha(status?.source?.codeSha);
  const sourceDetail = localSource
    ? localSource.dirty
      ? `${localSource.dirty_file_count} local file${localSource.dirty_file_count === 1 ? "" : "s"} changed`
      : `${localSource.branch} · HEAD ready`
    : `branch ${branchLabel(status?.source)}`;
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
      <header>
        <div>
          <h2>Draft / Live route</h2>
          <p>Technical comparison between the release source, Draft preview, and Live site.</p>
        </div>
        <strong data-tone={productionAlreadyCurrent ? "ok" : productionTone}>
          {productionAlreadyCurrent ? "Current" : "Review"}
        </strong>
      </header>
      <div className="release-center__route-path">
        <ReleaseNode
          label="Release source"
          title={sourceTitle}
          detail={sourceDetail}
          tone={sourceTone}
          metrics={[
            ["Code", shortSha(localCodeSha)],
            ["Content", shortSha(localContentSha)],
            ["State", localDirty ? "Dirty" : localStagingMismatch ? "Mismatch" : "Clean"],
          ]}
        />
        <span className="release-center__route-arrow" aria-hidden="true" />
        <ReleaseNode
          current={isStaging}
          label="Draft preview"
          title={preview?.ok ? shortId(preview.staging.versionId) : candidateLabel(status?.source)}
          detail={preview?.ok ? "Active preview" : "Load preflight"}
          tone={stagingTone}
          metrics={[
            ["Code", shortSha(stagingCode)],
            ["Content", shortSha(stagingContentSha)],
            ["Overlay", stagingOverlaySnapshot ? shortSha(stagingOverlaySnapshot) : "None"],
          ]}
        />
        <span className="release-center__route-arrow" aria-hidden="true" />
        <ReleaseNode
          label="Live site"
          title={
            preview?.ok
              ? preview.production
                ? shortId(preview.production.versionId)
                : "No deployment"
              : "Not loaded"
          }
          detail={
            productionAlreadyCurrent
              ? "Matches Draft"
              : preview?.ok
                ? "Behind Draft"
                : "Read from preflight"
          }
          tone={productionTone}
          metrics={[
            ["Code", shortSha(productionCode)],
            ["Content", shortSha(productionContentSha)],
            ["Overlay", productionOverlaySnapshot ? shortSha(productionOverlaySnapshot) : "None"],
          ]}
        />
      </div>
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
    <section className="release-center__content-status" aria-label="Draft and Live technical status">
      <header>
        <div>
          <h2>Technical Status</h2>
          <p>Code versions and static content snapshots behind Draft and Live.</p>
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
          <span>Draft Code</span>
          <strong>
            {preview?.ok ? shortSha(preview.staging.codeSha) : shortSha(status?.source?.codeSha)}
          </strong>
          <small>{preview?.ok ? shortId(preview.staging.versionId) : candidateLabel(status?.source)}</small>
        </div>
        <div className="release-center__content-cell">
          <span>Live Code</span>
          <strong>
            {preview?.ok && preview.production ? shortSha(preview.production.codeSha) : "-"}
          </strong>
          <small>{preview?.ok && preview.production ? shortId(preview.production.versionId) : "load preflight"}</small>
        </div>
        <div className="release-center__content-cell">
          <span>Draft Snapshot</span>
          <strong>{shortSha(stagingSnapshot)}</strong>
          <small>{stagingContent?.recorded_at || "not published in this app"}</small>
        </div>
        <div className="release-center__content-cell">
          <span>Live Snapshot</span>
          <strong>{shortSha(productionSnapshot)}</strong>
          <small>{productionContent?.recorded_at || "not published in this app"}</small>
        </div>
      </div>
    </section>
  );
}

function contentPreviewActionLabel(action: string): string {
  if (action === "noop") return "Current";
  if (action === "publish-overlay") return "Publish Draft";
  if (action === "copy-staging-overlay") return "Copy to Live";
  if (action === "deploy-code-first") return "Update Draft code first";
  if (action === "promote-code-first") return "Update Live code first";
  if (action === "wait-for-staging-overlay") return "Waiting for Draft";
  return action || "Unknown";
}

function ContentDiffPreviewPanel({
  contentDelta,
  preview,
}: {
  contentDelta: ContentDelta | null;
  preview: LiveReleaseStatus["contentPreview"] | null;
}) {
  if (!preview && (!contentDelta || contentDelta.changedRows === 0 || contentDelta.error)) {
    return null;
  }
  const files = preview?.files ?? [];
  const productionFiles = contentDelta?.files ?? [];
  const stagingTone: ReleaseTone =
    preview?.staging.action === "noop"
      ? "ok"
      : preview?.staging.action === "publish-overlay"
        ? "warn"
        : "blocked";
  const productionTone: ReleaseTone =
    preview?.production.action === "noop"
      ? "ok"
      : preview?.production.action === "copy-staging-overlay"
        ? "warn"
        : "muted";
  return (
    <section className="release-center__content-preview" aria-label="Content publish preview">
      <header>
        <div>
          <h2>Draft Changes</h2>
          <p>Content files that will move from Draft preview to Live.</p>
        </div>
        <strong data-tone={files.length || contentDelta?.changedRows ? "warn" : "ok"}>
          {files.length || contentDelta?.changedRows
            ? `${Math.max(files.length, contentDelta?.changedRows || 0)} change${Math.max(files.length, contentDelta?.changedRows || 0) === 1 ? "" : "s"}`
            : "No content changes"}
        </strong>
      </header>
      {preview ? (
        <div className="release-center__content-preview-grid">
          <div data-tone={stagingTone}>
            <span>Draft preview</span>
            <strong>{contentPreviewActionLabel(preview.staging.action)}</strong>
            <small>
              input {shortSha(preview.contentInputSha)} · overlay{" "}
              {shortSha(preview.staging.overlaySnapshotSha)}
            </small>
          </div>
          <div data-tone={productionTone}>
            <span>Live site</span>
            <strong>{contentPreviewActionLabel(preview.production.action)}</strong>
            <small>
              staging {shortSha(preview.production.stagingOverlaySnapshotSha)} · prod{" "}
              {shortSha(preview.production.overlaySnapshotSha)}
            </small>
          </div>
        </div>
      ) : null}
      {files.length ? (
        <ul className="release-center__content-preview-list">
          {files.map((file) => (
            <li key={file}>
              <code>{file}</code>
            </li>
          ))}
          {preview?.truncated ? <li>More content files are hidden.</li> : null}
        </ul>
      ) : productionFiles.length ? (
        <ul className="release-center__content-preview-list">
          {productionFiles.map((file) => (
            <li key={file.relPath}>
              <code>{file.relPath}</code>
              <span>{formatBytes(file.sizeBytes)}</span>
              {file.updatedAtMs ? <time>{formatRelativeTime(file.updatedAtMs)}</time> : null}
            </li>
          ))}
          {contentDelta?.truncated ? <li>More Live content rows are hidden.</li> : null}
        </ul>
      ) : null}
    </section>
  );
}

function RouteParityPanel({
  checking,
  disabled,
  error,
  onCheck,
  routeParity,
}: {
  checking: boolean;
  disabled: boolean;
  error: string;
  onCheck: () => void;
  routeParity: LiveReleaseStatus["routeParity"] | null;
}) {
  if (!routeParity && !error) return null;
  const auth = routeParity?.auth;
  return (
    <section className="release-center__route-parity" aria-label="Route parity">
      <header>
        <div>
          <h2>Route Parity</h2>
          <p>
            Draft and Live route hashes, including static shell headers.
            {auth?.stagingAuthenticated
              ? ` Draft checked as ${auth.login || "an allowed user"}.`
              : auth?.reason
                ? ` Draft auth unavailable: ${auth.reason}`
                : ""}
          </p>
        </div>
        <div className="release-center__route-parity-actions">
          <strong data-tone={routeParity?.ok ? "ok" : "warn"}>
            {checking
              ? "Checking"
              : routeParity?.skippedCount
                ? `${routeParity.skippedCount} gated`
                : routeParity?.ok
                  ? "Matched"
                  : error
                    ? "Unavailable"
                    : `${routeParity?.mismatchCount || 0} mismatch`}
          </strong>
          <button
            className="btn btn--secondary"
            disabled={disabled || checking}
            type="button"
            onClick={onCheck}
          >
            {checking ? "Checking…" : "Check pages"}
          </button>
        </div>
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
                draft {route.staging.status} shell {route.staging.staticShell || "-"}
              </span>
              <span>live {route.production.status} shell {route.production.staticShell || "-"}</span>
              <small>
                {route.skipped
                  ? route.reason || "Gated Draft route"
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
  metrics,
  title,
  tone,
}: {
  current?: boolean;
  detail: string;
  label: string;
  metrics?: Array<[string, string]>;
  title: string;
  tone: ReleaseTone;
}) {
  return (
    <div className="release-center__node" data-current={current ? "true" : undefined} data-tone={tone}>
      <span>{label}</span>
      <strong>{title || "-"}</strong>
      <small>{detail}</small>
      {metrics?.length ? (
        <dl>
          {metrics.map(([name, value]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{value || "-"}</dd>
            </div>
          ))}
        </dl>
      ) : null}
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
    <section className="release-center__confirm" data-tone="blocked" aria-label="Confirm Live rollback">
      <div>
        <span>Live rollback</span>
        <h2>Rollback to {shortId(entry.version_id)}?</h2>
        <p>
          This runs a local Cloudflare rollback and then verifies Live against
          the selected version.
        </p>
      </div>
      <pre>{entry.rollback_command}</pre>
      <div className="release-center__confirm-actions">
        <button className="btn btn--secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn--danger" type="button" onClick={onConfirm}>
          Rollback Live
        </button>
      </div>
    </section>
  );
}
