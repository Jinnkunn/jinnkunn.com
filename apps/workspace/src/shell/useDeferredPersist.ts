import { useEffect, useRef } from "react";

type IdleCapableWindow = Window & {
  cancelIdleCallback?: (id: number) => void;
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout?: number },
  ) => number;
};

/** Persist `value` via `write` after the current render commit, off
 * the critical path. The write is scheduled via `requestIdleCallback`
 * (with a `setTimeout(0)` fallback) so it never blocks paint, and
 * rapid successive changes cancel the pending callback so only the
 * latest value lands in storage.
 *
 * The `write` callback does not need to be stable — this hook keeps a
 * ref to the latest reference, so callers can pass an inline arrow
 * function without `useCallback` churn.
 *
 * Trade-off: if the window is closed within the ~1 s idle window
 * after a state change, that single update may not be flushed. Worth
 * it because every prior change *was* persisted, and the alternative
 * (synchronous `localStorage.setItem` in a render-phase effect) costs
 * a few microseconds per state mutation across six independent slices
 * — small, but adds up across drag-reorder / typing scenarios. */
export function useDeferredPersist<T>(
  value: T,
  write: (value: T) => void,
): void {
  const writeRef = useRef(write);
  useEffect(() => {
    writeRef.current = write;
  });

  useEffect(() => {
    const win = window as IdleCapableWindow;
    if (typeof win.requestIdleCallback === "function") {
      const id = win.requestIdleCallback(() => writeRef.current(value), {
        timeout: 1_000,
      });
      return () => win.cancelIdleCallback?.(id);
    }
    const handle = window.setTimeout(() => writeRef.current(value), 0);
    return () => window.clearTimeout(handle);
  }, [value]);
}
