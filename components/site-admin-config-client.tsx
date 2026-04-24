"use client";

import { SiteAdminNavSection } from "@/components/site-admin/config/nav-section";
import { SiteAdminSettingsForm } from "@/components/site-admin/config/settings-form";
import { useSiteAdminConfigData } from "@/components/site-admin/config/use-config-data";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusNotice } from "@/components/ui/status-notice";

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
        <SectionHeader
          title="Config"
          description="Edits here write to your site settings. Changes take effect after you click Deploy."
        />
      </section>

      {err ? <StatusNotice className="routes-explorer__error" tone="danger">{err}</StatusNotice> : null}

      <section className="site-admin-config__section">
        <SectionHeader title="Site Settings" />
        <SiteAdminSettingsForm
          draftSettings={draftSettings}
          busy={busy}
          setDraftSettings={setDraftSettings}
          onSaveSettings={saveSettings}
        />
      </section>

      <section className="site-admin-config__section">
        <SectionHeader title="Navigation" />
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
