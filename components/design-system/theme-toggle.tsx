"use client";

import { IconButton } from "@/components/ui/icon-button";

import { useDesignTheme } from "./use-design-theme";

// The accessible name is deliberately theme-neutral. `useDesignTheme()` resolves
// to "light" on the server (there is no request-time signal for the visitor's
// stored/system preference), so a directional name like "Switch to dark theme"
// ships wrong for every dark-mode visitor and only self-corrects once the
// <Suspense> boundary around this component hydrates. A neutral name is never
// wrong; `aria-pressed` carries the actual state.
const TOGGLE_LABEL = "Toggle color theme";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useDesignTheme();
  const isDark = theme === "dark";

  return (
    <IconButton
      label={TOGGLE_LABEL}
      title={TOGGLE_LABEL}
      onClick={toggleTheme}
      variant="nav"
      className="ds-theme-toggle"
      active={isDark}
      aria-pressed={isDark}
    >
      {/* Both icons are always in the DOM; CSS picks the right one off
       * `html[data-theme]`, which the parser-blocking theme-init script sets
       * before first paint. Rendering only one of them from React state would
       * paint the sun for dark visitors until hydration. */}
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        data-icon="sun"
        className="ds-icon-button__icon"
      >
        <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
        <path
          d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        data-icon="moon"
        className="ds-icon-button__icon"
      >
        <path
          d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </IconButton>
  );
}

