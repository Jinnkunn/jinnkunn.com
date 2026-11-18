export const VERSIONED_OVERLAY_TAG = "overlay=versioned";
export const STATIC_POLICY_PATH = "/__static/protected-routes-policy.json";

export function versionedOverlay(message: unknown) {
  return String(message || "").split(/\s+/).includes(VERSIONED_OVERLAY_TAG);
}

export function workerOverlayKey(env: unknown) {
  const bindings = env as { STATIC_SHELL_OVERLAY?: string; SITE_WORKER_VERSION?: { id?: string } } | undefined;
  return bindings?.STATIC_SHELL_OVERLAY === "1" ? String(bindings.SITE_WORKER_VERSION?.id || "") : "";
}

// The validated version identifier is interpolated so callers can keep their
// own positional parameters for JSON paths, asset paths and search queries.
export function activeOverlayTable(workerVersionId = "") {
  if (!workerVersionId) return "static_shell_overlays";
  if (!/^[a-z0-9-]{1,80}$/i.test(workerVersionId)) throw new Error("Invalid Worker version identity.");
  return `(SELECT v.* FROM static_shell_overlay_versions v
    JOIN static_shell_overlay_active a ON a.snapshot_id = v.snapshot_id
    WHERE a.worker_version_id = '${workerVersionId}')`;
}
