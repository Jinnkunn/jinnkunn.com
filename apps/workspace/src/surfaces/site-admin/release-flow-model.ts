import type { StatusPayload } from "./types";
import { formatPendingDeploy, normalizeString } from "./utils";

export const DEPLOY_ON_CONTENT_ACTIONS_URL =
  "https://github.com/Jinnkunn/jinnkunn.com/actions/workflows/deploy-on-content.yml";
export const RELEASE_FROM_DISPATCH_ACTIONS_URL =
  "https://github.com/Jinnkunn/jinnkunn.com/actions/workflows/release-from-dispatch.yml";

export const RELEASE_STAGING_COMMAND = "npm run release:staging";
export const RELEASE_PROD_FROM_STAGING_COMMAND =
  "npm run release:prod:from-staging";
export const RELEASE_PROD_FROM_STAGING_DRY_RUN_COMMAND =
  "npm run release:prod:from-staging:dry-run";
export const LEGACY_RELEASE_PROD_COMMAND = [
  'export CONFIRM_PRODUCTION_DEPLOY=1',
  'export CONFIRM_PRODUCTION_SHA="$(git rev-parse HEAD)"',
  "PROMOTE_STAGING_CONTENT=1 npm run release:prod",
].join("\n");

export type ReleaseFlowStage =
  | "checking"
  | "production-read-only"
  | "candidate-stale"
  | "pending-deploy"
  | "current"
  | "unknown";

export type ReleaseWorkflowKind = "deploy-auto" | "release-dispatch";

export interface ReleaseWorkflowRecovery {
  actionsUrl: string;
  command: string;
  copyLabel: string;
  detail: string;
  kind: ReleaseWorkflowKind;
  label: string;
  openLabel: string;
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
  if (kind === "github") return "GitHub content branch";
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
  const dbMode = sourceStoreKind(source ?? undefined) === "db";
  const target = deployCandidateTarget(source);
  if (dbMode) {
    return {
      actionsUrl: RELEASE_FROM_DISPATCH_ACTIONS_URL,
      command: RELEASE_STAGING_COMMAND,
      copyLabel: "Copy staging release command",
      detail: `Staging needs a release workflow rebuild for ${target}.`,
      kind: "release-dispatch",
      label: "Release workflow",
      openLabel: "Open Release Workflow",
      waitText:
        "Wait for GitHub Actions “Release from dispatch” to finish, or run npm run release:staging, then recheck.",
    };
  }
  return {
    actionsUrl: DEPLOY_ON_CONTENT_ACTIONS_URL,
    command: RELEASE_STAGING_COMMAND,
    copyLabel: "Copy staging release command",
    detail: `Staging needs a rebuilt Worker candidate for ${target}.`,
    kind: "deploy-auto",
    label: "Deploy (auto)",
    openLabel: "Open Deploy Action",
    waitText:
      "Wait for GitHub Actions “Deploy (auto)” to finish, or run npm run release:staging, then recheck.",
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
  if (productionReadOnly) return "Production is read-only here. Promote separately.";
  if (data.source?.deployableVersionReady === false) {
    return releaseWorkflowRecovery(data.source).waitText;
  }
  if (data.source?.pendingDeploy === true) return "Publish the ready staging candidate.";
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
    disabledReason = "Production is read-only in Workspace.";
  } else if (candidateBlocked) {
    stage = "candidate-stale";
    publishLabel = "Recheck";
    statusTone = "blocked";
    disabledReason = "Rebuild the staging Worker candidate before publishing.";
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
