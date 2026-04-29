import { useCallback, useEffect, useState } from "react";

import { useSiteAdmin } from "./state";

// "Promote to Production" — the workspace counterpart to running
// `npm run release:prod:from-staging`. Only renders when connected to
// staging; calls /api/site-admin/promote-to-production for both the
// read-only preflight (GET) and the dispatch (POST). The dispatch
// hands off to GitHub Actions, so the UI completes immediately and
// surfaces the run URL — clicking through opens the live workflow log.

interface EnvironmentSnapshot {
  workerName: string;
  versionId: string;
  deploymentId: string;
  codeSha: string;
  contentSha: string;
  contentBranch: string;
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
    }
  | {
      ok: false;
      code: string;
      detail: string;
    };

interface DispatchResult {
  runsListUrl: string;
  dispatchedAt: string;
}

const POLL_PREVIEW_MS = 60_000;

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

function parsePreview(raw: unknown): PromotePreview {
  const wrapper = asRecord(raw);
  const inner = asRecord(wrapper.preview);
  if (inner.ok === false) {
    return { ok: false, code: asString(inner.code) || "ERROR", detail: asString(inner.detail) };
  }
  if (inner.ok === true) {
    const staging = parseSnapshot(inner.staging);
    if (!staging) {
      return { ok: false, code: "INVALID_PREVIEW", detail: "preview missing staging snapshot" };
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
    };
  }
  return { ok: false, code: "INVALID_PREVIEW", detail: "preview envelope missing ok flag" };
}

function shortSha(value: string): string {
  return value.slice(0, 7);
}

const FRIENDLY_REASONS: Record<string, string> = {
  STAGING_BEHIND_MAIN: "Staging hasn't been re-released since the last commit on main. Run release:staging (or click Publish on this surface) first.",
  STAGING_NO_DEPLOYMENT: "Staging worker has no active deployment. Release staging before promoting.",
  STAGING_METADATA_UNREADABLE: "Staging deployment annotation has no code= SHA. Re-release staging via release-cloudflare so the metadata is set.",
  MISSING_GITHUB_APP: "GitHub App credentials are not configured on the staging worker. The promotion needs them to dispatch the release-production workflow.",
  MISSING_CLOUDFLARE_CREDENTIALS: "CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not configured on the staging worker.",
  MISSING_WORKER_NAMES: "Production / staging Worker names not configured.",
  MAIN_REF_UNREADABLE: "Could not read main HEAD via GitHub App. Check App permissions.",
  CLOUDFLARE_API_FAILED: "Cloudflare API request failed.",
  GITHUB_API_FAILED: "GitHub API request failed.",
};

export function PromoteToProductionButton() {
  const { connection, environment, request, setMessage } = useSiteAdmin();
  const [preview, setPreview] = useState<PromotePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DispatchResult | null>(null);

  const onlyOnStaging = environment.kind === "staging";
  const ready = onlyOnStaging && Boolean(connection.baseUrl) && Boolean(connection.authToken);

  const loadPreview = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    const response = await request("/api/site-admin/promote-to-production", "GET");
    setLoading(false);
    if (!response.ok) {
      setPreview({ ok: false, code: response.code || "ERROR", detail: response.error });
      return;
    }
    setPreview(parsePreview(response.data));
  }, [ready, request]);

  /* eslint-disable react-hooks/set-state-in-effect -- preview state syncs from the remote endpoint */
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void loadPreview();
    const id = window.setInterval(() => {
      if (!cancelled) void loadPreview();
    }, POLL_PREVIEW_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [ready, loadPreview]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Auto-cancel a stale "Confirm" state after 30s — same UX cushion the
  // PublishButton uses, so the user can't accidentally fire a half-stale
  // promotion if they walked away.
  useEffect(() => {
    if (!confirming) return;
    const t = window.setTimeout(() => setConfirming(false), 30000);
    return () => window.clearTimeout(t);
  }, [confirming]);

  if (!onlyOnStaging) return null;

  async function trigger() {
    if (!preview?.ok) {
      await loadPreview();
      setConfirming(true);
      return;
    }
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setBusy(true);
    const response = await request("/api/site-admin/promote-to-production", "POST", {});
    setBusy(false);
    if (!response.ok) {
      const friendly = FRIENDLY_REASONS[response.code] || response.error;
      setMessage("error", `Promote failed: ${friendly}`);
      // Re-pull the preview so the UI reflects whatever changed (e.g.
      // staging was just rebuilt or the GitHub App permissions slipped).
      await loadPreview();
      return;
    }
    const data = asRecord(response.data);
    const runsListUrl = asString(data.runsListUrl);
    const dispatchedAt = asString(data.dispatchedAt);
    setResult({ runsListUrl, dispatchedAt });
    setMessage(
      "success",
      "Production release dispatched. GitHub Actions is building, uploading, and verifying.",
    );
  }

  const ok = preview?.ok === true;
  const stagingMain = ok ? preview.stagingMatchesMain : false;
  const nothingToPromote = ok && !preview.productionDifferent;
  const blocked = !ok || !stagingMain || nothingToPromote;

  return (
    <div className="promote-prod">
      <button
        type="button"
        className={
          blocked || loading
            ? "btn btn--secondary"
            : confirming
              ? "btn btn--danger"
              : "btn btn--primary"
        }
        disabled={!ready || busy || loading}
        onClick={() => void trigger()}
        title={
          !ready
            ? "Connect to staging first."
            : loading
              ? "Reading deployment state…"
              : !ok
                ? `Not ready: ${preview?.detail ?? "unknown"}`
                : !stagingMain
                  ? "Staging is not on the same SHA as main. Release staging first."
                  : nothingToPromote
                    ? "Production already runs the same code SHA as staging."
                    : confirming
                      ? "Click again to confirm. Runs in GitHub Actions."
                      : "Dispatch the release-production workflow on GitHub Actions."
        }
      >
        {busy
          ? "Dispatching…"
          : loading
            ? "Checking…"
            : !ok
              ? "Promote (not ready)"
              : !stagingMain
                ? "Promote (staging stale)"
                : nothingToPromote
                  ? "No changes vs prod"
                  : confirming
                    ? "Confirm Promote"
                    : "Promote to Production"}
      </button>
      {(confirming || result) && (
        <details className="promote-prod__panel" role="status" open>
          <summary>
            {result
              ? "Production release dispatched"
              : ok && stagingMain
                ? "Confirm release-production dispatch"
                : "Promotion not ready"}
          </summary>
          <div className="promote-prod__body">
            {ok && (
              <div className="promote-prod__rows">
                <div>
                  <strong>main</strong>
                  <span>{shortSha(preview.mainSha)}</span>
                </div>
                <div>
                  <strong>staging</strong>
                  <span>
                    {shortSha(preview.stagingSha)} ·{" "}
                    {preview.staging.versionId.slice(0, 8)}
                  </span>
                </div>
                <div>
                  <strong>production (current)</strong>
                  <span>
                    {preview.production
                      ? `${shortSha(preview.production.codeSha)} · ${preview.production.versionId.slice(0, 8)}`
                      : "(no active deployment)"}
                  </span>
                </div>
              </div>
            )}
            {!ok && preview && (
              <p className="promote-prod__error">
                {FRIENDLY_REASONS[preview.code] ?? preview.detail}
              </p>
            )}
            {result && (
              <div className="promote-prod__result">
                <p>
                  Dispatched at{" "}
                  {result.dispatchedAt
                    ? new Date(result.dispatchedAt).toLocaleTimeString()
                    : "now"}
                  . The Action runs build → upload → deploy → smoke ping in
                  ~8–10 min.
                </p>
                <a
                  href={result.runsListUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn--primary"
                >
                  Open GitHub Actions run
                </a>
              </div>
            )}
            {!result && (
              <p className="promote-prod__hint">
                Promotion runs in GitHub Actions — the desktop editor stays
                usable. Use “Open GitHub Actions” on the result panel to
                follow progress.
              </p>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
