// Compact status indicator for the Phase 5a local mirror. Reuses the
// existing `.site-admin-pill` styling so it visually rhymes with the
// connection pill next to it. Tone is derived by site-health-model so the
// sync pill and release/health surfaces share one source of truth.
//
// Click toggles a popover with row count, watermark age, and an explicit
// "Refresh now" button (via triggerSync).

import { useCallback, useEffect, useRef, useState } from "react";

import { deriveSyncHealth, formatSyncAge } from "./site-health-model";
import type { UseLocalSyncResult } from "./use-local-sync";
import type { OutboxHookValue } from "./use-outbox";

export interface SyncStatusPillProps {
  sync: UseLocalSyncResult;
  /** Optional outbox hook value. When the outbox has pending writes
   * the pill shifts tone to "warning" and the popover gains a
   * queue-status row + "Retry now" affordance. Pass `null` to render
   * the legacy sync-only view (e.g. before the outbox hook has
   * mounted). */
  outbox?: OutboxHookValue | null;
}

export function SyncStatusPill({ sync, outbox = null }: SyncStatusPillProps) {
  const { lastSummary, status, error, busy, triggerSync } = sync;
  const outboxPending = outbox?.status.pending ?? 0;
  const outboxFailing = outbox?.status.failing ?? 0;
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

  // Outbox state takes priority over sync state — a queued write is a
  // "you might lose work if you close the app right now" condition,
  // worth flagging more loudly than a stale sync timestamp.
  const health = deriveSyncHealth(
    {
      busy,
      error,
      lastSyncAtMs: status?.last_sync_at_ms ?? null,
      rowCount: status?.row_count ?? null,
      summaryRowsApplied: lastSummary?.rows_applied ?? null,
    },
    outbox
      ? {
          draining: outbox.draining,
          failing: outboxFailing,
          pending: outboxPending,
        }
      : null,
  );

  return (
    <div className="site-admin-pill-root" ref={rootRef}>
      <button
        type="button"
        className="site-admin-pill"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-tone={health.tone}
        title={health.title}
      >
        <span className="site-admin-pill__dot" aria-hidden="true" />
        <span className="site-admin-pill__label">{health.label}</span>
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
          <dl className="site-admin-pill__meta">
            <dt>Rows cached</dt>
            <dd>{status?.row_count ?? "—"}</dd>
            <dt>Last sync</dt>
            <dd>
              {health.ageMs !== null ? formatSyncAge(health.ageMs) : "—"}
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
                <dd className="site-admin-pill__error">{error}</dd>
              </>
            ) : null}
            {outbox ? (
              <>
                <dt>Pending writes</dt>
                <dd>
                  {outboxPending}
                  {outboxFailing > 0 ? ` (${outboxFailing} failing)` : ""}
                </dd>
              </>
            ) : null}
          </dl>
          <div className="site-admin-pill__actions">
            <button
              type="button"
              className="site-admin-pill__action"
              onClick={() => {
                void triggerSync();
              }}
              disabled={busy}
            >
              {busy ? "Syncing…" : "Refresh now"}
            </button>
            {outbox && outboxPending > 0 ? (
              <button
                type="button"
                className="site-admin-pill__action"
                onClick={() => {
                  void outbox.drainNow();
                }}
                disabled={outbox.draining}
                title="Replay queued writes against the server"
              >
                {outbox.draining ? "Retrying…" : "Retry queue"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
