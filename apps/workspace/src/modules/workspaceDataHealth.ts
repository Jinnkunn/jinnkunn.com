export type WorkspaceDataSource =
  | "cloud"
  | "local"
  | "macos"
  | "mixed"
  | "remote";

export type WorkspaceDataHealthState =
  | "empty"
  | "error"
  | "idle"
  | "loading"
  | "ready"
  | "stale"
  | "syncing";

export interface WorkspaceDataHealth {
  error: unknown;
  source: WorkspaceDataSource;
  state: WorkspaceDataHealthState;
  summary: string;
  updatedAt: number | null;
}

export interface WorkspaceDataHealthInput {
  error?: unknown;
  hasData: boolean;
  hasLoaded: boolean;
  loading: boolean;
  source?: WorkspaceDataSource;
  summary?: string;
  updatedAt?: number | null;
}

export function deriveWorkspaceDataHealth({
  error = null,
  hasData,
  hasLoaded,
  loading,
  source = "local",
  summary = "",
  updatedAt = null,
}: WorkspaceDataHealthInput): WorkspaceDataHealth {
  const state: WorkspaceDataHealthState = (() => {
    if (error && hasData) return "stale";
    if (error) return "error";
    if (loading && hasData) return "syncing";
    if (loading) return "loading";
    if (hasData) return "ready";
    if (hasLoaded) return "empty";
    return "idle";
  })();

  return {
    error,
    source,
    state,
    summary,
    updatedAt,
  };
}

export function workspaceDataHealthTone(
  state: WorkspaceDataHealthState,
): "error" | "muted" | "success" | "warn" {
  if (state === "error") return "error";
  if (state === "stale") return "warn";
  if (state === "ready") return "success";
  return "muted";
}

export function workspaceDataHealthLabel(health: WorkspaceDataHealth): string {
  if (health.state === "loading") return "Loading";
  if (health.state === "syncing") return "Syncing";
  if (health.state === "stale") return "Stale";
  if (health.state === "error") return "Failed";
  if (health.state === "empty") return "Empty";
  if (health.state === "ready") return "Up to date";
  return "Idle";
}
