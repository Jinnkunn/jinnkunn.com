import { useEffect } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import type { ThemeMode } from "./useTheme";
import { useTheme } from "./useTheme";

const MODE_LABEL: Record<ThemeMode, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

function renderIcon(mode: ThemeMode) {
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;
  return (
    <Icon
      absoluteStrokeWidth
      aria-hidden="true"
      size={14}
      strokeWidth={1.5}
    />
  );
}

/** Three-state theme toggle. Cycles system → light → dark → system on
 * click. Tooltip shows both the current choice and what the next click
 * will do, so the cycle stays discoverable without needing a menu. */
export function ThemeToggle() {
  const { mode, cycle } = useTheme();
  const nextMode =
    mode === "system" ? "light" : mode === "light" ? "dark" : "system";

  // Bridge for the command palette's "Cycle theme" action. The palette
  // can't import the hook directly without coupling its render scope
  // to the theme provider, so it dispatches a synthetic event instead.
  // We listen here (the only mounted ThemeToggle in the app) and route
  // it back to `cycle()`, which is the same callback the click handler
  // uses.
  useEffect(() => {
    const onCycleEvent = () => cycle();
    window.addEventListener("workspace:theme:cycle", onCycleEvent);
    return () => window.removeEventListener("workspace:theme:cycle", onCycleEvent);
  }, [cycle]);

  return (
    <button
      type="button"
      className="theme-toggle"
      data-window-drag-exclude
      onClick={cycle}
      title={`Theme: ${MODE_LABEL[mode]} — click for ${MODE_LABEL[nextMode]}`}
      aria-label={`Theme: ${MODE_LABEL[mode]} (click to cycle)`}
    >
      {renderIcon(mode)}
    </button>
  );
}
