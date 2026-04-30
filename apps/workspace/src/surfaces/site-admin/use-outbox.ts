import { useCallback, useEffect, useRef, useState } from "react";

import {
  outboxDrain,
  outboxList,
  outboxRemove,
  outboxStatus,
  type OutboxEntry,
  type OutboxStatus,
} from "../../lib/tauri";

// Hook that owns the workspace's view of the local write outbox: a
// background drain timer, a window-focus drain, a status poll, and an
// on-demand list fetcher for the "what's queued" UI panel. Returns a
// stable surface; callers re-render when status changes (which is
// cheap — two scalar columns).
//
// The auto-drain runs every `DRAIN_INTERVAL_MS` while the window is
// focused. Tighter intervals would burn battery on a sleeping laptop
// for no benefit (the drain is a no-op when the queue is empty); a
// looser interval would feel sluggish when the user comes back from a
// 30s offline blip and expects their queued saves to flush quickly.
const DRAIN_INTERVAL_MS = 30_000;
// Status polling is cheap (two COUNTs); 5 s is fast enough for the
// SyncStatusPill badge to feel live while not waking the runtime
// every second.
const STATUS_POLL_INTERVAL_MS = 5_000;

const EMPTY_STATUS: OutboxStatus = {
  pending: 0,
  failing: 0,
  oldest_enqueued_at: null,
};

export interface OutboxAuth {
  bearer_token?: string;
  cf_access_client_id?: string;
  cf_access_client_secret?: string;
}

export interface OutboxHookValue {
  status: OutboxStatus;
  /** True when at least one network drain attempt is in flight; UI can
   * grey out the "retry now" affordance while we're already retrying. */
  draining: boolean;
  /** Last time we attempted a drain (unix ms). Lets the panel render
   * "Last attempt 12 s ago". */
  lastDrainAt: number | null;
  /** Manual drain — bound to the "Retry now" button on the queue
   * panel. Returns the same summary the Rust command produced so
   * callers can show "drained 3, 1 failed". */
  drainNow: () => Promise<void>;
  /** Lazy-loaded queue contents. The hook does NOT prefetch entries
   * because the typical queue is empty 99% of the time; only the
   * panel that renders entries should call `loadEntries`. */
  loadEntries: () => Promise<OutboxEntry[]>;
  /** Remove a stuck entry the operator decided to discard. */
  discardEntry: (id: number) => Promise<void>;
  /** Force a status refresh. Safe to call after enqueuing a write so
   * the badge bumps immediately rather than waiting for the next poll. */
  refreshStatus: () => Promise<void>;
}

export function useOutbox(auth: OutboxAuth | null): OutboxHookValue {
  const [status, setStatus] = useState<OutboxStatus>(EMPTY_STATUS);
  const [draining, setDraining] = useState(false);
  const [lastDrainAt, setLastDrainAt] = useState<number | null>(null);
  // Keep the latest auth in a ref so the drain timer doesn't need to
  // restart every time the bearer token rotates (which it can on
  // browser-login refresh). The timer reads the ref at fire time.
  const authRef = useRef<OutboxAuth | null>(auth);
  authRef.current = auth;
  // Single-flight guard — without this, a focus event that fires
  // alongside a timer tick would launch two parallel drains and double-
  // process the queue.
  const drainingRef = useRef(false);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await outboxStatus();
      setStatus(next);
    } catch {
      // outbox commands return Err(String) on local DB faults; log and
      // keep the previous status so the badge doesn't flicker.
    }
  }, []);

  const drainNow = useCallback(async () => {
    const currentAuth = authRef.current;
    if (!currentAuth || drainingRef.current) return;
    drainingRef.current = true;
    setDraining(true);
    try {
      const summary = await outboxDrain(currentAuth);
      setStatus({
        pending: summary.remaining,
        // We don't know per-row failing state without re-querying;
        // refreshStatus picks it up immediately after.
        failing: 0,
        oldest_enqueued_at: null,
      });
      setLastDrainAt(Date.now());
      await refreshStatus();
    } catch {
      // Network-layer drain errors are expected — they just mean
      // we're still offline. Don't surface as a status flip; just
      // try again next tick.
    } finally {
      drainingRef.current = false;
      setDraining(false);
    }
  }, [refreshStatus]);

  const loadEntries = useCallback(async (): Promise<OutboxEntry[]> => {
    try {
      return await outboxList();
    } catch {
      return [];
    }
  }, []);

  const discardEntry = useCallback(
    async (id: number) => {
      try {
        await outboxRemove(id);
      } catch {
        // ignore; a stale id just won't update
      }
      await refreshStatus();
    },
    [refreshStatus],
  );

  // Initial load + status polling.
  useEffect(() => {
    let cancelled = false;
    void refreshStatus();
    const handle = window.setInterval(() => {
      if (cancelled) return;
      void refreshStatus();
    }, STATUS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [refreshStatus]);

  // Background drain — runs every DRAIN_INTERVAL_MS while the document
  // is visible. Doesn't fire when the tab is backgrounded so a sleeping
  // laptop doesn't drain battery on no-op pulls.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void drainNow();
    };
    const handle = window.setInterval(tick, DRAIN_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [drainNow]);

  // Drain on focus — operator coming back to the app should see queued
  // writes flush within a second, not after the next 30 s tick.
  useEffect(() => {
    const onFocus = () => {
      void drainNow();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [drainNow]);

  return {
    status,
    draining,
    lastDrainAt,
    drainNow,
    loadEntries,
    discardEntry,
    refreshStatus,
  };
}
