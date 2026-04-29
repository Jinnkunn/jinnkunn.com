import "server-only";

import {
  createGitHubAppClientFromEnv,
  GitHubApiError,
  type GitHubClient,
} from "./github-content-client";
import {
  dispatchWorkflow,
  isWorkflowDispatchConfigured,
} from "./github-workflow-dispatch";
import { logWarn } from "./error-log";

// Service that backs the "Promote to Production" button on the staging
// site-admin. Encapsulates the read-side checks (staging vs main vs prod)
// AND the dispatch action so the route file stays a thin wrapper.
//
// Why the staging worker can drive a production release:
// - The staging worker has CLOUDFLARE_API_TOKEN at runtime (already used
//   by the existing deploy hook to flip CF deployments).
// - It also has GitHub App credentials (already used by the existing db-
//   mode dispatch path).
// - So the worker can read both Worker scripts (own + production) over
//   the CF API and dispatch the `release-production` Action over the
//   GitHub API. No new secrets, no new infrastructure.

export type PromoteEnvironmentSnapshot = {
  workerName: string;
  versionId: string;
  deploymentId: string;
  codeSha: string;
  contentSha: string;
  contentBranch: string;
};

export type PromotePreviewError =
  | "MISSING_CLOUDFLARE_CREDENTIALS"
  | "MISSING_GITHUB_APP"
  | "MISSING_WORKER_NAMES"
  | "STAGING_NO_DEPLOYMENT"
  | "STAGING_METADATA_UNREADABLE"
  | "MAIN_REF_UNREADABLE"
  | "STAGING_BEHIND_MAIN"
  | "CLOUDFLARE_API_FAILED"
  | "GITHUB_API_FAILED";

export type PromotePreview =
  | {
      ok: true;
      mainSha: string;
      stagingSha: string;
      staging: PromoteEnvironmentSnapshot;
      production: PromoteEnvironmentSnapshot | null;
      stagingMatchesMain: boolean;
      productionDifferent: boolean;
      workflowEventType: "release-production";
      runsListUrl: string;
      githubAppConfigured: boolean;
    }
  | {
      ok: false;
      code: PromotePreviewError;
      detail: string;
    };

export type PromoteDispatchResult =
  | {
      ok: true;
      preview: Extract<PromotePreview, { ok: true }>;
      runsListUrl: string;
      eventType: "release-production";
      provider: "github-actions";
      dispatchedAt: string;
    }
  | {
      ok: false;
      code: PromotePreviewError | "DISPATCH_FAILED";
      detail: string;
      status: number;
    };

function readEnv(name: string): string {
  return String(process.env[name] || "").trim();
}

function readAccountId(): string {
  return readEnv("CLOUDFLARE_ACCOUNT_ID") || readEnv("CF_ACCOUNT_ID");
}

function readApiToken(): string {
  return readEnv("CLOUDFLARE_API_TOKEN") || readEnv("CF_API_TOKEN");
}

function readStagingWorkerName(): string {
  return (
    readEnv("CLOUDFLARE_WORKER_NAME_STAGING") || readEnv("CLOUDFLARE_WORKER_NAME")
  );
}

function readProductionWorkerName(): string {
  // Don't fall back to CLOUDFLARE_WORKER_NAME for production — the bare
  // var on a staging worker points at the staging script, and a typo
  // there would target the wrong worker for "is production behind?".
  return readEnv("CLOUDFLARE_WORKER_NAME_PRODUCTION");
}

function readRepoOwner(): string {
  return readEnv("SITE_ADMIN_REPO_OWNER");
}

function readRepoName(): string {
  return readEnv("SITE_ADMIN_REPO_NAME");
}

async function cfRequest({
  accountId,
  apiToken,
  apiPath,
}: {
  accountId: string;
  apiToken: string;
  apiPath: string;
}): Promise<unknown> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    accountId,
  )}${apiPath}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      `Cloudflare API GET ${apiPath} returned non-JSON: ${text.slice(0, 200)}`,
    );
  }
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  if (!response.ok || record.success === false) {
    const errors = Array.isArray(record.errors)
      ? record.errors
          .map((e) => (e && typeof e === "object" ? String((e as { message?: unknown }).message ?? "") : ""))
          .filter(Boolean)
          .join("; ")
      : "";
    throw new Error(
      `Cloudflare API GET ${apiPath} failed (${response.status}): ${errors || text || response.statusText}`,
    );
  }
  return (record.result as unknown) ?? payload;
}

// Cloudflare list endpoints wrap the array under a type-specific key
// (`{ deployments: [...] }`, `{ items: [...] }`). Walk all array values
// so this stays resilient to which key the API picks.
function pickFirst(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload[0] ?? null;
  if (!payload || typeof payload !== "object") return null;
  for (const value of Object.values(payload as Record<string, unknown>)) {
    if (Array.isArray(value) && value.length > 0) return value[0];
  }
  return null;
}

function parseDeployMessage(messageRaw: unknown): {
  sourceSha: string;
  sourceBranch: string;
  codeSha: string;
  codeBranch: string;
  contentSha: string;
  contentBranch: string;
} {
  const message = String(messageRaw || "");
  const token = (name: string): string => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hit = new RegExp(`\\b${escaped}=([^\\s]+)`, "i").exec(message);
    return hit?.[1] || "";
  };
  return {
    sourceSha: token("source"),
    sourceBranch: token("branch"),
    codeSha: token("code"),
    codeBranch: token("codeBranch"),
    contentSha: token("content"),
    contentBranch: token("contentBranch"),
  };
}

async function readActiveDeployment({
  accountId,
  apiToken,
  workerName,
}: {
  accountId: string;
  apiToken: string;
  workerName: string;
}): Promise<PromoteEnvironmentSnapshot | null> {
  const deployments = await cfRequest({
    accountId,
    apiToken,
    apiPath: `/workers/scripts/${encodeURIComponent(workerName)}/deployments`,
  });
  const active = pickFirst(deployments) as Record<string, unknown> | null;
  if (!active) return null;
  const versions = Array.isArray(active.versions)
    ? (active.versions as Array<Record<string, unknown>>)
    : [];
  versions.sort(
    (a, b) => Number(b.percentage ?? 0) - Number(a.percentage ?? 0),
  );
  const primary = versions[0];
  const versionId = primary && typeof primary.version_id === "string" ? primary.version_id : "";
  if (!versionId) return null;
  const versionDetail = (await cfRequest({
    accountId,
    apiToken,
    apiPath: `/workers/scripts/${encodeURIComponent(workerName)}/versions/${encodeURIComponent(versionId)}`,
  })) as Record<string, unknown> | null;
  const annotations =
    versionDetail && typeof versionDetail === "object"
      ? ((versionDetail as { annotations?: unknown }).annotations as Record<string, unknown>) || {}
      : {};
  const message =
    String(annotations["workers/message"] || "") ||
    String((versionDetail as { message?: unknown } | null)?.message || "");
  const meta = parseDeployMessage(message);
  return {
    workerName,
    versionId,
    deploymentId: String(active.id || ""),
    codeSha: meta.codeSha || meta.sourceSha,
    contentSha: meta.contentSha || meta.sourceSha,
    contentBranch: meta.contentBranch || meta.sourceBranch,
  };
}

async function readMainSha(client: GitHubClient): Promise<string> {
  const owner = readRepoOwner();
  const repo = readRepoName();
  if (!owner || !repo) {
    throw new Error("Missing SITE_ADMIN_REPO_OWNER / SITE_ADMIN_REPO_NAME");
  }
  const result = await client.request<{ object?: { sha?: unknown } }>({
    method: "GET",
    apiPath: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/main`,
  });
  const sha = String(result?.object?.sha ?? "").trim();
  if (!sha) throw new Error("Main ref response missing object.sha");
  return sha;
}

function fail(code: PromotePreviewError, detail: string): Extract<PromotePreview, { ok: false }> {
  return { ok: false, code, detail };
}

export async function readPromotePreview(): Promise<PromotePreview> {
  const accountId = readAccountId();
  const apiToken = readApiToken();
  if (!accountId || !apiToken) {
    return fail("MISSING_CLOUDFLARE_CREDENTIALS", "Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN on the staging worker.");
  }
  const stagingWorker = readStagingWorkerName();
  const productionWorker = readProductionWorkerName();
  if (!stagingWorker || !productionWorker) {
    return fail(
      "MISSING_WORKER_NAMES",
      "Set CLOUDFLARE_WORKER_NAME_STAGING and CLOUDFLARE_WORKER_NAME_PRODUCTION on the staging worker.",
    );
  }

  const githubClient = createGitHubAppClientFromEnv();
  if (!githubClient || !isWorkflowDispatchConfigured()) {
    return fail(
      "MISSING_GITHUB_APP",
      "GitHub App credentials missing. Set SITE_ADMIN_GH_APP_* secrets on the staging worker.",
    );
  }

  let staging: PromoteEnvironmentSnapshot | null;
  let production: PromoteEnvironmentSnapshot | null;
  try {
    [staging, production] = await Promise.all([
      readActiveDeployment({ accountId, apiToken, workerName: stagingWorker }),
      readActiveDeployment({ accountId, apiToken, workerName: productionWorker }),
    ]);
  } catch (error) {
    return fail(
      "CLOUDFLARE_API_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!staging) {
    return fail(
      "STAGING_NO_DEPLOYMENT",
      `Staging worker ${stagingWorker} has no active deployment yet.`,
    );
  }
  const stagingSha = staging.codeSha;
  if (!stagingSha) {
    return fail(
      "STAGING_METADATA_UNREADABLE",
      "Staging deployment annotation has no code= SHA. Was it deployed via release-cloudflare.mjs?",
    );
  }

  let mainSha: string;
  try {
    mainSha = await readMainSha(githubClient);
  } catch (error) {
    if (error instanceof GitHubApiError) {
      return fail("GITHUB_API_FAILED", `${error.status}: ${error.message}`);
    }
    return fail(
      "MAIN_REF_UNREADABLE",
      error instanceof Error ? error.message : String(error),
    );
  }

  const stagingMatchesMain =
    stagingSha.toLowerCase() === mainSha.toLowerCase();
  if (!stagingMatchesMain) {
    return fail(
      "STAGING_BEHIND_MAIN",
      `Staging is on ${stagingSha.slice(0, 12)} but main is on ${mainSha.slice(0, 12)}. Re-release staging first.`,
    );
  }

  const productionDifferent =
    !production ||
    (production.codeSha || "").toLowerCase() !== stagingSha.toLowerCase();

  const owner = readRepoOwner();
  const repo = readRepoName();
  const runsListUrl = `https://github.com/${owner}/${repo}/actions/workflows/release-from-dispatch.yml`;

  return {
    ok: true,
    mainSha,
    stagingSha,
    staging,
    production,
    stagingMatchesMain: true,
    productionDifferent,
    workflowEventType: "release-production",
    runsListUrl,
    githubAppConfigured: true,
  };
}

export async function dispatchPromoteToProduction(input: {
  preview: Extract<PromotePreview, { ok: true }>;
  triggeredBy: string;
}): Promise<PromoteDispatchResult> {
  const dispatchedAt = new Date().toISOString();
  const result = await dispatchWorkflow({
    eventType: "release-production",
    clientPayload: {
      triggeredAt: dispatchedAt,
      triggeredBy: input.triggeredBy,
      mainSha: input.preview.mainSha,
      stagingSha: input.preview.stagingSha,
      productionVersionBefore: input.preview.production?.versionId ?? null,
    },
  });
  if (!result.ok) {
    logWarn({
      source: "promote-to-production",
      message: "workflow dispatch failed",
      detail: result.error,
      meta: { status: result.status, mainSha: input.preview.mainSha },
    });
    return {
      ok: false,
      code: "DISPATCH_FAILED",
      detail: result.error,
      status: result.status,
    };
  }
  return {
    ok: true,
    preview: input.preview,
    runsListUrl: result.runsListUrl,
    eventType: "release-production",
    provider: "github-actions",
    dispatchedAt,
  };
}
