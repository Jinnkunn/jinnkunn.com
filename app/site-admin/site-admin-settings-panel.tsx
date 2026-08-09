"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { StatusNotice } from "@/components/ui/status-notice";
import { SiteAdminSettingsForm } from "@/components/site-admin/config/settings-form";
import { useSiteAdminConfigData } from "@/components/site-admin/config/use-config-data";
import type { NavItemRow } from "@/components/site-admin/config/types";
import formStyles from "@/components/site-admin/config/settings-form.module.css";
import styles from "./site-admin-dashboard.module.css";

export function SiteAdminSettingsPanel({
  onDirtyChange,
}: {
  /** Lets the console include the settings draft in its unsaved-changes guard. */
  onDirtyChange?: (dirty: boolean) => void;
} = {}) {
  const {
    busy,
    err,
    nav,
    draftSettings,
    settingsDirty,
    settingsSavedAt,
    navDraft,
    setDraftSettings,
    saveSettings,
    updateNavDraftField,
    saveNavRow,
    addNavRow,
  } = useSiteAdminConfigData();

  useEffect(() => {
    onDirtyChange?.(settingsDirty);
    return () => onDirtyChange?.(false);
  }, [onDirtyChange, settingsDirty]);

  function navValue<K extends keyof NavItemRow>(row: NavItemRow, key: K): NavItemRow[K] {
    return (navDraft[row.rowId]?.[key] as NavItemRow[K] | undefined) ?? row[key];
  }

  return (
    <section className={styles.settingsWorkspace}>
      {err ? <StatusNotice tone="danger">{err}</StatusNotice> : null}
      {!err && settingsSavedAt && !settingsDirty ? (
        <StatusNotice tone="success">Settings saved.</StatusNotice>
      ) : null}
      <div className={styles.settingsSection}>
        <div className={styles.settingsHeader}>
          <div>
            <h2 className={styles.panelTitle}>Site identity</h2>
            <p className={styles.cardText}>
              Core metadata, analytics, and sitemap policy used by the public site and
              search previews.
            </p>
          </div>
          <span className={styles.statusPill} data-state={settingsDirty ? "smart-release" : "noop"}>
            {settingsDirty ? "Unsaved edits" : "Saved"}
          </span>
        </div>
        {draftSettings ? (
          <div className={formStyles.host}>
            <SiteAdminSettingsForm
              draftSettings={draftSettings}
              busy={busy || !settingsDirty}
              setDraftSettings={setDraftSettings}
              onSaveSettings={() => void saveSettings()}
            />
          </div>
        ) : (
          <LoadingState label="Loading settings…" />
        )}
      </div>

      <div className={styles.settingsSection}>
        <div className={styles.settingsHeader}>
          <div>
            <h2 className={styles.panelTitle}>Navigation</h2>
            <p className={styles.cardText}>Manage labels, routes, visibility, and order without editing configuration files.</p>
          </div>
          <div className={styles.panelActions}>
            <Button onClick={() => void addNavRow("top")} variant="subtle" size="sm" disabled={busy}>
              Add primary
            </Button>
            <Button onClick={() => void addNavRow("more")} variant="ghost" size="sm" disabled={busy}>
              Add more
            </Button>
          </div>
        </div>
        <div className={styles.settingsNavList}>
          {nav.map((row) => (
            <div key={row.rowId} className={styles.settingsNavRow}>
              <input
                className={styles.textField}
                aria-label="Navigation label"
                value={String(navValue(row, "label"))}
                onChange={(event) => updateNavDraftField(row.rowId, { label: event.target.value })}
              />
              <input
                className={styles.textField}
                aria-label="Navigation route"
                value={String(navValue(row, "href"))}
                onChange={(event) => updateNavDraftField(row.rowId, { href: event.target.value })}
              />
              <input
                className={styles.textField}
                aria-label="Navigation order"
                type="number"
                value={Number(navValue(row, "order"))}
                onChange={(event) => updateNavDraftField(row.rowId, { order: Number(event.target.value) })}
              />
              <label className={styles.checkField}>
                <input
                  type="checkbox"
                  checked={Boolean(navValue(row, "enabled"))}
                  onChange={(event) => updateNavDraftField(row.rowId, { enabled: event.target.checked })}
                />
                Visible
              </label>
              <Button onClick={() => void saveNavRow(row)} variant="subtle" size="sm" disabled={busy || !navDraft[row.rowId]}>
                Save
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
