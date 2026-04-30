import { useEffect } from "react";
import type { WorkspaceModuleDefinition } from "../modules/types";

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
  enabledModuleIds,
  modules,
  open,
  onClose,
  onSetModuleEnabled,
}: {
  enabledModuleIds: readonly string[];
  modules: readonly WorkspaceModuleDefinition[];
  open: boolean;
  onClose: () => void;
  onSetModuleEnabled: (moduleId: string, enabled: boolean) => void;
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
            Modules
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
          <div className="settings-window__section">
            <div className="settings-window__section-head">
              <SettingsIconLarge />
              <div>
                <h1 id="settings-window-title">Modules</h1>
                <p>{enabledModuleIds.length} enabled</p>
              </div>
            </div>
            <div className="settings-modules-list">
              {modules.map((module) => {
                const enabled = enabledModuleIds.includes(module.id);
                return (
                  <div className="settings-module-row" key={module.id}>
                    <span className="settings-module-row__icon" aria-hidden="true">
                      {module.surface.icon}
                    </span>
                    <span className="settings-module-row__body">
                      <strong>{module.surface.title}</strong>
                      {module.surface.description ? (
                        <small>{module.surface.description}</small>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      className="settings-module-toggle"
                      role="switch"
                      aria-checked={enabled}
                      aria-label={`${enabled ? "Disable" : "Enable"} ${module.surface.title}`}
                      data-on={enabled ? "true" : undefined}
                      onClick={() => onSetModuleEnabled(module.id, !enabled)}
                    >
                      <span aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      </section>
    </div>
  );
}
