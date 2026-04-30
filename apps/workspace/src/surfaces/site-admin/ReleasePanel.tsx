import { useCallback, useEffect, useMemo, useState } from "react";

import { SiteAdminEnvironmentBanner } from "./SiteAdminEnvironmentBanner";
import { PromoteToProductionButton } from "./PromoteToProductionButton";
import {
  candidateLabel,
  branchLabel,
  LEGACY_RELEASE_PROD_COMMAND,
  RELEASE_PROD_FROM_STAGING_COMMAND,
  RELEASE_PROD_FROM_STAGING_DRY_RUN_COMMAND,
  shortId,
  shortSha,
  normalizeStatusPayload,
} from "./release-flow-model";
import { useSiteAdmin } from "./state";
import type { StatusPayload } from "./types";
import { getSiteAdminEnvironment, normalizeString } from "./utils";

const PRODUCTION_RUNBOOK_PATH = "docs/runbooks/production-promotion.md";
const PREFLIGHT_COMMAND = [
  "git switch main",
  "git pull --ff-only",
  "git status --short",
  RELEASE_PROD_FROM_STAGING_DRY_RUN_COMMAND,
  "npm run verify:staging:authenticated",
  "npm run check:staging-visual",
].join("\n");

type ReleaseTone = "ok" | "warn" | "blocked" | "muted";

type ReleaseCheck = {
  detail: string;
  label: string;
  tone: ReleaseTone;
  value: string;
};

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
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
    lines.push(`# main: ${shortSha(preview.mainSha)}`);
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
): ReleaseCheck[] {
  const source = status?.source;
  const candidateReady = source?.deployableVersionReady;
  const pendingDeploy = source?.pendingDeploy;
  const codeSha = normalizeString(source?.codeSha);
  const contentSha = normalizeString(source?.contentSha);
  const contentBranch = branchLabel(source);
  const previewReady = preview?.ok === true;
  const productionDifferent = previewReady ? preview.productionDifferent : false;
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
      detail:
        previewReady && preview.stagingMatchesMain
          ? "Staging active deployment matches main."
          : previewReady
            ? "Staging is behind main; release staging before promoting."
            : "Promotion preflight could not read both environments yet.",
      label: "Main preflight",
      tone: previewReady && preview.stagingMatchesMain ? "ok" : "blocked",
      value: previewReady && preview.stagingMatchesMain ? "Matched" : "Needs staging",
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
    {
      detail: previewReady
        ? productionDifferent
          ? "Production differs from the validated staging candidate."
          : "Production already runs the same active deployment revision."
        : preview?.detail || "Load promotion preflight from Staging.",
      label: "Production delta",
      tone: previewReady ? (productionDifferent ? "warn" : "ok") : "muted",
      value: previewReady ? (productionDifferent ? "Differs" : "Current") : "Unknown",
    },
    {
      // Content delta is a leading indicator: even when code SHAs match
      // (productionDifferent=false), a staging D1 row that's been edited
      // since the last production deploy will land on production at the
      // next promote. Surfacing a count here means the operator clicks
      // Promote knowing exactly how many files will move, which is the
      // 2026-04-29 calendar-nav incident's preventable surprise.
      detail: !previewReady
        ? "Load promotion preflight from Staging."
        : preview.contentDelta.error
          ? `Could not compute content delta: ${preview.contentDelta.error}`
          : preview.contentDelta.changedRows === 0
            ? "Staging D1 has not changed since production was deployed."
            : `${preview.contentDelta.changedRows} content file${preview.contentDelta.changedRows === 1 ? "" : "s"} edited since production deploy. The next promote will overwrite production's bundled snapshot with these.`,
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

export function ReleasePanel() {
  const {
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
  const checks = releaseChecks(status, isStaging, preview);
  const productionAlreadyCurrent = preview?.ok === true && !preview.productionDifferent;
  const readyToPromote =
    isStaging &&
    status?.source?.deployableVersionReady === true &&
    status.source.pendingDeploy !== true &&
    preview?.ok === true &&
    preview.stagingMatchesMain &&
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
              void copyText(
                "production promotion command",
                productionCommandFor(status, preview),
              )
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
          current={isStaging}
          label="Staging"
          note={
            preview?.ok
              ? preview.stagingMatchesMain
                ? "Live staging deployment matches main."
                : "Live staging deployment is behind main."
              : isStaging
                ? preview?.detail || "Loading live staging deployment."
                : "Switch to Staging to load live promotion state."
          }
          snapshot={preview?.ok ? preview.staging : null}
        />
        <EnvironmentCard
          current={false}
          label="Production"
          note={
            preview?.ok
              ? preview.production
                ? "Live production deployment from Cloudflare."
                : "Production has no active deployment metadata."
              : "Read from Staging promotion preflight; no profile switch required."
          }
          snapshot={preview?.ok ? preview.production : null}
        />
        <div
          className="release-panel__comparison"
          data-tone={
            preview?.ok
              ? productionAlreadyCurrent
                ? "ok"
                : "warn"
              : "muted"
          }
        >
          <span>Comparison</span>
          <strong>
            {preview?.ok
              ? productionAlreadyCurrent
                ? "Production current"
                : "Production differs"
              : "Load staging preflight"}
          </strong>
          <p>
            Release preflight reads staging and production deployments live from
            Cloudflare. Production promotion remains explicit.
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
        {preview?.ok === true &&
        !preview.contentDelta.error &&
        preview.contentDelta.files.length > 0 ? (
          <details
            className="release-panel__content-delta"
            aria-label="Files that will land on production"
          >
            <summary>
              <span>What will land on production</span>
              <strong>
                {preview.contentDelta.changedRows} file
                {preview.contentDelta.changedRows === 1 ? "" : "s"}
              </strong>
            </summary>
            <ul>
              {preview.contentDelta.files.map((file) => (
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
              {preview.contentDelta.truncated ? (
                <li className="release-panel__content-delta-more">
                  + {preview.contentDelta.changedRows -
                    preview.contentDelta.files.length}{" "}
                  more
                </li>
              ) : null}
            </ul>
          </details>
        ) : null}
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
            <pre>{productionCommandFor(status, preview)}</pre>
          </div>
          <div>
            <h2>Legacy Guarded Fallback</h2>
            <pre>{LEGACY_RELEASE_PROD_COMMAND}</pre>
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
  current,
  label,
  note,
  snapshot,
}: {
  current: boolean;
  label: string;
  note: string;
  snapshot: EnvironmentSnapshot | null;
}) {
  return (
    <div className="release-panel__env-card" data-current={current ? "true" : "false"}>
      <header>
        <div>
          <span>{label}</span>
          <strong>{snapshot ? shortId(snapshot.versionId) : "Not loaded"}</strong>
        </div>
      </header>
      <dl>
        <div>
          <dt>Code</dt>
          <dd>{shortSha(snapshot?.codeSha)}</dd>
        </div>
        <div>
          <dt>Content</dt>
          <dd>{shortSha(snapshot?.contentSha)}</dd>
        </div>
        <div>
          <dt>Branch</dt>
          <dd>{snapshot?.contentBranch || "-"}</dd>
        </div>
      </dl>
      <p>{note}</p>
    </div>
  );
}
