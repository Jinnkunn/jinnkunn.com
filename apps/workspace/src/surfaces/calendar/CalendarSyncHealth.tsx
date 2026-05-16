export type CalendarPublishState = "idle" | "publishing" | "success" | "error";

export type CalendarSyncHealth = {
  lastSyncedAt: string | null;
  eventCount: number;
  baseUrl: string;
  fileSha: string;
  reason: string | null;
  error: string | null;
};

export function CalendarSyncHealthPanel({
  health,
  state,
}: {
  health: CalendarSyncHealth;
  state: CalendarPublishState;
}) {
  if (!health.error && state !== "publishing") return null;
  const target = health.baseUrl || "https://staging.jinkunchen.com";
  const status =
    state === "publishing" ? "syncing" : health.error ? "error" : "ready";
  return (
    <div className="calendar-sync-health-panel" data-state={status}>
      <span>
        <strong className="text-text-primary">Status</strong>
        <br />
        {status}
      </span>
      <span>
        <strong className="text-text-primary">Target</strong>
        <br />
        {target.replace(/^https?:\/\//, "")}
      </span>
      <span>
        <strong className="text-text-primary">Events</strong>
        <br />
        {health.eventCount}
      </span>
      <span>
        <strong className="text-text-primary">Save SHA</strong>
        <br />
        {health.fileSha ? health.fileSha.slice(0, 8) : "pending"}
      </span>
    </div>
  );
}

export function CalendarSyncHealthPill({
  health,
  state,
}: {
  health: CalendarSyncHealth;
  state: CalendarPublishState;
}) {
  const last = health.lastSyncedAt
    ? new Date(health.lastSyncedAt).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : "not synced";
  const label =
    state === "publishing"
      ? "Syncing"
      : health.error
        ? "Sync error"
        : `Synced ${health.eventCount} · ${last}`;
  return (
    <a
      className="calendar-sync-link"
      href={`${health.baseUrl || "https://staging.jinkunchen.com"}/calendar`}
      target="_blank"
      rel="noreferrer"
      title={
        health.error
          ? health.error
          : `Target: ${health.baseUrl || "staging"} · SHA ${health.fileSha || "n/a"}`
      }
    >
      {label}
    </a>
  );
}
