import { deriveReleaseFlow, type ReleaseFlowState } from "./release-flow-model";
import type { StatusPayload } from "./types";

export type HealthTone = "neutral" | "success" | "warning" | "danger";

export interface SyncHealthInput {
  busy: boolean;
  error: string | null;
  lastSyncAtMs: number | null;
  rowCount: number | null;
  summaryRowsApplied?: number | null;
}

export interface OutboxHealthInput {
  draining: boolean;
  failing: number;
  pending: number;
}

export interface SyncHealthState {
  ageMs: number | null;
  label: string;
  title: string;
  tone: HealthTone;
}

export interface SiteHealthState {
  blockingReasons: string[];
  releaseFlow: ReleaseFlowState;
  sync: SyncHealthState;
  warnings: string[];
}

export function formatSyncAge(ms: number): string {
  if (ms < 5_000) return "just now";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3_600_000)}h ago`;
}

export function deriveSyncHealth(
  sync: SyncHealthInput,
  outbox: OutboxHealthInput | null,
  nowMs = Date.now(),
): SyncHealthState {
  const pending = outbox?.pending ?? 0;
  const failing = outbox?.failing ?? 0;
  const ageMs = sync.lastSyncAtMs && sync.lastSyncAtMs > 0
    ? nowMs - sync.lastSyncAtMs
    : null;

  const tone: HealthTone = failing > 0
    ? "danger"
    : pending > 0
      ? "warning"
      : sync.busy
        ? "warning"
        : sync.error
          ? "danger"
          : sync.lastSyncAtMs
            ? "success"
            : "neutral";

  const label = pending > 0
    ? `${pending} pending write${pending === 1 ? "" : "s"}`
    : sync.busy
      ? "Syncing…"
      : sync.error
        ? "Sync error"
        : ageMs !== null
          ? `Synced ${formatSyncAge(ageMs)}`
          : "Not synced";

  const title = pending > 0
    ? failing > 0
      ? `${failing} write(s) failing on the server; click for details`
      : `${pending} write(s) queued for retry; click for details`
    : sync.busy
      ? "Pulling latest changes from D1"
      : sync.error
        ? `Sync failed: ${sync.error}`
        : sync.rowCount !== null
          ? `${sync.rowCount} row(s) cached locally`
          : "Local mirror not yet primed";

  return { ageMs, label, title, tone };
}

export function deriveSiteHealth({
  contentDirty,
  outbox,
  productionReadOnly,
  status,
  sync,
}: {
  contentDirty: boolean;
  outbox: OutboxHealthInput | null;
  productionReadOnly: boolean;
  status: StatusPayload | null;
  sync: SyncHealthInput;
}): SiteHealthState {
  const releaseFlow = deriveReleaseFlow(status, {
    productionReadOnly,
  });
  const syncHealth = deriveSyncHealth(sync, outbox);
  const blockingReasons: string[] = [];
  const warnings: string[] = [];

  if (releaseFlow.disablePublish) {
    blockingReasons.push(releaseFlow.disabledReason);
  }
  if (contentDirty) warnings.push("Current editor has unsaved content changes");
  if (outbox && outbox.pending > 0) {
    warnings.push(`${outbox.pending} local write${outbox.pending === 1 ? "" : "s"} pending sync`);
  }
  if (sync.error) warnings.push(`Local sync error: ${sync.error}`);

  return { blockingReasons, releaseFlow, sync: syncHealth, warnings };
}
