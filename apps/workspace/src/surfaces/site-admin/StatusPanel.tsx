import { useCallback, useEffect, useRef, useState } from "react";
import { useSiteAdmin } from "./state";
import type { StatusPayload } from "./types";
import { formatPendingDeploy, normalizeString, serializeJson } from "./utils";

// Status payload must have `source`, `env`, and `build` to be considered
// valid. The server always returns the full shape on success.
function normalizeStatus(data: unknown): StatusPayload | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (!obj.source || !obj.env || !obj.build) return null;
  return obj as unknown as StatusPayload;
}

// Treat a token as "needs renewal" when fewer than 5 minutes remain.
// Wider than just `< 0` so the deploy precheck also catches the case
// where the token expires mid-deploy.
function tokenNeedsRenewal(iso: string): boolean {
  if (!iso) return false;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return false;
  return ms < 5 * 60 * 1000;
}

export function StatusPanel() {
  const { connection, request, setMessage, signInWithBrowser } = useSiteAdmin();
  const [data, setData] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [confirmDeploy, setConfirmDeploy] = useState(false);
  const [checkingDeploy, setCheckingDeploy] = useState(false);
  const [error, setError] = useState("");
  const deployCheckTimerRef = useRef<number | null>(null);

  const refresh = useCallback(
    async (options: { silent?: boolean } = {}) => {
      setLoading(true);
      setError("");
      const response = await request("/api/site-admin/status", "GET");
      setLoading(false);
      if (!response.ok) {
        const msg = `${response.code}: ${response.error}`;
        setError(msg);
        if (!options.silent) {
          setMessage("error", `Load status failed: ${msg}`);
        }
        return false;
      }
      const normalized = normalizeStatus(response.data);
      if (!normalized) {
        setError("Invalid status payload");
        if (!options.silent) {
          setMessage("error", "Load status failed: invalid payload");
        }
        return false;
      }
      setData(normalized);
      if (!options.silent) setMessage("success", "Status loaded.");
      return true;
    },
    [request, setMessage],
  );

  const deploy = useCallback(async () => {
    if (!confirmDeploy) {
      // Precheck: deploy is the most expensive POST in the app and runs
      // without further confirmation once started. If our locally-known
      // token expiry is past or imminent, renew up-front so the actual
      // deploy POST doesn't trigger a mid-flight browser sign-in. (The
      // global `request` wrapper would also auto-retry on 401, but for
      // this one button we'd rather front-load the auth dance.)
      if (!connection.authToken || tokenNeedsRenewal(connection.authExpiresAt)) {
        const newToken = await signInWithBrowser();
        if (!newToken) return;
      }
      setConfirmDeploy(true);
      return;
    }
    setConfirmDeploy(false);
    setDeploying(true);
    const response = await request("/api/site-admin/deploy", "POST", {});
    setDeploying(false);
    if (!response.ok) {
      setMessage("error", `Deploy failed: ${response.code}: ${response.error}`);
      return;
    }
    const d = (response.data ?? {}) as Record<string, unknown>;
    const provider = normalizeString(d.provider);
    const deploymentId = normalizeString(d.deploymentId);
    const details = [
      provider ? `provider=${provider}` : "",
      deploymentId ? `deploymentId=${deploymentId}` : "",
    ]
      .filter(Boolean)
      .join(", ");
    setMessage(
      "success",
      details
        ? `Deploy triggered (${details}). Refresh status to verify convergence.`
        : "Deploy triggered. Refresh status to verify convergence.",
    );
    if (deployCheckTimerRef.current !== null) {
      window.clearTimeout(deployCheckTimerRef.current);
    }
    setCheckingDeploy(true);
    deployCheckTimerRef.current = window.setTimeout(() => {
      void refresh({ silent: true }).finally(() => {
        setCheckingDeploy(false);
        deployCheckTimerRef.current = null;
      });
    }, 2500);
  }, [
    confirmDeploy,
    connection.authToken,
    connection.authExpiresAt,
    refresh,
    request,
    setMessage,
    signInWithBrowser,
  ]);

  useEffect(() => {
    if (!confirmDeploy) return;
    const timer = window.setTimeout(() => setConfirmDeploy(false), 6000);
    return () => window.clearTimeout(timer);
  }, [confirmDeploy]);

  useEffect(() => {
    return () => {
      if (deployCheckTimerRef.current !== null) {
        window.clearTimeout(deployCheckTimerRef.current);
      }
    };
  }, []);

  const disableDeploy =
    loading ||
    deploying ||
    !connection.baseUrl ||
    !connection.authToken ||
    data?.source?.deployableVersionReady === false;

  const notes: string[] = [];
  if (loading) notes.push("Loading status…");
  if (deploying) notes.push("Triggering deploy…");
  if (checkingDeploy) notes.push("Checking deploy status…");
  if (error) notes.push(error);
  if (!notes.length && data?.source?.pendingDeploy === true) {
    notes.push(
      "Source has changes ahead of active deployment. Run Deploy when ready.",
    );
  }
  if (data?.source?.deployableVersionReady === false) {
    notes.push(
      `${
        data.source.deployableVersionReason ||
        "Latest uploaded Worker version does not match the current content."
      } Wait for GitHub Actions “Deploy (auto)” to finish, or run npm run release:staging, then refresh.`,
    );
  }

  return (
    <section className="surface-card">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]">
            Status
          </h1>
          <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">
            Runtime provider, source store, and deploy readiness snapshot.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            className="btn btn--secondary"
            type="button"
            onClick={() => void refresh()}
            disabled={loading || deploying}
          >
            Refresh
          </button>
          <button
            className={confirmDeploy ? "btn btn--danger" : "btn btn--secondary"}
            type="button"
            onClick={() => void deploy()}
            disabled={disableDeploy}
          >
            {deploying ? "Deploying…" : confirmDeploy ? "Confirm Deploy" : "Deploy"}
          </button>
        </div>
      </header>

      <dl className="key-values">
        <div>
          <dt>Runtime Provider</dt>
          <dd>{data?.env?.runtimeProvider || "-"}</dd>
        </div>
        <div>
          <dt>Source Store</dt>
          <dd>{data?.source?.storeKind || "-"}</dd>
        </div>
        <div>
          <dt>Source Branch</dt>
          <dd>{data?.source?.branch || "-"}</dd>
        </div>
        <div>
          <dt>Source Head</dt>
          <dd>{data?.source?.headSha || "-"}</dd>
        </div>
        <div>
          <dt>Code SHA</dt>
          <dd>{data?.source?.codeSha || "-"}</dd>
        </div>
        <div>
          <dt>Content SHA</dt>
          <dd>{data?.source?.contentSha || "-"}</dd>
        </div>
        <div>
          <dt>Deployable Version</dt>
          <dd>
            {data?.source?.deployableVersionReady === true
              ? "Ready"
              : data?.source?.deployableVersionReady === false
                ? "Stale"
                : "-"}
          </dd>
        </div>
        <div>
          <dt>Pending Deploy</dt>
          <dd>{data?.source ? formatPendingDeploy(data.source) : "-"}</dd>
        </div>
        <div>
          <dt>Deploy Target Ready</dt>
          <dd>{data?.env?.hasDeployTarget ? "Yes" : "No"}</dd>
        </div>
      </dl>

      {notes.length > 0 && (
        <p className="m-0 text-[12px] text-text-muted">{notes.join(" ")}</p>
      )}

      <details className="surface-details">
        <summary>Raw Status Payload</summary>
        <pre className="debug-pane">{data ? serializeJson(data) : ""}</pre>
      </details>
    </section>
  );
}
