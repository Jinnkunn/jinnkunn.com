import { useEffect, useRef } from "react";

import type { WorkspaceEventInput } from "../../shell/workspaceEvents";
import {
  calendarAuthorizationStatus,
  onCalendarChanged,
} from "./api";
import {
  syncCurrentEventKitCalendarProjection,
  type CalendarSyncReason,
} from "./publicSync";
import type { CalendarAuthorizationStatus } from "./types";

const INITIAL_SYNC_DELAY_MS = 12_000;
const CHANGE_DEBOUNCE_MS = 30_000;
const PERIODIC_SYNC_MS = 30 * 60_000;

type IdleCapableWindow = Window & {
  cancelIdleCallback?: (id: number) => void;
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout?: number },
  ) => number;
};

function canReadCalendar(status: CalendarAuthorizationStatus): boolean {
  return status === "fullAccess" || status === "writeOnly";
}

function isTauriUnavailable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /window\.__TAURI__|window\.__TAURI_INTERNALS__|Cannot read properties of undefined \(reading 'invoke'\)|undefined is not an object/i.test(
    message,
  );
}

export function CalendarBackgroundSync({
  enabled,
  onWorkspaceEvent,
}: {
  enabled: boolean;
  onWorkspaceEvent: (input: WorkspaceEventInput) => void;
}) {
  const onWorkspaceEventRef = useRef(onWorkspaceEvent);

  useEffect(() => {
    onWorkspaceEventRef.current = onWorkspaceEvent;
  }, [onWorkspaceEvent]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let timer: number | null = null;
    let idleTimer: number | null = null;
    let periodicTimer: number | null = null;
    let unlistenVisibility: (() => void) | null = null;
    let unlisten: (() => void) | null = null;
    let running = false;
    let queued = false;

    const clearSyncTimer = () => {
      if (timer === null) return;
      window.clearTimeout(timer);
      timer = null;
    };
    const clearIdleTimer = () => {
      if (idleTimer === null) return;
      (window as IdleCapableWindow).cancelIdleCallback?.(idleTimer);
      idleTimer = null;
    };
    const clearVisibilityWait = () => {
      unlistenVisibility?.();
      unlistenVisibility = null;
    };

    const emit = (input: WorkspaceEventInput) => {
      if (!active) return;
      onWorkspaceEventRef.current(input);
    };

    const runSync = async (reason: CalendarSyncReason) => {
      if (running) {
        queued = true;
        return;
      }
      running = true;
      try {
        const status = await calendarAuthorizationStatus();
        if (!canReadCalendar(status)) return;
        const result = await syncCurrentEventKitCalendarProjection({
          reason,
          skipIfUnchanged: true,
        });
        if (!active) return;
        if (!result.ok) {
          emit({
            source: "Calendar",
            title: "Calendar sync failed",
            detail: result.error,
            tone: "warn",
          });
          return;
        }
        if (result.status === "synced") {
          emit({
            source: "Calendar",
            title: "Synced public calendar",
            detail: `${result.eventCount} events synced to staging`,
            tone: "success",
          });
          if (result.production?.ok) {
            emit({
              source: "Calendar",
              title: "Production release dispatched",
              detail: "Calendar changes are moving from staging to production",
              tone: "success",
            });
          } else if (result.production && !result.production.ok) {
            emit({
              source: "Calendar",
              title: "Production promote failed",
              detail: result.production.error,
              tone: "warn",
            });
          }
        }
      } catch (err) {
        if (!active || isTauriUnavailable(err)) return;
        emit({
          source: "Calendar",
          title: "Calendar sync failed",
          detail: String(err),
          tone: "warn",
        });
      } finally {
        running = false;
        if (queued && active) {
          queued = false;
          scheduleSync(CHANGE_DEBOUNCE_MS, "background");
        }
      }
    };

    const scheduleSync = (delayMs: number, reason: CalendarSyncReason) => {
      clearSyncTimer();
      clearIdleTimer();
      clearVisibilityWait();
      timer = window.setTimeout(() => {
        timer = null;
        const runWhenIdle = () => {
          if (!active) return;
          const requestIdle = (window as IdleCapableWindow).requestIdleCallback;
          if (!requestIdle) {
            void runSync(reason);
            return;
          }
          idleTimer = requestIdle(
            () => {
              idleTimer = null;
              void runSync(reason);
            },
            { timeout: 5_000 },
          );
        };
        if (document.visibilityState === "hidden") {
          const onVisible = () => {
            if (document.visibilityState === "hidden") return;
            clearVisibilityWait();
            runWhenIdle();
          };
          document.addEventListener("visibilitychange", onVisible);
          unlistenVisibility = () =>
            document.removeEventListener("visibilitychange", onVisible);
          return;
        }
        runWhenIdle();
      }, delayMs);
    };

    scheduleSync(INITIAL_SYNC_DELAY_MS, "background");
    periodicTimer = window.setInterval(() => {
      scheduleSync(0, "background");
    }, PERIODIC_SYNC_MS);

    void onCalendarChanged(() => {
      scheduleSync(CHANGE_DEBOUNCE_MS, "background");
    })
      .then((fn) => {
        if (!active) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
      clearSyncTimer();
      clearIdleTimer();
      clearVisibilityWait();
      if (periodicTimer !== null) window.clearInterval(periodicTimer);
      unlisten?.();
    };
  }, [enabled]);

  return null;
}
