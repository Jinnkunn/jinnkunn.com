"use client";

import { SiteAdminNavSection } from "@/components/site-admin/config/nav-section";
import { SiteAdminSettingsForm } from "@/components/site-admin/config/settings-form";
import { useSiteAdminConfigData } from "@/components/site-admin/config/use-config-data";
import { SiteAdminEditorStatusBar } from "@/components/site-admin/editor-status-bar";

export default function SiteAdminConfigClient() {
  const {
    busy,
    err,
    status,
    conflictLocked,
    openNav,
    draftSettings,
    navDraft,
    navByGroup,
    updateDraftSettings,
    saveSettings,
    updateNavDraftField,
    clearNavDraft,
    toggleOpenNav,
    saveNavRow,
    addNavRow,
    loadLatest,
  } = useSiteAdminConfigData();

  return (
    <div className="site-admin-config">
      <section>
        <h2 className="notion-heading notion-semantic-string">Config</h2>
        <p className="notion-text notion-text__content notion-semantic-string">
          Save writes structured source to GitHub main. Deploy publishes those saved changes to the live site.
        </p>
      </section>

      <SiteAdminEditorStatusBar
        status={status}
        busy={busy}
        canReload={conflictLocked}
        onReload={() => void loadLatest()}
      />

      {err ? <div className="routes-explorer__error">{err}</div> : null}

      <section className="site-admin-config__section">
        <h3 className="notion-heading notion-semantic-string">Site Settings</h3>
        <SiteAdminSettingsForm
          draftSettings={draftSettings}
          busy={busy || conflictLocked}
          setDraftSettings={updateDraftSettings}
          onSaveSettings={saveSettings}
        />
      </section>

      <section className="site-admin-config__section">
        <h3 className="notion-heading notion-semantic-string">Navigation</h3>
        <SiteAdminNavSection
          title="top"
          group="top"
          rows={navByGroup.top}
          busy={busy || conflictLocked}
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
          busy={busy || conflictLocked}
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
