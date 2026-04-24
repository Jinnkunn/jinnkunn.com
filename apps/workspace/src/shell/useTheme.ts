import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "workspace.theme.v1";
const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

function readStoredMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
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
  }, []);

  /** Cycle: system → light → dark → system. */
  const cycle = useCallback(() => {
    setMode(mode === "system" ? "light" : mode === "light" ? "dark" : "system");
  }, [mode, setMode]);

  return { mode, resolved, setMode, cycle };
}
