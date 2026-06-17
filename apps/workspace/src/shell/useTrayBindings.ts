import { useEffect, useState } from "react";

import { runUpdateCheckSafely } from "../lib/updater";
import { outboxStatus as fetchOutboxStatus, type OutboxStatus } from "../modules/site-admin/tauri";
import type { SidebarRecentItem } from "./recent";
import { useTrayMenuSync } from "./useTrayMenuSync";
import type { ReleaseState, TodayDigest } from "./trayMenu";

const SYNC_PAUSED_STORAGE_KEY = "workspace.calendarSyncPaused.v1";

const EMPTY_OUTBOX: OutboxStatus = {
  pending: 0,
  failing: 0,
  oldest_enqueued_at: null,
};

const EMPTY_DIGEST: TodayDigest = {
  nextEvent: null,
  todayEventCount: 0,
};

const IDLE_RELEASE: ReleaseState = { kind: "idle" };

/** Custom DOM event the site-admin promote button dispatches when its
 * deploy lifecycle changes state. The detail mirrors `ReleaseState`. */
export const RELEASE_STATE_EVENT = "workspace:release-state";
/** Tray "Retry now" → drainNow handshake. SiteAdminTopBar listens. */
export const OUTBOX_RETRY_EVENT = "workspace:outbox:retry";
/** Legacy event kept so retired todo source files still typecheck while
 * the slim workbench leaves the Todos module unregistered. */
export const QUICK_CAPTURE_TODO_EVENT = "workspace:quick-capture:todo";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function readBoolFromStorage(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeBoolToStorage(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // ignore quota / private-mode errors; the toggle just resets next launch
  }
}

interface TrayBindingsArgs {
  enabledSurfaceIds: ReadonlySet<string>;
  recentItems: readonly SidebarRecentItem[];
  /** Surface picker handler — used by recent-item rows to navigate. */
  onSelectSurface: (surfaceId: string) => void;
  /** Nav-item picker — used to deep-link recents into a specific note /
   * project / etc. */
  onSelectNavItem: (surfaceId: string, navItemId: string) => void;
}

export interface TrayBindingsResult {
  /** Whether the user has paused calendar background sync from the
   * tray. App.tsx should AND this with `enabledSurfaceIds.has("calendar")`
   * when computing the `enabled` prop on `<CalendarBackgroundSync>`. */
  syncPaused: boolean;
}

/** One hook that owns every tray-side concern: state aggregation, IPC
 * push, and action handler routing. App.tsx mounts it with a small set
 * of handler callbacks; the hook reads / writes its own slice of state
 * for tray-only concerns (sync pause, autostart toggle, deploy state,
 * outbox status, today digest).
 *
 * No-op outside Tauri — the hook checks `__TAURI_INTERNALS__` before
 * registering listeners or invoking IPC, so the preview build doesn't
 * fault. */
export function useTrayBindings(args: TrayBindingsArgs): TrayBindingsResult {
  const { enabledSurfaceIds, recentItems, onSelectSurface, onSelectNavItem } = args;

  const [syncPaused, setSyncPaused] = useState<boolean>(() =>
    readBoolFromStorage(SYNC_PAUSED_STORAGE_KEY),
  );
  const [windowVisible, setWindowVisible] = useState<boolean>(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );
  const [releaseState, setReleaseState] = useState<ReleaseState>(IDLE_RELEASE);
  const [outboxStatus, setOutboxStatus] = useState<OutboxStatus>(EMPTY_OUTBOX);
  const [autostartEnabled, setAutostartEnabled] = useState<boolean | null>(null);
  const [todayDigest, setTodayDigest] = useState<TodayDigest>(EMPTY_DIGEST);

  // ── Persist sync-paused locally so the toggle survives restart. ──
  useEffect(() => {
    writeBoolToStorage(SYNC_PAUSED_STORAGE_KEY, syncPaused);
  }, [syncPaused]);

  // ── Track window visibility for the Open/Hide toggle label. ──────
  useEffect(() => {
    const onChange = () => setWindowVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  // ── Subscribe to deploy lifecycle events from Release Center. ──────
  useEffect(() => {
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<ReleaseState>).detail;
      if (!detail) return;
      setReleaseState(detail);
    };
    window.addEventListener(RELEASE_STATE_EVENT, onState);
    return () => window.removeEventListener(RELEASE_STATE_EVENT, onState);
  }, []);

  // ── Poll outbox status from the local DB. Same 5 s cadence as the
  //    site-admin top bar so the tray badge agrees with the in-app pill.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const pull = async () => {
      try {
        const next = await fetchOutboxStatus();
        if (!cancelled) setOutboxStatus(next);
      } catch {
        // local DB hiccup; keep prior value
      }
    };
    void pull();
    const handle = window.setInterval(() => void pull(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, []);

  // ── Read autostart state once at mount, refresh after each toggle.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void (async () => {
      try {
        const mod = await import("@tauri-apps/plugin-autostart");
        const enabled = await mod.isEnabled();
        if (!cancelled) setAutostartEnabled(enabled);
      } catch {
        if (!cancelled) setAutostartEnabled(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Today digest: next calendar event (EventKit, when permission is
  //    granted). One pull every 60 s — the tray-only consumer doesn't
  //    need higher fidelity, and the EventKit `calendar://changed`
  //    channel still drives the main UI's freshness.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;

    interface CalendarEventRow {
      title: string;
      startsAt: string;
      isAllDay?: boolean;
    }

    const pullCalendar = async (): Promise<{
      nextEvent: TodayDigest["nextEvent"];
      eventCount: number;
    }> => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const auth = await invoke<string>("calendar_authorization_status").catch(
          () => "denied",
        );
        if (auth !== "fullAccess" && auth !== "writeOnly") {
          return { nextEvent: null, eventCount: 0 };
        }
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(startOfDay);
        endOfDay.setHours(23, 59, 59, 999);
        const events = await invoke<CalendarEventRow[]>("calendar_fetch_events", {
          request: {
            startsAt: startOfDay.toISOString(),
            endsAt: endOfDay.toISOString(),
          },
        });
        const nowMs = Date.now();
        // Future timed events only — all-day events would clutter the
        // "Next:" line because their start time is midnight.
        const upcoming = events
          .filter((event) => !event.isAllDay)
          .map((event) => ({
            title: event.title || "(untitled)",
            startMs: new Date(event.startsAt).getTime(),
          }))
          .filter((event) => event.startMs > nowMs)
          .sort((a, b) => a.startMs - b.startMs);
        return {
          nextEvent: upcoming[0] ?? null,
          eventCount: events.length,
        };
      } catch {
        return { nextEvent: null, eventCount: 0 };
      }
    };

    const pull = async () => {
      const cal = await pullCalendar();
      if (cancelled) return;
      setTodayDigest({
        todayEventCount: cal.eventCount,
        nextEvent: cal.nextEvent,
      });
    };

    void pull();
    const handle = window.setInterval(() => void pull(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, []);

  // ── Action handlers for tray:* IDs broadcast as `workspace:menu`. ─
  useEffect(() => {
    if (!isTauri()) return;
    const onMenu = async (event: Event) => {
      const detail = (event as CustomEvent<{ id: string }>).detail;
      const id = detail?.id;
      if (!id || !id.startsWith("tray:")) return;

      switch (id) {
        case "tray:check-updates":
          void runUpdateCheckSafely({
            promptBeforeDownload: false,
            notifyOnUpToDate: true,
          });
          return;
        case "tray:pause-sync":
          setSyncPaused(true);
          return;
        case "tray:resume-sync":
          setSyncPaused(false);
          return;
        case "tray:outbox-retry":
          window.dispatchEvent(new CustomEvent(OUTBOX_RETRY_EVENT));
          return;
        case "tray:open-deploy":
          // Site-admin → release panel. The release nav item id is the
          // surface's release nav id; the surface knows how to deep-link.
          onSelectSurface("site-admin");
          return;
        case "tray:toggle-autostart":
          try {
            const mod = await import("@tauri-apps/plugin-autostart");
            if (autostartEnabled) {
              await mod.disable();
              setAutostartEnabled(false);
            } else {
              await mod.enable();
              setAutostartEnabled(true);
            }
          } catch {
            // Failing toggle leaves the prior state intact.
          }
          return;
        default:
          break;
      }

      // Recent-item deep links: tray:open-recent::<surfaceId>::<itemId>
      if (id.startsWith("tray:open-recent::")) {
        const rest = id.slice("tray:open-recent::".length);
        const sep = rest.indexOf("::");
        if (sep < 0) return;
        const surfaceId = rest.slice(0, sep);
        const itemId = rest.slice(sep + 2);
        onSelectSurface(surfaceId);
        // Schedule the nav-item selection after surface activation has
        // committed; selectSurface synchronously sets active surface,
        // and onSelectNavItem expects the surface to already match.
        window.setTimeout(() => onSelectNavItem(surfaceId, itemId), 0);
      }
    };
    window.addEventListener("workspace:menu", onMenu as EventListener);
    return () => window.removeEventListener("workspace:menu", onMenu as EventListener);
  }, [autostartEnabled, onSelectNavItem, onSelectSurface]);

  // ── Push the aggregated state to Rust. ───────────────────────────
  useTrayMenuSync({
    windowVisible,
    syncPaused,
    outboxStatus,
    releaseState,
    todayDigest,
    autostartEnabled,
    recentItems,
    enabledSurfaceIds,
  });

  return { syncPaused };
}

/** Convenience helper components elsewhere can call to broadcast a
 * deploy-state change without taking a direct tray dependency. Used by
 * Release Center. */
export function dispatchReleaseState(state: ReleaseState): void {
  window.dispatchEvent(new CustomEvent(RELEASE_STATE_EVENT, { detail: state }));
}
