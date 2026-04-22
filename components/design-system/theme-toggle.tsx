"use client";

import { IconButton } from "@/components/ui/icon-button";

import { useDesignTheme } from "./use-design-theme";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useDesignTheme();
  const nextLabel = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <IconButton
      label={nextLabel}
      title={nextLabel}
      onClick={toggleTheme}
      variant="nav"
      className="ds-theme-toggle"
      active={theme === "dark"}
    >
      {theme === "dark" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="ds-icon-button__icon">
          <path
            d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="ds-icon-button__icon">
          <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
          <path
            d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      )}
    </IconButton>
  );
}

