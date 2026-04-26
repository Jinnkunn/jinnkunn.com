import { useCallback } from "react";

import { ConfigPanel } from "./ConfigPanel";
import { RoutesPanel } from "./RoutesPanel";
import { isString, usePersistentUiState } from "./use-persistent-ui-state";

const SETTINGS_SECTIONS = ["site", "routes"] as const;
type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const SECTION_LABELS: Record<SettingsSection, string> = {
  site: "Site & Navigation",
  routes: "URL Routes",
};

const SECTION_HINTS: Record<SettingsSection, string> = {
  site: "Site identity, social cards, navigation, and SEO defaults.",
  routes: "Custom URL overrides, route protection, and rename redirects.",
};

function isSettingsSection(value: unknown): value is SettingsSection {
  return isString(value) && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/** Super.so-style Settings surface: two horizontal sub-tabs that flip
 * between Site config and URL routing. Both already-built panels mount
 * unchanged (so per-section concurrency / save UX keeps working); this
 * is purely a navigation collapse — one Settings entry in the sidebar
 * instead of two. */
export function SettingsPanel() {
  const [section, setSection] = usePersistentUiState<SettingsSection>(
    "workspace.site-admin.settings.section.v1",
    "site",
    isSettingsSection,
  );

  const select = useCallback(
    (next: SettingsSection) => setSection(next),
    [setSection],
  );

  return (
    <div className="settings-surface">
      <header className="settings-surface__head">
        <div>
          <h1 className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]">
            Settings
          </h1>
          <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">
            {SECTION_HINTS[section]}
          </p>
        </div>
        <nav
          className="settings-surface__tabs"
          role="tablist"
          aria-label="Settings sections"
        >
          {SETTINGS_SECTIONS.map((id) => {
            const active = id === section;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`settings-surface__tab${active ? " settings-surface__tab--active" : ""}`}
                onClick={() => select(id)}
              >
                {SECTION_LABELS[id]}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="settings-surface__body">
        {section === "site" ? <ConfigPanel /> : null}
        {section === "routes" ? <RoutesPanel /> : null}
      </div>
    </div>
  );
}
