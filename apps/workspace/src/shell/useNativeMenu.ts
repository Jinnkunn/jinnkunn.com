import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface NativeMenuHandlers {
  onOpenPalette?: () => void;
  onCheckUpdates?: () => void;
}

/** Bridge native AppKit menubar selections into the React app. The
 * Rust side fires `menu://action` with the menu id as payload (see
 * `src-tauri/src/main.rs`). This hook re-broadcasts the id as a
 * `workspace:menu` window CustomEvent so any surface or palette can
 * react without taking a Tauri dependency. The shell also handles a
 * few well-known ids directly when the corresponding callback is
 * wired. Handlers are kept in a ref so the listener subscribes once
 * for the lifetime of the app — the subscription survives every
 * re-render of the parent. */
export function useNativeMenu(handlers: NativeMenuHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    void listen<string>("menu://action", (event) => {
      const id = event.payload;
      switch (id) {
        case "menu-open-palette":
          handlersRef.current.onOpenPalette?.();
          break;
        case "menu-check-updates":
          handlersRef.current.onCheckUpdates?.();
          break;
        case "menu-cycle-theme":
          window.dispatchEvent(new CustomEvent("workspace:theme:cycle"));
          break;
        default:
          break;
      }
      window.dispatchEvent(
        new CustomEvent("workspace:menu", { detail: { id } }),
      );
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
