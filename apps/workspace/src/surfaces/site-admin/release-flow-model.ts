import type { StatusPayload } from "./types";
import { formatPendingDeploy, normalizeString } from "./utils";

export const RELEASE_FROM_DISPATCH_ACTIONS_URL =
  "https://github.com/Jinnkunn/jinnkunn.com/actions/workflows/release-from-dispatch.yml";

export const RELEASE_STAGING_SCRIPT = "release:staging";
export const PUBLISH_CONTENT_STAGING_SCRIPT = "publish:content:staging";
export const PUBLISH_CONTENT_PROD_SCRIPT = "publish:content:prod";
export const PUBLISH_CONTENT_PROD_FROM_STAGING_SCRIPT =
  "publish:content:prod:from-staging";
export const PUBLISH_NOW_PROD_FROM_STAGING_SCRIPT =
  "publish:now:prod:from-staging";
export const PUBLISH_CONTENT_STAGING_ROLLBACK_SCRIPT =
  "publish:content:staging:rollback";
export const PUBLISH_CONTENT_STAGING_CLEAR_SCRIPT = "publish:content:staging:clear";
export const PUBLISH_CONTENT_PROD_ROLLBACK_SCRIPT = "publish:content:prod:rollback";
export const PUBLISH_CONTENT_PROD_CLEAR_SCRIPT = "publish:content:prod:clear";
export const RELEASE_PROD_FROM_STAGING_SCRIPT = "release:prod:from-staging";
export const RELEASE_PROD_FROM_STAGING_DRY_RUN_SCRIPT =
  "release:prod:from-staging:dry-run";
export const RELEASE_STAGING_COMMAND = `npm run ${RELEASE_STAGING_SCRIPT}`;
export const PUBLISH_CONTENT_STAGING_COMMAND =
  `npm run ${PUBLISH_CONTENT_STAGING_SCRIPT}`;
export const PUBLISH_CONTENT_PROD_COMMAND = `npm run ${PUBLISH_CONTENT_PROD_SCRIPT}`;
export const PUBLISH_CONTENT_PROD_FROM_STAGING_COMMAND =
  `npm run ${PUBLISH_CONTENT_PROD_FROM_STAGING_SCRIPT}`;
export const PUBLISH_NOW_PROD_FROM_STAGING_COMMAND =
  `npm run ${PUBLISH_NOW_PROD_FROM_STAGING_SCRIPT}`;
export const PUBLISH_CONTENT_STAGING_ROLLBACK_COMMAND =
  `npm run ${PUBLISH_CONTENT_STAGING_ROLLBACK_SCRIPT}`;
export const PUBLISH_CONTENT_STAGING_CLEAR_COMMAND =
  `npm run ${PUBLISH_CONTENT_STAGING_CLEAR_SCRIPT}`;
export const PUBLISH_CONTENT_PROD_ROLLBACK_COMMAND =
  `npm run ${PUBLISH_CONTENT_PROD_ROLLBACK_SCRIPT}`;
export const PUBLISH_CONTENT_PROD_CLEAR_COMMAND =
  `npm run ${PUBLISH_CONTENT_PROD_CLEAR_SCRIPT}`;
export const RELEASE_PROD_FROM_STAGING_COMMAND =
  `npm run ${RELEASE_PROD_FROM_STAGING_SCRIPT}`;
export const RELEASE_PROD_FROM_STAGING_DRY_RUN_COMMAND =
  `npm run ${RELEASE_PROD_FROM_STAGING_DRY_RUN_SCRIPT}`;
export const LEGACY_RELEASE_PROD_COMMAND = [
  'export CONFIRM_PRODUCTION_DEPLOY=1',
  'export CONFIRM_PRODUCTION_SHA="$(git rev-parse HEAD)"',
  "npm run release:prod",
].join("\n");

export type ReleaseFlowStage =
  | "checking"
  | "production-read-only"
  | "candidate-stale"
  | "pending-deploy"
  | "current"
  | "unknown";

export type ReleaseWorkflowKind = "local-cloudflare" | "github-fallback";

export interface ReleaseWorkflowRecovery {
  actionsUrl: string;
  command: string;
  copyLabel: string;
  detail: string;
  fallbackLabel: string;
  kind: ReleaseWorkflowKind;
  label: string;
  openLabel: string;
  script: typeof RELEASE_STAGING_SCRIPT;
  waitText: string;
}

export interface ReleaseFlowState {
  candidateBlocked: boolean;
  candidateLabel: string;
  disablePublish: boolean;
  disabledReason: string;
  isDbSource: boolean;
  nextAction: string;
  noPendingChanges: boolean;
  pendingDeploy: boolean | null | undefined;
  publishLabel: string;
  sourceDetail: string;
  sourceLabel: string;
  stage: ReleaseFlowStage;
  statusTone: "ok" | "warn" | "blocked" | "muted";
  targetLabel: string;
  workflow: ReleaseWorkflowRecovery;
}

export interface DeployResponseSummary {
  codeSha: string;
  contentBranch: string;
  contentSha: string;
  deploymentId: string;
  mode: "workflow" | "cloudflare-version" | "";
  provider: string;
  queued: boolean;
  status: number;
  triggeredAt: string;
  workflowEventType: string;
  workflowRunsListUrl: string;
}

export type ReleaseActionKind =
  | "publish-content-staging"
  | "deploy-staging-code"
  | "promote-production-code"
  | "publish-content-production-from-staging"
  | "publish-now-production-from-staging"
  | "noop"
  | "blocked";

export type ReleaseTarget = "staging" | "production";

export interface ReleasePlan {
  detail: string;
  disabled: boolean;
  kind: ReleaseActionKind;
  label: string;
  reason: string;
  script:
    | typeof PUBLISH_CONTENT_STAGING_SCRIPT
    | typeof PUBLISH_CONTENT_PROD_FROM_STAGING_SCRIPT
    | typeof PUBLISH_NOW_PROD_FROM_STAGING_SCRIPT
    | typeof RELEASE_STAGING_SCRIPT
    | typeof RELEASE_PROD_FROM_STAGING_SCRIPT
    | "";
  tone: "ok" | "warn" | "blocked" | "muted";
}

export interface ReleasePlanInput {
  contentChanged: boolean;
  isStaging: boolean;
  jobRunning: boolean;
  localDirty: boolean;
  localStagingMismatch: boolean;
  productionAlreadyCurrent: boolean;
  productionCodeMatchesStaging: boolean;
  productionOverlaySnapshot: string;
  ready: boolean;
  readyToPromote: boolean;
  stagingOverlaySnapshot: string;
  status: StatusPayload | null;
  target: ReleaseTarget;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asStatusPayload(value: unknown): StatusPayload | null {
  const data = asRecord(value);
  if (!data.source || !data.env || !data.build) return null;
  return data as unknown as StatusPayload;
}

export function normalizeStatusPayload(value: unknown): StatusPayload | null {
  return asStatusPayload(value);
}

export function deriveReleasePlan(input: ReleasePlanInput): ReleasePlan {
  if (!input.isStaging) {
    return {
      detail: "Live is inspect-only. Switch to Draft to publish.",
      disabled: true,
      kind: "blocked",
      label: "Blocked",
      reason: "Open the Draft profile first.",
      script: "",
      tone: "blocked",
    };
  }
  if (input.jobRunning) {
    return {
      detail: "A release command is already running.",
      disabled: true,
      kind: "blocked",
      label: "Running",
      reason: "Wait for the current release job to finish.",
      script: "",
      tone: "warn",
    };
  }
  if (!input.ready) {
    return {
      detail: "Sign in to the Draft profile before publishing.",
      disabled: true,
      kind: "blocked",
      label: "Connect",
      reason: "Draft connection is not ready.",
      script: "",
      tone: "blocked",
    };
  }
  if (input.localDirty) {
    return {
      detail: "Commit or stash local changes before running release jobs.",
      disabled: true,
      kind: "blocked",
      label: "Commit changes",
      reason: "Local release source is dirty.",
      script: "",
      tone: "blocked",
    };
  }

  const source = input.status?.source;
  const stagingBehind =
    input.localStagingMismatch ||
    source?.deployableVersionReady === false ||
    source?.pendingDeploy === true;
  if (stagingBehind) {
    return {
      detail: "Draft preview code is behind local HEAD. Update Draft before publishing Live.",
      disabled: false,
      kind: "deploy-staging-code",
      label: "Update Draft Preview",
      reason: "Draft preview is behind the latest code.",
      script: RELEASE_STAGING_SCRIPT,
      tone: "warn",
    };
  }
  if (input.contentChanged) {
    return {
      detail:
        input.target === "production"
          ? "Saved website content changed. Publish Draft preview first, then copy the verified content to Live."
          : "Saved website content changed. Publish the Draft preview only.",
      disabled: false,
      kind: "publish-content-staging",
      label: "Publish Draft Preview",
      reason:
        input.target === "production"
          ? "Content changed; Draft preview is the first step."
          : "Content changed; update Draft preview.",
      script: PUBLISH_CONTENT_STAGING_SCRIPT,
      tone: "warn",
    };
  }
  const stagingOverlayDiffers =
    Boolean(input.stagingOverlaySnapshot) &&
    input.stagingOverlaySnapshot !== input.productionOverlaySnapshot;
  if (input.target === "staging") {
    return {
      detail: stagingOverlayDiffers || !input.productionAlreadyCurrent
        ? "Draft is current. Switch the target to Live site when public pages should match."
        : "Draft is current.",
      disabled: false,
      kind: "noop",
      label: "Draft Current",
      reason: "No Draft publish work is needed.",
      script: "",
      tone: "ok",
    };
  }
  if (input.readyToPromote) {
    return {
      detail: "Live code differs from the verified Draft preview.",
      disabled: false,
      kind: "promote-production-code",
      label: "Update Live Site",
      reason: "Live site is behind Draft preview.",
      script: RELEASE_PROD_FROM_STAGING_SCRIPT,
      tone: "warn",
    };
  }
  if (stagingOverlayDiffers) {
    if (!input.productionCodeMatchesStaging) {
      return {
        detail: "Live must run the same Worker code before copying the verified Draft content.",
        disabled: false,
        kind: "promote-production-code",
        label: "Update Live Site",
        reason: "Live code must match Draft before content copy.",
        script: RELEASE_PROD_FROM_STAGING_SCRIPT,
        tone: "warn",
      };
    }
    return {
      detail: "Draft content is verified. Copy the exact same content to Live.",
      disabled: false,
      kind: "publish-content-production-from-staging",
      label: "Publish Draft to Live",
      reason: "Draft content is verified; Live content is behind.",
      script: PUBLISH_CONTENT_PROD_FROM_STAGING_SCRIPT,
      tone: "warn",
    };
  }
  if (input.productionAlreadyCurrent) {
    return {
      detail: "Live code and content match Draft.",
      disabled: false,
      kind: "noop",
      label: "Live Current",
      reason: "No release work is needed.",
      script: "",
      tone: "ok",
    };
  }
  return {
    detail: "Refresh the release status before choosing the next step.",
    disabled: false,
    kind: "noop",
    label: "Refresh Status",
    reason: "Release state needs a fresh check.",
    script: "",
    tone: "muted",
  };
}

export function shortSha(value?: string | null): string {
  return normalizeString(value).slice(0, 7) || "-";
}

export function shortId(value?: string | null): string {
  const safe = normalizeString(value);
  return safe ? safe.slice(0, 8) : "-";
}

export function sourceStoreKind(source: StatusPayload["source"] | undefined): string {
  return normalizeString(source?.storeKind).toLowerCase();
}

export function sourceStoreLabel(source: StatusPayload["source"] | undefined): string {
  const kind = sourceStoreKind(source);
  if (kind === "db") return "D1 content database";
  if (kind === "local") return "Local filesystem";
  return "Unknown source";
}

export function sourceLocation(source: StatusPayload["source"] | undefined): string {
  const kind = sourceStoreKind(source);
  const repo = normalizeString(source?.repo);
  const branch = normalizeString(source?.branch);
  if (kind === "db") return repo || "D1 binding";
  if (repo && branch) return `${repo}:${branch}`;
  return branch || repo || "-";
}

export function candidateLabel(source: StatusPayload["source"] | undefined): string {
  if (!source) return "Unknown";
  if (source.deployableVersionReady === true) return "Ready";
  if (source.deployableVersionReady === false) return "Stale";
  return "Unknown";
}

export function branchLabel(source: StatusPayload["source"] | undefined): string {
  return normalizeString(source?.contentBranch || source?.branch) || "-";
}

export function deployStateLabel(source: StatusPayload["source"] | undefined): string {
  if (!source) return "Load status";
  if (source.pendingDeploy === true) return "Content ahead of deployment";
  if (source.pendingDeploy === false) return "Deployment current";
  if (sourceStoreKind(source) === "db") return "DB source, no branch diff";
  const reason = normalizeString(source.pendingDeployReason);
  return reason ? `Unknown (${reason})` : "Unknown";
}

export function deployCandidateTarget(source: StatusPayload["source"] | null | undefined): string {
  const content = shortSha(source?.contentSha);
  const branch = normalizeString(source?.contentBranch || source?.branch);
  if (content !== "-" && branch) return `content ${content} on ${branch}`;
  if (content !== "-") return `content ${content}`;
  if (branch) return branch;
  return "latest content";
}

export function releaseWorkflowRecovery(
  source: StatusPayload["source"] | null | undefined,
): ReleaseWorkflowRecovery {
  const target = deployCandidateTarget(source);
  return {
    actionsUrl: RELEASE_FROM_DISPATCH_ACTIONS_URL,
    command: RELEASE_STAGING_COMMAND,
    copyLabel: "Copy local release command",
    detail: `Draft needs a local publish for ${target}.`,
    fallbackLabel: "GitHub dispatch fallback",
    kind: "local-cloudflare",
    label: "Local Cloudflare release",
    openLabel: "Open GitHub fallback",
    script: RELEASE_STAGING_SCRIPT,
    waitText:
      "Use Smart Release for routine publishing. It picks Draft content, Draft code, Live publishing, or no-op. Use GitHub Actions only as a fallback.",
  };
}

export function deployCandidateBlockedMessage(
  source: StatusPayload["source"] | null | undefined,
): string {
  const workflow = releaseWorkflowRecovery(source);
  const detail = source?.deployableVersionReason
    ? ` ${source.deployableVersionReason}`
    : "";
  return [workflow.detail, workflow.waitText, detail].filter(Boolean).join(" ");
}

export function nextActionLabel(
  data: StatusPayload | null,
  productionReadOnly: boolean,
): string {
  if (!data) return "Refresh status.";
  if (productionReadOnly) return "Live is read-only here. Publish from Draft.";
  if (data.source?.deployableVersionReady === false) {
    return releaseWorkflowRecovery(data.source).waitText;
  }
  if (data.source?.pendingDeploy === true) return "Publish the ready Draft candidate.";
  if (data.source?.deployableVersionReady === true) return "No publish action needed.";
  if (sourceStoreKind(data.source) === "db") {
    return "No branch diff is available for D1 source; use the candidate readiness signal.";
  }
  return "Refresh status before publishing.";
}

export function deriveReleaseFlow(
  status: StatusPayload | null,
  options: {
    productionReadOnly: boolean;
    publishLabel?: string;
  },
): ReleaseFlowState {
  const source = status?.source;
  const workflow = releaseWorkflowRecovery(source);
  const candidateBlocked = source?.deployableVersionReady === false;
  const pendingDeploy = source?.pendingDeploy;
  const noPendingChanges = Boolean(status && pendingDeploy !== true && !candidateBlocked);
  const isDbSource = sourceStoreKind(source) === "db";
  const label = normalizeString(options.publishLabel) || "Publish";
  let stage: ReleaseFlowStage = "unknown";
  let publishLabel = label;
  let statusTone: ReleaseFlowState["statusTone"] = "muted";
  let disabledReason = "";

  if (!status) {
    stage = "checking";
    publishLabel = "Checking…";
    statusTone = "muted";
  } else if (options.productionReadOnly) {
    stage = "production-read-only";
    publishLabel = label;
    statusTone = "muted";
    disabledReason = "Live is read-only in Workspace.";
  } else if (candidateBlocked) {
    stage = "candidate-stale";
    publishLabel = "Recheck";
    statusTone = "blocked";
    disabledReason = "Rebuild the Draft Worker candidate before publishing.";
  } else if (pendingDeploy === true) {
    stage = "pending-deploy";
    publishLabel = label;
    statusTone = "warn";
  } else if (status) {
    stage = "current";
    publishLabel = "No changes";
    statusTone = "ok";
    disabledReason = "No saved source changes are waiting to publish.";
  }

  return {
    candidateBlocked,
    candidateLabel: candidateLabel(source),
    disablePublish: Boolean(options.productionReadOnly || noPendingChanges),
    disabledReason,
    isDbSource,
    nextAction: nextActionLabel(status, options.productionReadOnly),
    noPendingChanges,
    pendingDeploy,
    publishLabel,
    sourceDetail: sourceLocation(source),
    sourceLabel: sourceStoreLabel(source),
    stage,
    statusTone,
    targetLabel: deployCandidateTarget(source),
    workflow,
  };
}

export function parseDeployResponseSummary(raw: unknown): DeployResponseSummary {
  const data = asRecord(raw);
  const status = Number(data.status ?? 0);
  const modeRaw = normalizeString(data.mode);
  const mode =
    modeRaw === "workflow" || modeRaw === "cloudflare-version" ? modeRaw : "";
  const workflowRunsListUrl = normalizeString(data.workflowRunsListUrl);
  const workflowEventType = normalizeString(data.workflowEventType);
  const queued =
    data.queued === true ||
    status === 202 ||
    mode === "workflow" ||
    Boolean(workflowRunsListUrl || workflowEventType);
  return {
    codeSha: normalizeString(data.codeSha),
    contentBranch: normalizeString(data.contentBranch),
    contentSha: normalizeString(data.contentSha),
    deploymentId: normalizeString(data.deploymentId),
    mode,
    provider: normalizeString(data.provider),
    queued,
    status,
    triggeredAt: normalizeString(data.triggeredAt),
    workflowEventType,
    workflowRunsListUrl,
  };
}

export function formatSourceRevision(source: StatusPayload["source"] | undefined): string {
  if (sourceStoreKind(source) === "db" && !source?.contentSha) return "D1 rows";
  return shortSha(source?.contentSha || source?.headSha);
}

export function formatDeployDetail(source: StatusPayload["source"] | undefined): {
  detail: string;
  value: string;
} {
  if (!source) return { detail: "No status loaded", value: "Unknown" };
  if (sourceStoreKind(source) === "db" && source.pendingDeploy === null) {
    return {
      detail: "D1 source has no branch diff; use Worker candidate readiness.",
      value: "Ready",
    };
  }
  return {
    detail: formatPendingDeploy(source),
    value: source.pendingDeploy === true ? "Pending" : "Current",
  };
}
