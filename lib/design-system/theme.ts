import { DESIGN_THEMES, type DesignTheme } from "./tokens.ts";

export { DESIGN_THEMES };
export type { DesignTheme };

export const DESIGN_THEME_STORAGE_KEY = "ds-theme";
export const DESIGN_THEME_CHANGE_EVENT = "ds-theme-change";

export function normalizeDesignTheme(value: string | null | undefined): DesignTheme | null {
  const raw = String(value || "").trim().toLowerCase();
  return (DESIGN_THEMES as readonly string[]).includes(raw) ? (raw as DesignTheme) : null;
}

export function resolveDesignTheme(input: {
  requested?: string | null;
  stored?: string | null;
  system?: string | null;
}): DesignTheme {
  return (
    normalizeDesignTheme(input.requested) ||
    normalizeDesignTheme(input.stored) ||
    normalizeDesignTheme(input.system) ||
    "light"
  );
}

export function readRequestedDesignTheme(search: string): DesignTheme | null {
  try {
    const params = new URLSearchParams(search);
    return normalizeDesignTheme(params.get("theme"));
  } catch {
    return null;
  }
}

export function readStoredDesignTheme(storage?: Pick<Storage, "getItem"> | null): DesignTheme | null {
  if (!storage) return null;
  try {
    return normalizeDesignTheme(storage.getItem(DESIGN_THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function readSystemDesignTheme(matchMediaFn?: ((query: string) => MediaQueryList) | null): DesignTheme {
  if (!matchMediaFn) return "light";
  try {
    return matchMediaFn("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyDesignTheme(theme: DesignTheme, root?: HTMLElement | null) {
  if (!root) return;
  root.dataset.theme = theme;
  root.classList.remove("theme-light", "theme-dark");
  root.classList.add(theme === "dark" ? "theme-dark" : "theme-light");
}

export function persistDesignTheme(theme: DesignTheme, storage?: Pick<Storage, "setItem"> | null) {
  if (!storage) return;
  try {
    storage.setItem(DESIGN_THEME_STORAGE_KEY, theme);
  } catch {
    // ignore
  }
}

export function dispatchDesignThemeChange(theme: DesignTheme, win?: Window | null) {
  if (!win) return;
  try {
    win.dispatchEvent(new CustomEvent(DESIGN_THEME_CHANGE_EVENT, { detail: { theme } }));
  } catch {
    // ignore
  }
}

export function getDesignThemeInitScript(): string {
  return `
(() => {
  const storageKey = ${JSON.stringify(DESIGN_THEME_STORAGE_KEY)};
  const normalize = (value) => {
    const raw = String(value || "").trim().toLowerCase();
    return raw === "light" || raw === "dark" ? raw : null;
  };
  const apply = (theme) => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.classList.remove("theme-light", "theme-dark");
    root.classList.add(theme === "dark" ? "theme-dark" : "theme-light");
  };
  try {
    const requested = normalize(new URLSearchParams(window.location.search).get("theme"));
    const stored = normalize(window.localStorage.getItem(storageKey));
    const system = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    apply(requested || stored || system || "light");
  } catch {
    apply("light");
  }
})();
  `.trim();
}
