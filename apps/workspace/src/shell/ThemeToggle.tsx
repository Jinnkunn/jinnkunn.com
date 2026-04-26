import type { ThemeMode } from "./useTheme";
import { useTheme } from "./useTheme";

// Stroke-only SVGs so they inherit currentColor from the button.
const SunIcon = () => (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5v1.75M8 12.75v1.75M1.5 8h1.75M12.75 8h1.75M3.4 3.4l1.25 1.25M11.35 11.35l1.25 1.25M3.4 12.6l1.25-1.25M11.35 4.65l1.25-1.25" />
  </svg>
);

const MoonIcon = () => (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M13 10.2A5.2 5.2 0 0 1 5.8 3a5.2 5.2 0 1 0 7.2 7.2Z" />
  </svg>
);

const SystemIcon = () => (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="3" width="12" height="8.5" rx="1.5" />
    <path d="M5.5 14h5M8 11.5V14" />
  </svg>
);

const MODE_LABEL: Record<ThemeMode, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

function renderIcon(mode: ThemeMode) {
  if (mode === "light") return <SunIcon />;
  if (mode === "dark") return <MoonIcon />;
  return <SystemIcon />;
}

/** Three-state theme toggle. Cycles system → light → dark → system on
 * click. Tooltip shows both the current choice and what the next click
 * will do, so the cycle stays discoverable without needing a menu. */
export function ThemeToggle() {
  const { mode, cycle } = useTheme();
  const nextMode =
    mode === "system" ? "light" : mode === "light" ? "dark" : "system";

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
