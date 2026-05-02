import { useCallback, useEffect, useRef, useState } from "react";

import { openExternalUrl } from "../../lib/tauri";
import { notify } from "../../lib/notify";
import {
  siteAdminRunReleaseCommand,
  type SiteAdminReleaseCommandResult,
} from "../../modules/site-admin/tauri";
import { RELEASE_PROD_FROM_STAGING_SCRIPT } from "./release-flow-model";
import { useSiteAdmin } from "./state";

// "Promote to Production" — the workspace counterpart to running
// `npm run release:prod:from-staging`. Only renders when connected to
// staging. The primary path runs the local Cloudflare release script on
// this Mac; GitHub Actions remains a clearly marked fallback link.

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
  MISSING_GITHUB_APP: "GitHub App credentials are not configured on the staging worker, so remote preflight/fallback state is unavailable. Prefer the local production command.",
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
  const [result, setResult] = useState<SiteAdminReleaseCommandResult | null>(null);
  // Watch state — set when a local release succeeds, cleared when production
  // catches up (success notification fired) or after a hard timeout
  // (failure notification fired). Persisted across re-renders via
  // useState so the watcher effect re-fires correctly.
  const [watchTarget, setWatchTarget] = useState<{
    stagingSha: string;
    previousProductionSha: string | null;
    startedAtMs: number;
  } | null>(null);
  // Single-shot guard — without this the watcher would fire a
  // notification every poll interval after the deploy lands.
  const watchFiredRef = useRef(false);

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

  // Deploy-completion watcher. After a successful local release we set
  // watchTarget; this effect polls the preview endpoint until the
  // production codeSha matches the promoted stagingSha, then fires a
  // native "Production deploy complete" notification. Bails after 20
  // minutes with a "deploy timed out" failure notification — long
  // enough for a normal CI run, short enough that a stuck workflow
  // doesn't leave the watcher polling overnight.
  useEffect(() => {
    if (!watchTarget) return;
    watchFiredRef.current = false;
    const TIMEOUT_MS = 20 * 60 * 1000;
    const POLL_MS = 30_000;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || watchFiredRef.current) return;
      const elapsed = Date.now() - watchTarget.startedAtMs;
      // Read fresh preview state. Don't rely on the existing `preview`
      // variable — its identity changes on every state update and
      // would re-arm this effect on each tick, which is wasteful.
      const response = await request("/api/site-admin/promote-to-production", "GET");
      if (cancelled || watchFiredRef.current) return;
      if (response.ok) {
        const next = parsePreview(response.data);
        if (next.ok && next.production) {
          const live = next.production.codeSha.toLowerCase();
          const target = watchTarget.stagingSha.toLowerCase();
          if (live === target) {
            watchFiredRef.current = true;
            void notify({
              title: "Production deploy complete",
              body: `${target.slice(0, 7)} is live on jinkunchen.com.`,
            });
            setWatchTarget(null);
            return;
          }
        }
      }
      if (elapsed >= TIMEOUT_MS) {
        watchFiredRef.current = true;
        void notify({
          title: "Production deploy still pending",
          body: "Polled for 20 minutes without seeing the new SHA on production. Recheck Cloudflare or use the GitHub fallback if needed.",
        });
        setWatchTarget(null);
      }
    };
    const id = window.setInterval(() => {
      void tick();
    }, POLL_MS);
    // Fire one tick right away so a fast deploy doesn't wait the full
    // 30 s before reporting completion.
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [watchTarget, request]);

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
    try {
      const data = await siteAdminRunReleaseCommand(RELEASE_PROD_FROM_STAGING_SCRIPT);
      setResult(data);
    } catch (error) {
      setBusy(false);
      setMessage("error", `Promote failed locally: ${String(error)}`);
      await loadPreview();
      return;
    }
    setBusy(false);
    setMessage(
      "success",
      "Local production release completed. Rechecking production status.",
    );
    void notify({
      title: "Production release completed locally",
      body: "Cloudflare deploy finished from this Mac. Workspace is checking that production caught up.",
    });
    // Snapshot the SHA we expect production to land on so the watcher
    // can compare future preview pulls against a stable target. Without
    // this we'd race against `preview` changing as the watcher loops.
    setWatchTarget({
      stagingSha: preview.stagingSha,
      previousProductionSha: asString(asRecord(asRecord(preview).production).codeSha) || null,
      startedAtMs: Date.now(),
    });
  }

  const ok = preview?.ok === true;
  const stagingMain = ok ? preview.stagingMatchesMain : false;
  const nothingToPromote = ok && !preview.productionDifferent;
  const blocked = !ok || !stagingMain || nothingToPromote;
  const fallbackRunsListUrl = ok ? preview.runsListUrl : "";

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
                      ? "Click again to run the local Cloudflare production release."
                      : "Run npm run release:prod:from-staging locally on this Mac."
        }
      >
        {busy
          ? "Promoting…"
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
              ? "Production release completed"
              : ok && stagingMain
                ? "Confirm local production release"
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
                  Ran <code>{result.command}</code> from <code>{result.cwd}</code>{" "}
                  in {Math.round(result.duration_ms / 1000)}s.
                </p>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => {
                    if (!fallbackRunsListUrl) return;
                    void openExternalUrl(fallbackRunsListUrl).catch((error) => {
                      setMessage(
                        "warn",
                        `Could not open GitHub fallback: ${String(error)}. URL: ${fallbackRunsListUrl}`,
                      );
                    });
                  }}
                  disabled={!fallbackRunsListUrl}
                >
                  Open GitHub fallback
                </button>
              </div>
            )}
            {!result && (
              <p className="promote-prod__hint">
                Primary path runs the local Cloudflare release command on this
                Mac. Use GitHub Actions only as a fallback if the local release
                cannot run.
              </p>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
