import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";

/** Native AppKit popup item. The id flows back to the JS side via the
 * existing `workspace:menu` CustomEvent (see `useNativeMenu`), so each
 * id should be globally unique within an app session. Convention is
 * `ctx:<surface>:<itemId>:<action>` — keeps menubar (`menu-*`) and
 * popup ids cleanly partitioned. */
export interface ContextMenuItemSpec {
  id: string;
  label: string;
  /** Optional disable flag — disabled items render dimmed and can't be
   * picked. */
  enabled?: boolean;
}

/** Render a horizontal separator. Convention: id `"-"` or label `"-"`. */
export const CONTEXT_MENU_SEPARATOR = { id: "-", label: "-" } as const;
type ContextMenuSeparator = typeof CONTEXT_MENU_SEPARATOR;

const TAURI_BRIDGE_KEY = "__TAURI_INTERNALS__";

function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    (window as unknown as Record<string, unknown>)[TAURI_BRIDGE_KEY],
  );
}

/** Pop up a native AppKit context menu at the cursor. Returns
 * immediately — selection flows back through the
 * `workspace:menu` CustomEvent that `useNativeMenu` re-broadcasts. The
 * caller is responsible for listening for that event with the matching
 * item ids. No-op outside Tauri (preview build, regular browser). */
export async function showContextMenu(
  items: readonly ContextMenuItemSpec[],
): Promise<void> {
  if (!isTauri()) return;
  if (items.length === 0) return;
  try {
    await invoke("show_context_menu", { items });
  } catch (err) {
    // The popup can fail if a menu item id collides with an existing
    // menubar id — log so dev catches it, but don't throw because the
    // caller's `onContextMenu` handler is just a UX polish.
    console.warn("[contextMenu] show_context_menu failed", err);
  }
}

/** Subscribe to popup selections matching one of the given ids. The
 * handler fires once per matching `workspace:menu` event. Returns a
 * cleanup fn — call it when the row unmounts. */
export function useContextMenuSubscription(
  ids: readonly string[],
  onPick: (id: string) => void,
): void {
  const idSet = useRef<Set<string>>(new Set(ids));
  idSet.current = new Set(ids);
  const handlerRef = useRef(onPick);
  handlerRef.current = onPick;

  useEffect(() => {
    function onMenu(event: Event) {
      const id = (event as CustomEvent<{ id: string }>).detail?.id;
      if (!id) return;
      if (!idSet.current.has(id)) return;
      handlerRef.current(id);
    }
    window.addEventListener("workspace:menu", onMenu);
    return () => window.removeEventListener("workspace:menu", onMenu);
  }, []);
}

let popupNonceCounter = 0;
const POPUP_DISMISS_TIMEOUT_MS = 30_000;

/** Build + show a popup with per-call action handlers. Each action is
 * routed through a nonce so multiple popups don't collide and the
 * caller doesn't have to track ids manually. The listener self-cleans
 * after the first matching pick or after 30 s, whichever comes first.
 *
 * Each item's `run` is invoked with no arguments when the user picks
 * it. Items without `run` (e.g. disabled items) still render but don't
 * dispatch. */
export interface ContextMenuAction {
  label: string;
  enabled?: boolean;
  run?: () => void;
}

export function showContextMenuWithActions(
  items: ReadonlyArray<ContextMenuAction | ContextMenuSeparator>,
): void {
  if (!isTauri()) return;
  popupNonceCounter += 1;
  const nonce = popupNonceCounter;
  const handlers = new Map<string, () => void>();
  const specs: ContextMenuItemSpec[] = items.map((item, index) => {
    if (item === CONTEXT_MENU_SEPARATOR) {
      return { id: "-", label: "-" };
    }
    const action = item as ContextMenuAction;
    const id = `ctx:popup:${nonce}:${index}`;
    if (action.run) handlers.set(id, action.run);
    return { id, label: action.label, enabled: action.enabled };
  });
  if (handlers.size === 0) return;

  let timeout: number | undefined;
  function onMenu(event: Event) {
    const id = (event as CustomEvent<{ id: string }>).detail?.id;
    if (!id || !handlers.has(id)) return;
    cleanup();
    try {
      handlers.get(id)?.();
    } catch (err) {
      console.error("[contextMenu] action failed", err);
    }
  }
  function cleanup() {
    window.removeEventListener("workspace:menu", onMenu);
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
  window.addEventListener("workspace:menu", onMenu);
  // Tauri's `popup` returns immediately and we don't get a "dismissed"
  // event on cancel — so the listener would otherwise leak forever for
  // each cancelled popup. The 30 s timeout caps the leak; it's long
  // enough that no real user takes longer to pick from a menu.
  timeout = window.setTimeout(cleanup, POPUP_DISMISS_TIMEOUT_MS);
  void showContextMenu(specs);
}
