import { useCallback, useEffect, useMemo, useState } from "react";

import { SiteAdminEnvironmentBanner } from "./SiteAdminEnvironmentBanner";
import { useSiteAdmin } from "./state";
import type { StatusPayload } from "./types";
import { getSiteAdminEnvironment, normalizeString } from "./utils";

const PRODUCTION_RUNBOOK_PATH = "docs/runbooks/production-promotion.md";
const PREFLIGHT_COMMAND = [
  "git switch main",
  "git pull --ff-only",
  "git status --short",
  "npm run release:prod:dry-run",
  "npm run verify:staging:authenticated",
  "npm run check:staging-visual",
].join("\n");
const PROMOTION_COMMAND = [
  'export CONFIRM_PRODUCTION_DEPLOY=1',
  'export CONFIRM_PRODUCTION_SHA="$(git rev-parse HEAD)"',
  "PROMOTE_STAGING_CONTENT=1 npm run release:prod",
].join("\n");

type ReleaseTone = "ok" | "warn" | "blocked" | "muted";

type ReleaseCheck = {
  detail: string;
  label: string;
  tone: ReleaseTone;
  value: string;
};

function normalizeStatus(data: unknown): StatusPayload | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (!obj.source || !obj.env || !obj.build) return null;
  return obj as unknown as StatusPayload;
}

function shortSha(value?: string | null): string {
  return normalizeString(value).slice(0, 7) || "-";
}

function shortId(value?: string | null): string {
  const safe = normalizeString(value);
  return safe ? safe.slice(0, 8) : "-";
}

function candidateLabel(source: StatusPayload["source"] | undefined): string {
  if (!source) return "Unknown";
  if (source.deployableVersionReady === true) return "Ready";
  if (source.deployableVersionReady === false) return "Stale";
  return "Unknown";
}

function branchLabel(source: StatusPayload["source"] | undefined): string {
  return normalizeString(source?.contentBranch || source?.branch) || "-";
}

function productionCommandFor(status: StatusPayload | null): string {
  const contentSha = normalizeString(status?.source?.contentSha);
  const contentBranch = normalizeString(
    status?.source?.contentBranch || status?.source?.branch,
  );
  const lines = [...PROMOTION_COMMAND.split("\n")];
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
): ReleaseCheck[] {
  const source = status?.source;
  const candidateReady = source?.deployableVersionReady;
  const pendingDeploy = source?.pendingDeploy;
  const codeSha = normalizeString(source?.codeSha);
  const contentSha = normalizeString(source?.contentSha);
  const contentBranch = branchLabel(source);
  return [
    {
      detail: isStaging
        ? "You are looking at the staging candidate that should be promoted."
        : "Switch to Staging before preparing a production promotion.",
      label: "Current profile",
      tone: isStaging ? "ok" : "blocked",
      value: isStaging ? "Staging" : "Not staging",
    },
    {
      detail: "Production release uses main code. Run the copied preflight command locally.",
      label: "Main preflight",
      tone: "warn",
      value: "Local check",
    },
    {
      detail: source?.deployableVersionReason ||
        "Latest uploaded Worker version should match current code/content.",
      label: "Worker candidate",
      tone: candidateReady === true ? "ok" : candidateReady === false ? "blocked" : "warn",
      value: candidateLabel(source),
    },
    {
      detail: pendingDeploy === true
        ? "Publish staging first, then promote the validated result."
        : "Staging appears current for this content source.",
      label: "Staging deploy",
      tone: pendingDeploy === true ? "blocked" : "ok",
      value: pendingDeploy === true ? "Pending" : "Current",
    },
    {
      detail: codeSha
        ? "Code SHA reported by the staging Worker candidate."
        : "Status did not include a code SHA.",
      label: "Code SHA",
      tone: codeSha ? "ok" : "warn",
      value: shortSha(codeSha),
    },
    {
      detail: contentSha
        ? `Content comes from ${contentBranch}.`
        : "Content SHA is unavailable; confirm source state before promotion.",
      label: "Content SHA",
      tone: contentSha ? "ok" : "warn",
      value: contentSha ? shortSha(contentSha) : "-",
    },
  ];
}

export function ReleasePanel() {
  const {
    environment,
    profiles,
    request,
    setMessage,
    switchProfile,
  } = useSiteAdmin();
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const stagingProfile = useMemo(
    () =>
      profiles.find(
        (profile) => getSiteAdminEnvironment(profile.baseUrl).kind === "staging",
      ) ?? null,
    [profiles],
  );
  const isStaging = environment.kind === "staging";
  const activeDeploymentLabel =
    environment.kind === "production" ? "Active production" : "Active staging";
  const checks = releaseChecks(status, isStaging);
  const readyToPromote =
    isStaging &&
    status?.source?.deployableVersionReady === true &&
    status.source.pendingDeploy !== true;

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
      const normalized = normalizeStatus(response.data);
      if (!normalized) {
        setError("Invalid status payload");
        if (!options.silent) {
          setMessage("error", "Load release status failed: invalid payload");
        }
        return;
      }
      setStatus(normalized);
      if (!options.silent) setMessage("success", "Release status loaded.");
    },
    [request, setMessage],
  );

  /* eslint-disable react-hooks/set-state-in-effect -- Initial release status hydration is an async site-admin request; state updates happen after the request resolves. */
  useEffect(() => {
    void loadStatus({ silent: true });
  }, [loadStatus]);
  /* eslint-enable react-hooks/set-state-in-effect */

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

  return (
    <section className="surface-card release-panel">
      <header className="release-panel__header">
        <div>
          <h1>Release</h1>
          <p>
            Promote the validated staging candidate to production through the guarded
            release path.
          </p>
        </div>
        <div className="release-panel__actions">
          <button
            className="btn btn--secondary"
            type="button"
            onClick={() => void loadStatus()}
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button
            className="btn btn--secondary"
            type="button"
            onClick={() => void copyText("preflight command", PREFLIGHT_COMMAND)}
          >
            Copy Preflight
          </button>
          <button
            className={readyToPromote ? "btn btn--primary" : "btn btn--secondary"}
            type="button"
            onClick={() =>
              void copyText("production promotion command", productionCommandFor(status))
            }
          >
            Copy Production Command
          </button>
        </div>
      </header>

      <SiteAdminEnvironmentBanner actionLabel="prepare production promotion" />

      {error ? <div className="release-panel__error">{error}</div> : null}

      {!isStaging ? (
        <div className="release-panel__notice" role="status">
          <div>
            <strong>Production promotion starts from Staging</strong>
            <span>
              Production remains inspect-only in Workspace. Switch to Staging, verify the
              candidate, then copy the guarded command from this page.
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

      <div className="release-panel__summary">
        <div>
          <span>Staging candidate</span>
          <strong>{candidateLabel(status?.source)}</strong>
          <code>{shortId(status?.deployments?.latestUploaded?.versionId)}</code>
        </div>
        <div>
          <span>{activeDeploymentLabel}</span>
          <strong>{shortId(status?.deployments?.active?.versionId)}</strong>
          <code>{status?.deployments?.active?.createdOn || "-"}</code>
        </div>
        <div>
          <span>Code</span>
          <strong>{shortSha(status?.source?.codeSha)}</strong>
          <code>main</code>
        </div>
        <div>
          <span>Content</span>
          <strong>{shortSha(status?.source?.contentSha)}</strong>
          <code>{branchLabel(status?.source)}</code>
        </div>
      </div>

      <section className="release-panel__checks" aria-label="Production promotion checklist">
        <header>
          <div>
            <h2>Promotion Checklist</h2>
            <p>These checks explain whether the production command is safe to run.</p>
          </div>
          <strong data-ready={readyToPromote ? "true" : "false"}>
            {readyToPromote ? "Ready to promote" : "Not ready yet"}
          </strong>
        </header>
        <div className="release-panel__check-grid">
          {checks.map((check) => (
            <div className="release-panel__check" data-tone={check.tone} key={check.label}>
              <span>{check.label}</span>
              <strong>{check.value}</strong>
              <p>{check.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="release-panel__commands" aria-label="Release commands">
        <div>
          <h2>Preflight</h2>
          <pre>{PREFLIGHT_COMMAND}</pre>
        </div>
        <div>
          <h2>Production Promotion</h2>
          <pre>{productionCommandFor(status)}</pre>
        </div>
      </section>

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
