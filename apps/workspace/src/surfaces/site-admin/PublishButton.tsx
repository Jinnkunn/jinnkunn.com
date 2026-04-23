import { useState } from "react";
import { useSiteAdmin } from "./state";
import { normalizeString } from "./utils";

/**
 * Triggers /api/site-admin/deploy. Deploy promotes the currently-uploaded
 * worker version — it does not rebuild from source. In the common workflow,
 * CI rebuilds after a content commit; this button lets you manually kick the
 * Cloudflare promotion step after those artifacts land.
 */
export function PublishButton({ label = "Publish" }: { label?: string }) {
  const { connection, request, setMessage } = useSiteAdmin();
  const [busy, setBusy] = useState(false);

  const ready = Boolean(connection.baseUrl) && Boolean(connection.authToken);

  async function trigger() {
    setBusy(true);
    const response = await request("/api/site-admin/deploy", "POST", {});
    setBusy(false);
    if (!response.ok) {
      setMessage("error", `Publish failed: ${response.code}: ${response.error}`);
      return;
    }
    const data = (response.data ?? {}) as Record<string, unknown>;
    const provider = normalizeString(data.provider);
    const deploymentId = normalizeString(data.deploymentId);
    const details = [
      provider ? `provider=${provider}` : "",
      deploymentId ? `deploymentId=${deploymentId}` : "",
    ]
      .filter(Boolean)
      .join(", ");
    setMessage(
      "success",
      details
        ? `Deploy triggered (${details}).`
        : "Deploy triggered.",
    );
  }

  return (
    <button
      className="btn btn--primary"
      type="button"
      onClick={() => void trigger()}
      disabled={!ready || busy}
      title="Promote the current worker version via Cloudflare API"
    >
      {busy ? "Publishing…" : label}
    </button>
  );
}
