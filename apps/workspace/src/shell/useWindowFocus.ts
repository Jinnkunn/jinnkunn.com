import { useEffect, useState } from "react";

/** Tracks whether the OS window has focus. Used by the shell to drive
 * the focused/blurred sidebar shadow treatment (matches personal-os's
 * `.sidebar-surface-focused` / `.sidebar-surface-blurred` split).
 *
 * Uses browser `focus` / `blur` events rather than Tauri's window event
 * stream because the browser events fire reliably on the same webview
 * regardless of platform and don't need an async subscription. */
export function useWindowFocus(): boolean {
  const [focused, setFocused] = useState(() =>
    typeof document !== "undefined" ? document.hasFocus() : true,
  );

  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Mirror onto body[data-window-focused] so pure-CSS selectors (e.g.
  // `body[data-window-focused="true"] .sidebar-surface`) can react
  // without threading the boolean through every component.
  useEffect(() => {
    document.body.dataset.windowFocused = focused ? "true" : "false";
  }, [focused]);

  return focused;
}
