"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import {
  DESIGN_THEME_CHANGE_EVENT,
  applyDesignTheme,
  dispatchDesignThemeChange,
  persistDesignTheme,
  readRequestedDesignTheme,
  readStoredDesignTheme,
  readSystemDesignTheme,
  resolveDesignTheme,
  type DesignTheme,
} from "@/lib/design-system/theme";

function getResolvedTheme(requested: DesignTheme | null): DesignTheme {
  if (typeof window === "undefined") return requested || "light";
  return resolveDesignTheme({
    requested,
    stored: readStoredDesignTheme(window.localStorage),
    system: readSystemDesignTheme(window.matchMedia),
  });
}

export function useDesignTheme() {
  const searchParams = useSearchParams();
  const requestedTheme = useMemo(
    () => readRequestedDesignTheme(`?${searchParams.toString()}`),
    [searchParams],
  );
  const [theme, setTheme] = useState<DesignTheme>(() => getResolvedTheme(requestedTheme));

  useEffect(() => {
    const sync = () => {
      const next = getResolvedTheme(requestedTheme);
      setTheme(next);
      applyDesignTheme(next, document.documentElement);
    };

    sync();

    const onStorage = () => sync();
    const onThemeChange = (event: Event) => {
      const detailTheme = (event as CustomEvent<{ theme?: DesignTheme }>).detail?.theme;
      const next = detailTheme || getResolvedTheme(requestedTheme);
      setTheme(next);
      applyDesignTheme(next, document.documentElement);
    };
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onMedia = () => {
      if (requestedTheme) return;
      if (readStoredDesignTheme(window.localStorage)) return;
      sync();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(DESIGN_THEME_CHANGE_EVENT, onThemeChange as EventListener);
    media.addEventListener("change", onMedia);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(DESIGN_THEME_CHANGE_EVENT, onThemeChange as EventListener);
      media.removeEventListener("change", onMedia);
    };
  }, [requestedTheme]);

  const setDesignTheme = useCallback((next: DesignTheme) => {
    if (typeof window === "undefined") return;
    persistDesignTheme(next, window.localStorage);
    applyDesignTheme(next, document.documentElement);
    setTheme(next);
    dispatchDesignThemeChange(next, window);
  }, []);

  const toggleTheme = useCallback(() => {
    setDesignTheme(theme === "dark" ? "light" : "dark");
  }, [setDesignTheme, theme]);

  return {
    theme,
    requestedTheme,
    setDesignTheme,
    toggleTheme,
  };
}

