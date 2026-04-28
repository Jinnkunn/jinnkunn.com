// Compact status indicator for the Phase 5a local mirror. Reuses the
// existing `.site-admin-pill` styling so it visually rhymes with the
// connection pill next to it. Tone:
//   - "neutral" before any sync has happened
//   - "success" after a successful pull
//   - "danger"  after a failed pull (lastError present)
//   - "warning" when busy=true (in-flight)
//
// Click toggles a popover with row count, watermark age, and an explicit
// "Refresh now" button (via triggerSync).

import { useCallback, useEffect, useRef, useState } from "react";

import type { UseLocalSyncResult } from "./use-local-sync";

function formatAge(ms: number): string {
  if (ms < 5_000) return "just now";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3_600_000)}h ago`;
}

function nowMs(): number {
  return Date.now();
}

export interface SyncStatusPillProps {
  sync: UseLocalSyncResult;
}

export function SyncStatusPill({ sync }: SyncStatusPillProps) {
  const { lastSummary, status, error, busy, triggerSync } = sync;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Cheap re-render every 15s so "X seconds ago" stays roughly current
  // without needing a global tick. Re-render is local (just this pill).
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);

  // Click-outside to close, mirroring the connection pill's behavior.
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const toggle = useCallback(() => setOpen((o) => !o), []);

  const tone = busy
    ? "warning"
    : error
      ? "danger"
      : lastSummary
        ? "success"
        : "neutral";

  const ageMs = status?.last_sync_at_ms ? nowMs() - status.last_sync_at_ms : null;
  const label = busy
    ? "Syncing…"
    : error
      ? "Sync error"
      : status && status.last_sync_at_ms > 0
        ? `Synced ${ageMs !== null ? formatAge(ageMs) : ""}`.trim()
        : "Not synced";

  const title = busy
    ? "Pulling latest changes from D1"
    : error
      ? `Sync failed: ${error}`
      : status
        ? `${status.row_count} row(s) cached locally`
        : "Local mirror not yet primed";

  return (
    <div className="site-admin-pill-root" ref={rootRef}>
      <button
        type="button"
        className="site-admin-pill"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-tone={tone}
        title={title}
      >
        <span className="site-admin-pill__dot" aria-hidden="true" />
        <span className="site-admin-pill__label">{label}</span>
      </button>

      {open ? (
        <div
          className="site-admin-pill__popover"
          role="dialog"
          aria-label="Local sync status"
        >
          <header className="site-admin-pill__popover-header">
            <strong>Local mirror</strong>
          </header>
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "4px 12px",
              margin: "8px 0",
              fontSize: "12px",
            }}
          >
            <dt>Rows cached</dt>
            <dd>{status?.row_count ?? "—"}</dd>
            <dt>Last sync</dt>
            <dd>
              {ageMs !== null ? formatAge(ageMs) : "—"}
              {status?.last_sync_at_ms
                ? ` (${new Date(status.last_sync_at_ms).toLocaleTimeString()})`
                : ""}
            </dd>
            <dt>Watermark</dt>
            <dd>
              {status?.last_sync_since
                ? new Date(status.last_sync_since).toISOString()
                : "—"}
            </dd>
            {lastSummary ? (
              <>
                <dt>Last batch</dt>
                <dd>
                  {lastSummary.rows_applied} row(s) in {lastSummary.iterations} pull(s)
                </dd>
              </>
            ) : null}
            {error ? (
              <>
                <dt>Error</dt>
                <dd style={{ color: "var(--site-admin-danger, #b91c1c)" }}>{error}</dd>
              </>
            ) : null}
          </dl>
          <button
            type="button"
            onClick={() => {
              void triggerSync();
            }}
            disabled={busy}
            style={{ width: "100%", padding: "6px 10px" }}
          >
            {busy ? "Syncing…" : "Refresh now"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
