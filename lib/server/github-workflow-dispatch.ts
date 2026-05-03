// Triggers GitHub Actions workflows via the `repository_dispatch` API. This
// is now an explicit fallback for cases where the local Cloudflare release
// command cannot run.
//
// Reuses the existing GitHub App credentials from
// createGitHubAppClientFromEnv. The App must have *Actions: Write*
// permission on the target repo for this endpoint to return 204; if it's
// only `contents:write` GitHub returns 403 and we surface that verbatim
// so the operator knows to grant the missing scope.
//
// No `server-only` marker so node:test can import it for unit coverage.

import {
  createGitHubAppClientFromEnv,
  GitHubApiError,
  type GitHubClient,
} from "./github-content-client.ts";

export type DispatchWorkflowInput = {
  /** Custom event_type the workflow listens for (e.g. "release-staging"). */
  eventType: string;
  /** Optional metadata passed to the workflow under `github.event.client_payload`. */
  clientPayload?: Record<string, unknown>;
  /** Test-only injection. In production this defaults to the env-built App
   * client; tests pass a mock that records the request without hitting the
   * real GitHub API. Owner / repo are still pulled from process.env so the
   * URL composition path runs the same way. */
  client?: GitHubClient;
  ownerOverride?: string;
  repoOverride?: string;
};

export type DispatchWorkflowResult =
  | {
      ok: true;
      provider: "github-actions";
      eventType: string;
      runsListUrl: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

function envOwner(): string {
  return String(process.env.SITE_ADMIN_REPO_OWNER || "").trim();
}

function envRepo(): string {
  return String(process.env.SITE_ADMIN_REPO_NAME || "").trim();
}

export function isWorkflowDispatchConfigured(): boolean {
  // Sanity-check the four required env vars without instantiating the App
  // client — used by the deploy backend to decide whether to attempt
  // dispatch or fall back to the legacy promote path.
  return (
    Boolean(envOwner()) &&
    Boolean(envRepo()) &&
    Boolean(String(process.env.GITHUB_APP_ID || "").trim()) &&
    Boolean(String(process.env.GITHUB_APP_INSTALLATION_ID || "").trim()) &&
    Boolean(String(process.env.GITHUB_APP_PRIVATE_KEY || "").trim())
  );
}

export async function dispatchWorkflow(
  input: DispatchWorkflowInput,
): Promise<DispatchWorkflowResult> {
  const owner = (input.ownerOverride ?? envOwner()).trim();
  const repo = (input.repoOverride ?? envRepo()).trim();
  if (!owner || !repo) {
    return {
      ok: false,
      status: 412,
      error:
        "GITHUB_REPO_NOT_CONFIGURED: SITE_ADMIN_REPO_OWNER + SITE_ADMIN_REPO_NAME required for workflow dispatch",
    };
  }
  const client = input.client ?? createGitHubAppClientFromEnv();
  if (!client) {
    return {
      ok: false,
      status: 412,
      error:
        "GITHUB_APP_NOT_CONFIGURED: GITHUB_APP_ID + GITHUB_APP_INSTALLATION_ID + GITHUB_APP_PRIVATE_KEY required for workflow dispatch",
    };
  }

  const apiPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/dispatches`;
  const body: Record<string, unknown> = {
    event_type: input.eventType,
  };
  if (input.clientPayload && Object.keys(input.clientPayload).length > 0) {
    body.client_payload = input.clientPayload;
  }

  try {
    // 204 No Content on success; the request helper tolerates an empty body.
    await client.request({ method: "POST", apiPath, body });
    return {
      ok: true,
      provider: "github-actions",
      eventType: input.eventType,
      runsListUrl: `https://github.com/${owner}/${repo}/actions`,
    };
  } catch (err: unknown) {
    if (err instanceof GitHubApiError) {
      // Surface the GitHub-side error verbatim so 403 missing-permission and
      // 422 invalid-event-type cases are obvious to the operator.
      return {
        ok: false,
        status: err.status,
        error: err.message,
      };
    }
    return {
      ok: false,
      status: 500,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
