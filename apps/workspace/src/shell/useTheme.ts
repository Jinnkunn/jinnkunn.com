import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "workspace.theme.v1";
const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";
const THEME_CHANGE_EVENT = "workspace:theme-change";

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

function readStoredMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isThemeMode(raw)) return raw;
  } catch {
    /* no-op — private-mode browsers, etc. */
  }
  return "system";
}

function prefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(DARK_MEDIA_QUERY).matches;
}

function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") return prefersDark() ? "dark" : "light";
  return mode;
}

/** Apply the resolved theme by setting `<html data-theme="...">`. The CSS
 * (`:root[data-theme="dark"]`) does the rest. */
function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = resolveTheme(mode);
}

/** Three-mode theme switcher.
 *
 * `mode` is what the user picked ("light" / "dark" / "system"); in
 * "system" mode the hook subscribes to OS color-scheme changes and
 * flips the applied theme on the fly. `resolved` is the concrete theme
 * currently painted ("light" or "dark") — use that for UI decisions
 * like picking an icon. */
export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode());
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolveTheme(readStoredMode()));

  // Paint the current mode on mount and whenever the user changes it.
  useEffect(() => {
    applyTheme(mode);
    setResolved(resolveTheme(mode));
  }, [mode]);

  // Keep separate hook instances in sync inside the same Tauri window.
  // The browser `storage` event only fires across windows, so the toggle
  // also dispatches a lightweight local event after writing localStorage.
  useEffect(() => {
    const syncMode = (next: ThemeMode) => {
      setModeState(next);
      applyTheme(next);
      setResolved(resolveTheme(next));
    };

    const onThemeChange = (event: Event) => {
      const detailMode = event instanceof CustomEvent
        ? (event.detail as { mode?: unknown } | undefined)?.mode
        : undefined;
      syncMode(isThemeMode(detailMode) ? detailMode : readStoredMode());
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) syncMode(readStoredMode());
    };

    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // In "system" mode, follow OS preference changes while the app is
  // open. In "light"/"dark" mode the listener is inert.
  useEffect(() => {
    if (mode !== "system") return;
    const mql = window.matchMedia(DARK_MEDIA_QUERY);
    const handle = () => {
      applyTheme("system");
      setResolved(prefersDark() ? "dark" : "light");
    };
    mql.addEventListener("change", handle);
    return () => {
      mql.removeEventListener("change", handle);
    };
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore — storage disabled */
    }
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { mode: next } }));
  }, []);

  /** Cycle: system → light → dark → system. */
  const cycle = useCallback(() => {
    setMode(mode === "system" ? "light" : mode === "light" ? "dark" : "system");
  }, [mode, setMode]);

  return { mode, resolved, setMode, cycle };
}
