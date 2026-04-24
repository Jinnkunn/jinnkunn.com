import { useCallback, useState } from "react";
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

export function StatusPanel() {
  const { connection, request, setMessage } = useSiteAdmin();
  const [data, setData] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState("");

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
    await refresh({ silent: true });
  }, [refresh, request, setMessage]);

  const disableDeploy =
    loading ||
    deploying ||
    !connection.baseUrl ||
    !connection.authToken;

  const notes: string[] = [];
  if (loading) notes.push("Loading status…");
  if (deploying) notes.push("Triggering deploy…");
  if (error) notes.push(error);
  if (!notes.length && data?.source?.pendingDeploy === true) {
    notes.push(
      "Source has changes ahead of active deployment. Run Deploy when ready.",
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
            className="btn btn--danger"
            type="button"
            onClick={() => void deploy()}
            disabled={disableDeploy}
          >
            Deploy
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
