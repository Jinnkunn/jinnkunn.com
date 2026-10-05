"use client";

import { IconButton } from "@/components/ui/icon-button";
import { ThemeToggleIcons } from "./theme-toggle-icons";

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
      <ThemeToggleIcons />
    </IconButton>
  );
}
