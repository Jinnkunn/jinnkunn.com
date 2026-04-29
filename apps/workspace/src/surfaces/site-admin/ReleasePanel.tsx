import { useCallback, useEffect, useMemo, useState } from "react";

import { SiteAdminEnvironmentBanner } from "./SiteAdminEnvironmentBanner";
import { PromoteToProductionButton } from "./PromoteToProductionButton";
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
const RELEASE_SNAPSHOTS_KEY = "workspace.site-admin.releaseSnapshots.v1";

type ReleaseTone = "ok" | "warn" | "blocked" | "muted";
type ReleaseEnvironment = "staging" | "production";

type ReleaseSnapshot = {
  capturedAt: string;
  status: StatusPayload;
};

type ReleaseSnapshots = Partial<Record<ReleaseEnvironment, ReleaseSnapshot>>;

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

function loadReleaseSnapshots(): ReleaseSnapshots {
  try {
    const raw = localStorage.getItem(RELEASE_SNAPSHOTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ReleaseSnapshots;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveReleaseSnapshot(
  env: ReleaseEnvironment,
  status: StatusPayload,
): ReleaseSnapshots {
  const next = {
    ...loadReleaseSnapshots(),
    [env]: { capturedAt: new Date().toISOString(), status },
  };
  try {
    localStorage.setItem(RELEASE_SNAPSHOTS_KEY, JSON.stringify(next));
  } catch {
    // Ignore private-mode/quota errors. The live current profile status still renders.
  }
  return next;
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

function activeVersion(status: StatusPayload | null | undefined): string {
  return normalizeString(status?.deployments?.active?.versionId);
}

function sourceCode(status: StatusPayload | null | undefined): string {
  return normalizeString(status?.source?.codeSha);
}

function sourceContent(status: StatusPayload | null | undefined): string {
  return normalizeString(status?.source?.contentSha);
}

function sameRevision(
  staging: StatusPayload | null | undefined,
  production: StatusPayload | null | undefined,
): boolean {
  const stagingCode = sourceCode(staging);
  const productionCode = sourceCode(production);
  const stagingContent = sourceContent(staging);
  const productionContent = sourceContent(production);
  return Boolean(
    stagingCode &&
      productionCode &&
      stagingContent &&
      productionContent &&
      stagingCode === productionCode &&
      stagingContent === productionContent,
  );
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
  const [snapshots, setSnapshots] = useState<ReleaseSnapshots>(() =>
    loadReleaseSnapshots(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const stagingProfile = useMemo(
    () =>
      profiles.find(
        (profile) => getSiteAdminEnvironment(profile.baseUrl).kind === "staging",
      ) ?? null,
    [profiles],
  );
  const productionProfile = useMemo(
    () =>
      profiles.find(
        (profile) => getSiteAdminEnvironment(profile.baseUrl).kind === "production",
      ) ?? null,
    [profiles],
  );
  const isStaging = environment.kind === "staging";
  const currentReleaseEnv: ReleaseEnvironment | null =
    environment.kind === "staging" || environment.kind === "production"
      ? environment.kind
      : null;
  const stagingStatus =
    currentReleaseEnv === "staging" ? status : snapshots.staging?.status ?? null;
  const productionStatus =
    currentReleaseEnv === "production" ? status : snapshots.production?.status ?? null;
  const activeDeploymentLabel =
    environment.kind === "production" ? "Active production" : "Active staging";
  const checks = releaseChecks(status, isStaging);
  const productionAlreadyCurrent = sameRevision(stagingStatus, productionStatus);
  const readyToPromote =
    isStaging &&
    status?.source?.deployableVersionReady === true &&
    status.source.pendingDeploy !== true &&
    !productionAlreadyCurrent;

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
      if (currentReleaseEnv) {
        setSnapshots(saveReleaseSnapshot(currentReleaseEnv, normalized));
      }
      if (!options.silent) setMessage("success", "Release status loaded.");
    },
    [currentReleaseEnv, request, setMessage],
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
            className="btn btn--secondary"
            type="button"
            onClick={() =>
              void copyText("production promotion command", productionCommandFor(status))
            }
          >
            Copy Command
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

      <section className="release-panel__env-grid" aria-label="Environment comparison">
        <EnvironmentCard
          capturedAt={snapshots.staging?.capturedAt}
          current={currentReleaseEnv === "staging"}
          label="Staging"
          onSwitch={stagingProfile ? () => switchProfile(stagingProfile.id) : undefined}
          status={stagingStatus}
        />
        <EnvironmentCard
          capturedAt={snapshots.production?.capturedAt}
          current={currentReleaseEnv === "production"}
          label="Production"
          onSwitch={
            productionProfile ? () => switchProfile(productionProfile.id) : undefined
          }
          status={productionStatus}
        />
        <div
          className="release-panel__comparison"
          data-tone={
            !stagingStatus || !productionStatus
              ? "muted"
              : productionAlreadyCurrent
                ? "ok"
                : "warn"
          }
        >
          <span>Comparison</span>
          <strong>
            {!stagingStatus || !productionStatus
              ? "Load both profiles"
              : productionAlreadyCurrent
                ? "Production current"
                : "Production differs"}
          </strong>
          <p>
            Visit both Staging and Production profiles once to cache comparable
            release snapshots. Production promotion remains command-driven.
          </p>
        </div>
      </section>

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

      <section className="release-panel__promote" aria-label="Production promotion action">
        <div>
          <h2>Production Promotion</h2>
          <p>
            Dispatches the guarded release-production workflow from the validated
            staging candidate. Production remains read-only everywhere else in
            Workspace.
          </p>
        </div>
        <PromoteToProductionButton />
      </section>

      <details className="release-panel__commands" aria-label="Release commands">
        <summary>Advanced command fallback</summary>
        <div className="release-panel__commands-grid">
          <div>
            <h2>Preflight</h2>
            <pre>{PREFLIGHT_COMMAND}</pre>
          </div>
          <div>
            <h2>Production Promotion</h2>
            <pre>{productionCommandFor(status)}</pre>
          </div>
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

function EnvironmentCard({
  capturedAt,
  current,
  label,
  onSwitch,
  status,
}: {
  capturedAt?: string;
  current: boolean;
  label: string;
  onSwitch?: () => void;
  status: StatusPayload | null;
}) {
  return (
    <div className="release-panel__env-card" data-current={current ? "true" : "false"}>
      <header>
        <div>
          <span>{label}</span>
          <strong>{status ? shortId(activeVersion(status)) : "Not loaded"}</strong>
        </div>
        {!current && onSwitch ? (
          <button className="btn btn--secondary" type="button" onClick={onSwitch}>
            Switch
          </button>
        ) : null}
      </header>
      <dl>
        <div>
          <dt>Code</dt>
          <dd>{shortSha(sourceCode(status))}</dd>
        </div>
        <div>
          <dt>Content</dt>
          <dd>{shortSha(sourceContent(status))}</dd>
        </div>
        <div>
          <dt>Candidate</dt>
          <dd>{candidateLabel(status?.source)}</dd>
        </div>
      </dl>
      <p>
        {current
          ? "Live from current profile."
          : capturedAt
            ? `Cached ${new Date(capturedAt).toLocaleString()}.`
            : "Switch to this profile to capture a snapshot."}
      </p>
    </div>
  );
}
