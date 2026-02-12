"use client";

import { SiteAdminNavSection } from "@/components/site-admin/config/nav-section";
import { SiteAdminSettingsForm } from "@/components/site-admin/config/settings-form";
import { useSiteAdminConfigData } from "@/components/site-admin/config/use-config-data";

export default function SiteAdminConfigClient() {
  const {
    busy,
    err,
    openNav,
    draftSettings,
    navDraft,
    navByGroup,
    setDraftSettings,
    saveSettings,
    updateNavDraftField,
    clearNavDraft,
    toggleOpenNav,
    saveNavRow,
    addNavRow,
  } = useSiteAdminConfigData();

  return (
    <div className="site-admin-config">
      <section>
        <h2 className="notion-heading notion-semantic-string">Config</h2>
        <p className="notion-text notion-text__content notion-semantic-string">
          Edits here write to your site settings. Changes take effect after you click Deploy.
        </p>
      </section>

      {err ? <div className="routes-explorer__error">{err}</div> : null}

      <section className="site-admin-config__section">
        <h3 className="notion-heading notion-semantic-string">Site Settings</h3>
        <SiteAdminSettingsForm
          draftSettings={draftSettings}
          busy={busy}
          setDraftSettings={setDraftSettings}
          onSaveSettings={saveSettings}
        />
      </section>

      <section className="site-admin-config__section">
        <h3 className="notion-heading notion-semantic-string">Navigation</h3>
        <SiteAdminNavSection
          title="top"
          group="top"
          rows={navByGroup.top}
          busy={busy}
          openNav={openNav}
          navDraft={navDraft}
          onAddRow={addNavRow}
          onToggleOpenNav={toggleOpenNav}
          onUpdateNavDraftField={updateNavDraftField}
          onSaveNavRow={(row) => void saveNavRow(row)}
          onClearNavDraft={clearNavDraft}
        />
        <SiteAdminNavSection
          title="more"
          group="more"
          rows={navByGroup.more}
          busy={busy}
          openNav={openNav}
          navDraft={navDraft}
          onAddRow={addNavRow}
          onToggleOpenNav={toggleOpenNav}
          onUpdateNavDraftField={updateNavDraftField}
          onSaveNavRow={(row) => void saveNavRow(row)}
          onClearNavDraft={clearNavDraft}
          className="site-admin-config__section-nav"
        />
      </section>
    </div>
  );
}
