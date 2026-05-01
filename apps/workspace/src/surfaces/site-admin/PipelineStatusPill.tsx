import { useCallback, useEffect, useRef, useState } from "react";

import { useSurfaceNav } from "../../shell/surface-nav-context";
import { parseStatusPayload } from "./publish-flow-model";
import { shortSha } from "./release-flow-model";
import { useSiteAdmin } from "./state";
import type { StatusPayload } from "./types";

type StageTone = "ok" | "pending" | "blocked" | "muted";

interface StageView {
  short: string;
  title: string;
  tone: StageTone;
}

interface PipelineStatusPillProps {
  contentDirty: boolean;
  pendingOutbox: number;
}

function deriveSource(
  status: StatusPayload | null,
  contentDirty: boolean,
  pendingOutbox: number,
): StageView {
  if (!status?.source) {
    return { tone: "muted", short: "—", title: "Source: status unavailable" };
  }
  const totalDirty = (contentDirty ? 1 : 0) + Math.max(0, pendingOutbox);
  if (totalDirty > 0) {
    return {
      tone: "pending",
      short: String(totalDirty),
      title: `Source has ${totalDirty} unsaved change${totalDirty === 1 ? "" : "s"} not yet published.`,
    };
  }
  const sha = shortSha(status.source.contentSha || status.source.headSha);
  return {
    tone: "ok",
    short: "✓",
    title: sha ? `Source synced at ${sha}` : "Source synced",
  };
}

function deriveStaging(status: StatusPayload | null): StageView {
  const source = status?.source;
  if (!source) {
    return { tone: "muted", short: "—", title: "Staging: status unavailable" };
  }
  if (source.pendingDeploy === true) {
    return {
      tone: "pending",
      short: "↑",
      title: source.pendingDeployReason || "Staging deploy is pending.",
    };
  }
  if (source.deployableVersionReady === false) {
    return {
      tone: "blocked",
      short: "!",
      title:
        source.deployableVersionReason ||
        "Staging candidate is stale — rebuild before publishing.",
    };
  }
  if (source.deployableVersionReady === true) {
    const sha = shortSha(source.codeSha);
    return {
      tone: "ok",
      short: "✓",
      title: sha
        ? `Staging deployed (code ${sha})`
        : "Staging deployed and ready",
    };
  }
  return { tone: "muted", short: "—", title: "Staging: state unknown" };
}

function deriveProduction(status: StatusPayload | null): StageView {
  // Production state isn't carried in /api/site-admin/status — promotion is a
  // manual runbook step. The pill surfaces the manual-promotion contract so
  // operators don't expect a live "in sync / behind" indicator here.
  if (!status?.source) {
    return { tone: "muted", short: "—", title: "Production: status unavailable" };
  }
  return {
    tone: "muted",
    short: "·",
    title: "Production promotion is manual — open the Release panel for the runbook.",
  };
}

const REFRESH_ON_MOUNT_DELAY_MS = 250;

/**
 * Compact 3-stage publish pipeline indicator that lives in the topbar:
 *   [● Src 3 → ● Stg ✓ → · Prd]
 *
 * Click the strip to jump to the Status panel where {@link PublishPipelineCard}
 * already renders the full pipeline detail. The pill itself stays read-only —
 * actual publish/promotion controls live on the existing Publish button and
 * Release panel.
 */
export function PipelineStatusPill({
  contentDirty,
  pendingOutbox,
}: PipelineStatusPillProps) {
  const { connection, productionReadOnly, request } = useSiteAdmin();
  const { setActiveNavItemId } = useSurfaceNav();
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef(false);

  const ready =
    Boolean(connection.baseUrl) && Boolean(connection.authToken) && !productionReadOnly;

  const refresh = useCallback(async () => {
    if (!ready || inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const response = await request("/api/site-admin/status", "GET");
      if (response.ok) {
        setStatus(parseStatusPayload(response.data));
      }
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [ready, request]);

  // Initial fetch — short timeout so the topbar mounts before the network
  // request fires; avoids a layout shift on cold sign-in.
  useEffect(() => {
    if (!ready) {
      setStatus(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void refresh();
    }, REFRESH_ON_MOUNT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [ready, refresh]);

  // Re-fetch on window focus and when other code mutates the source store
  // (e.g. PublishButton fires this after a deploy, ConfigPanel after save).
  useEffect(() => {
    if (!ready) return;
    const onFocus = () => void refresh();
    const onSourceMutated = () => void refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener("site-admin:source-mutated", onSourceMutated);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("site-admin:source-mutated", onSourceMutated);
    };
  }, [ready, refresh]);

  if (!ready) return null;

  const source = deriveSource(status, contentDirty, pendingOutbox);
  const staging = deriveStaging(status);
  const production = deriveProduction(status);

  const summaryTitle = `Source: ${source.title}\nStaging: ${staging.title}\nProduction: ${production.title}`;

  const goToStatus = () => setActiveNavItemId("status");

  return (
    <button
      type="button"
      className="pipeline-pill"
      onClick={goToStatus}
      aria-label="Open Status panel"
      title={summaryTitle}
      data-loading={loading || undefined}
    >
      <PipelineStage label="Src" view={source} />
      <span className="pipeline-pill__sep" aria-hidden="true">
        →
      </span>
      <PipelineStage label="Stg" view={staging} />
      <span className="pipeline-pill__sep" aria-hidden="true">
        →
      </span>
      <PipelineStage label="Prd" view={production} />
    </button>
  );
}

function PipelineStage({ label, view }: { label: string; view: StageView }) {
  return (
    <span className="pipeline-pill__stage" data-tone={view.tone}>
      <span className="pipeline-pill__dot" aria-hidden="true" />
      <span className="pipeline-pill__label">{label}</span>
      <span className="pipeline-pill__short">{view.short}</span>
    </span>
  );
}
