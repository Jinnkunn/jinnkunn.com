import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

import { computeTrayMenu, type TrayMenuInputs, type TrayMenuPayload } from "./trayMenu";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function payloadEqual(a: TrayMenuPayload, b: TrayMenuPayload): boolean {
  // Stringify is fine — payloads are small (<2KB) and the diff catches
  // every nested-children change without manual recursion.
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Push a fresh tray menu to Rust whenever the inputs change.
 *
 * The hook computes a payload from `inputs`, diffs against the last
 * pushed value, and only invokes `tray_set_menu` when it actually
 * changes. The "next event" ticker re-evaluates the payload every
 * 60 s so the "in 12m" countdown stays current without burning CPU.
 *
 * No-op outside Tauri (preview / vitest builds), so the hook is safe
 * to mount unconditionally from the shell. */
export function useTrayMenuSync(inputs: TrayMenuInputs): void {
  const lastPayloadRef = useRef<TrayMenuPayload | null>(null);

  useEffect(() => {
    if (!isTauri()) return;

    const push = () => {
      const next = computeTrayMenu(inputs);
      if (lastPayloadRef.current && payloadEqual(lastPayloadRef.current, next)) {
        return;
      }
      lastPayloadRef.current = next;
      void invoke("tray_set_menu", { payload: next }).catch(() => {
        // tray_set_menu errors when the tray hasn't registered yet
        // (boot race). Reset the cache so the next change attempts a
        // fresh push instead of being skipped by the diff.
        lastPayloadRef.current = null;
      });
    };

    push();

    // Re-push every minute so the "Next: Standup · 10:30 (in 12m)"
    // countdown rolls forward. Skip when there's no next event so we
    // don't burn an IPC every 60 s for nothing.
    if (!inputs.todayDigest.nextEvent) return;
    const handle = window.setInterval(push, 60_000);
    return () => window.clearInterval(handle);
  }, [inputs]);
}
