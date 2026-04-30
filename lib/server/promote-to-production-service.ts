import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import {
  createGitHubAppClientFromEnv,
  GitHubApiError,
  type GitHubClient,
} from "./github-content-client";
import {
  dispatchWorkflow,
  isWorkflowDispatchConfigured,
} from "./github-workflow-dispatch";
import { createD1Executor, type D1DatabaseLike } from "./d1-executor";
import type { DbExecutor } from "./db-content-store";
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
  /** When CF reports this deployment went live, as unix ms. Used to filter
   * `content_files.updated_at` for the promote preview's "what's about to
   * change" diff. `null` if CF didn't return a parseable `created_on`. */
  deployedAtMs: number | null;
};

export type PromoteContentDeltaEntry = {
  relPath: string;
  sizeBytes: number;
  /** sha1(body) — same value used for the optimistic-lock contract. */
  sha: string;
  updatedAtMs: number;
  updatedBy: string | null;
};

export type PromoteContentDelta = {
  /** Total rows currently in staging D1's content_files. */
  totalRows: number;
  /** Rows whose `updated_at` is newer than production's deployedAtMs. These
   * are the files that will overwrite production's bundled snapshot at the
   * next promote. */
  changedRows: number;
  /** Up to MAX_DELTA_ENTRIES of the changed rows, newest-first. The UI uses
   * this to render an inline "Calendar nav, 3 page rewrites…" preview. */
  files: PromoteContentDeltaEntry[];
  /** True if `changedRows > MAX_DELTA_ENTRIES` and the list above was
   * capped. The UI shows a "+N more" tail when set. */
  truncated: boolean;
  /** Why the delta couldn't be computed (no D1 binding, no production
   * deployment timestamp, query error). When set, the rest of the fields
   * are zeroes — the UI falls back to "delta unavailable". */
  error?: string;
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
      /** Best-effort summary of which staging D1 rows have moved since
       * production's last deploy. Always present, but may carry an
       * `error` and zero counts when D1 isn't reachable. The UI uses
       * `changedRows` for a one-glance count badge and `files` for an
       * expandable list. */
      contentDelta: PromoteContentDelta;
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
  // CF returns `created_on` as an ISO 8601 string. Parse to ms here so
  // the content-delta query can do a single integer comparison against
  // `content_files.updated_at` (which is unix ms by schema). NaN is
  // surfaced as null so callers can take the "delta unavailable" branch
  // instead of comparing against silently-corrupt timestamps.
  const createdOnRaw = String(active.created_on || "");
  const createdOnMs = createdOnRaw ? Date.parse(createdOnRaw) : NaN;
  return {
    workerName,
    versionId,
    deploymentId: String(active.id || ""),
    codeSha: meta.codeSha || meta.sourceSha,
    contentSha: meta.contentSha || meta.sourceSha,
    contentBranch: meta.contentBranch || meta.sourceBranch,
    deployedAtMs: Number.isFinite(createdOnMs) ? createdOnMs : null,
  };
}

const MAX_DELTA_ENTRIES = 50;

function tryGetStagingDbExecutor(): DbExecutor | null {
  // The promote endpoint runs on the staging worker; its SITE_ADMIN_DB
  // binding is staging D1 — exactly the database the operator writes to
  // and the database the build will dump for the promote. Same accessor
  // pattern as content-store-resolver.ts; getCloudflareContext throws
  // outside a request lifecycle (build, scripts), so we swallow that
  // and let the caller surface "delta unavailable".
  try {
    const { env } = getCloudflareContext();
    const binding = (env as Record<string, unknown>).SITE_ADMIN_DB;
    if (
      binding &&
      typeof binding === "object" &&
      typeof (binding as { prepare?: unknown }).prepare === "function"
    ) {
      return createD1Executor(binding as D1DatabaseLike);
    }
    return null;
  } catch {
    return null;
  }
}

async function readContentDelta(
  productionDeployedAtMs: number | null,
): Promise<PromoteContentDelta> {
  const empty = (error: string): PromoteContentDelta => ({
    totalRows: 0,
    changedRows: 0,
    files: [],
    truncated: false,
    error,
  });

  if (productionDeployedAtMs === null) {
    // We don't know when production was deployed, so we can't tell which
    // rows are newer. Don't lie with a count — surface the limitation.
    return empty("Production deployment timestamp unavailable");
  }
  const executor = tryGetStagingDbExecutor();
  if (!executor) return empty("D1 binding not available in this context");

  let totalRows = 0;
  let changedRows = 0;
  let files: PromoteContentDeltaEntry[] = [];
  try {
    const totalResult = await executor.execute({
      sql: "SELECT COUNT(*) AS n FROM content_files",
    });
    totalRows = Number(totalResult.rows?.[0]?.n ?? 0) || 0;

    // Limit to MAX_DELTA_ENTRIES + 1 so we know whether to set
    // `truncated`. The +1 row is dropped before returning.
    const changedResult = await executor.execute({
      sql: `SELECT rel_path, size, sha, updated_at, updated_by
            FROM content_files
            WHERE updated_at > ?
            ORDER BY updated_at DESC
            LIMIT ?`,
      args: [productionDeployedAtMs, MAX_DELTA_ENTRIES + 1],
    });
    const rows = Array.isArray(changedResult.rows) ? changedResult.rows : [];
    files = rows.slice(0, MAX_DELTA_ENTRIES).map((row) => ({
      relPath: String(row.rel_path ?? ""),
      sizeBytes: Number(row.size ?? 0) || 0,
      sha: String(row.sha ?? ""),
      updatedAtMs: Number(row.updated_at ?? 0) || 0,
      updatedBy: row.updated_by == null ? null : String(row.updated_by),
    }));

    // Cheap second count query (rather than reading all rows) so the
    // "+N more" suffix is accurate even when the body fetch was capped.
    const changedCountResult = await executor.execute({
      sql: "SELECT COUNT(*) AS n FROM content_files WHERE updated_at > ?",
      args: [productionDeployedAtMs],
    });
    changedRows = Number(changedCountResult.rows?.[0]?.n ?? 0) || 0;
  } catch (error) {
    return empty(error instanceof Error ? error.message : String(error));
  }

  return {
    totalRows,
    changedRows,
    files,
    truncated: changedRows > files.length,
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

  // Content delta is informational, never blocks the promote — the
  // operator may legitimately want to ship a code-only change with no
  // D1 movement. Errors collapse to `error` field on the delta itself.
  const contentDelta = await readContentDelta(production?.deployedAtMs ?? null);

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
    contentDelta,
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
