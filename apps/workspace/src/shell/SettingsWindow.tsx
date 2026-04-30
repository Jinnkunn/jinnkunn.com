import { useEffect } from "react";

function SettingsIconLarge() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 2.75v2.2M12 19.05v2.2M4.05 4.05l1.55 1.55M18.4 18.4l1.55 1.55M2.75 12h2.2M19.05 12h2.2M4.05 19.95l1.55-1.55M18.4 5.6l1.55-1.55" />
    </svg>
  );
}

export function SettingsWindow({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div
      className="settings-window-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="settings-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-window-title"
      >
        <aside className="settings-window__sidebar">
          <div className="settings-window__sidebar-title">Settings</div>
          <button
            type="button"
            className="settings-window__nav-item"
            aria-current="page"
          >
            General
          </button>
        </aside>
        <main className="settings-window__main">
          <button
            type="button"
            className="settings-window__close"
            onClick={onClose}
            aria-label="Close settings"
            title="Close"
          >
            x
          </button>
          <div className="settings-window__empty">
            <SettingsIconLarge />
            <h1 id="settings-window-title">Settings</h1>
          </div>
        </main>
      </section>
    </div>
  );
}
