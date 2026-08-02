"use client";

import { Button } from "@/components/ui/button";
import { StatusNotice } from "@/components/ui/status-notice";
import { useSiteAdminConfigData } from "@/components/site-admin/config/use-config-data";
import type { NavItemRow } from "@/components/site-admin/config/types";
import styles from "./site-admin-dashboard.module.css";

export function SiteAdminSettingsPanel() {
  const {
    busy,
    err,
    nav,
    draftSettings,
    navDraft,
    setDraftSettings,
    saveSettings,
    updateNavDraftField,
    saveNavRow,
    addNavRow,
  } = useSiteAdminConfigData();

  function navValue<K extends keyof NavItemRow>(row: NavItemRow, key: K): NavItemRow[K] {
    return (navDraft[row.rowId]?.[key] as NavItemRow[K] | undefined) ?? row[key];
  }

  return (
    <section className={styles.settingsWorkspace}>
      {err ? <StatusNotice tone="danger">{err}</StatusNotice> : null}
      <div className={styles.settingsSection}>
        <div className={styles.settingsHeader}>
          <div>
            <h2 className={styles.panelTitle}>Site identity</h2>
            <p className={styles.cardText}>Core metadata used by the public site and search previews.</p>
          </div>
          <Button onClick={() => void saveSettings()} tone="accent" size="sm" disabled={busy || !draftSettings}>
            Save settings
          </Button>
        </div>
        {draftSettings ? (
          <div className={styles.settingsGrid}>
            <label className={styles.fieldLabel}>
              Site name
              <input
                className={styles.textField}
                value={draftSettings.siteName}
                onChange={(event) =>
                  setDraftSettings((current) => current ? { ...current, siteName: event.target.value } : current)
                }
              />
            </label>
            <label className={styles.fieldLabel}>
              Language
              <input
                className={styles.textField}
                value={draftSettings.lang}
                onChange={(event) =>
                  setDraftSettings((current) => current ? { ...current, lang: event.target.value } : current)
                }
              />
            </label>
            <label className={styles.fieldLabel}>
              SEO title
              <input
                className={styles.textField}
                value={draftSettings.seoTitle}
                onChange={(event) =>
                  setDraftSettings((current) => current ? { ...current, seoTitle: event.target.value } : current)
                }
              />
            </label>
            <label className={styles.fieldLabel}>
              OG image
              <input
                className={styles.textField}
                value={draftSettings.ogImage}
                onChange={(event) =>
                  setDraftSettings((current) => current ? { ...current, ogImage: event.target.value } : current)
                }
              />
            </label>
            <label className={`${styles.fieldLabel} ${styles.settingsWideField}`}>
              SEO description
              <textarea
                className={styles.inspectorTextarea}
                value={draftSettings.seoDescription}
                onChange={(event) =>
                  setDraftSettings((current) => current ? { ...current, seoDescription: event.target.value } : current)
                }
              />
            </label>
          </div>
        ) : (
          <p className={styles.listEmpty}>Loading settings…</p>
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
