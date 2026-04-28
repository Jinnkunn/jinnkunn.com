// Drives the Phase 5a local mirror: kicks off a sync_pull on mount when
// credentials are available, then again on a fixed interval. Exposes the
// last sync summary + an explicit `triggerSync` for "Refresh now" UX.
//
// Designed to be used at one stable point in the React tree
// (SiteAdminSurface) so we have one timer + one in-flight pull at a
// time. Call sites that need the current local row count read it via
// `useLocalSyncStatus` (cheap COUNT query) instead of the summary
// returned here.

import { useCallback, useEffect, useRef, useState } from "react";

import {
  localContent,
  type LocalSyncCredentials,
  type LocalSyncOptions,
  type LocalSyncStatus,
  type SyncPullSummary,
} from "./local-content";

const DEFAULT_INTERVAL_MS = 30_000;

export interface UseLocalSyncResult {
  /** Most recent successful summary, or null until the first pull lands. */
  lastSummary: SyncPullSummary | null;
  /** Most recent local-DB status (row count + watermarks). Refreshes
   * after every successful sync. */
  status: LocalSyncStatus | null;
  /** Last error message from a failed sync. Cleared on the next success. */
  error: string | null;
  /** True while a sync is in flight (so callers can disable a manual
   * "Refresh" button). */
  busy: boolean;
  /** Force a sync now (e.g. user clicked Refresh). Resolves to the
   * summary or null if credentials weren't ready. */
  triggerSync: (options?: LocalSyncOptions) => Promise<SyncPullSummary | null>;
}

export function useLocalSync(
  credentials: LocalSyncCredentials | null,
  options: { intervalMs?: number; enabled?: boolean } = {},
): UseLocalSyncResult {
  const enabled = options.enabled !== false;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const [lastSummary, setLastSummary] = useState<SyncPullSummary | null>(null);
  const [status, setStatus] = useState<LocalSyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Pin the latest credentials in a ref so the interval handler can read
  // them without forcing a re-subscribe every time `connection` re-renders
  // (which would tear down + re-arm the timer constantly).
  const credentialsRef = useRef<LocalSyncCredentials | null>(credentials);
  useEffect(() => {
    credentialsRef.current = credentials;
  }, [credentials]);

  // Single in-flight guard so a slow pull doesn't compete with the next
  // interval tick. The interval ALWAYS clears so a stuck network call
  // doesn't permanently lock us out — it just gets superseded next round.
  const inFlightRef = useRef(false);

  const runSync = useCallback(
    async (opts?: LocalSyncOptions): Promise<SyncPullSummary | null> => {
      const creds = credentialsRef.current;
      if (!creds || !creds.baseUrl || !creds.authToken) return null;
      if (inFlightRef.current) return null;
      inFlightRef.current = true;
      setBusy(true);
      try {
        const summary = await localContent.syncPull(creds, opts);
        setLastSummary(summary);
        setError(null);
        try {
          const next = await localContent.status();
          setStatus(next);
        } catch {
          // status read is decorative; don't escalate to a "sync failed"
          // banner just because the COUNT(*) probe glitched.
        }
        return summary;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        return null;
      } finally {
        inFlightRef.current = false;
        setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    if (!credentials || !credentials.baseUrl || !credentials.authToken) return;
    // Kick off an immediate pull so the user doesn't sit through one
    // interval tick before the local mirror primes. Then arm the timer.
    void runSync();
    const id = window.setInterval(() => {
      void runSync();
    }, intervalMs);
    return () => {
      window.clearInterval(id);
    };
    // We deliberately depend on baseUrl + authToken (not the credentials
    // object identity) so swapping refs to the same credentials doesn't
    // tear down the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    intervalMs,
    credentials?.baseUrl,
    credentials?.authToken,
    credentials?.cfAccessClientId,
    credentials?.cfAccessClientSecret,
    runSync,
  ]);

  return {
    lastSummary,
    status,
    error,
    busy,
    triggerSync: runSync,
  };
}
