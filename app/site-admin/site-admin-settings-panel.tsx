"use client";

import { useEffect, useState } from "react";

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
    navByGroup,
    draftSettings,
    settingsDirty,
    settingsSavedAt,
    navDraft,
    setDraftSettings,
    saveSettings,
    updateNavDraftField,
    saveNavRow,
    saveAllNavRows,
    addNavRow,
  } = useSiteAdminConfigData();
  const [section, setSection] = useState<"site" | "navigation">("site");
  const pendingNavCount = Object.keys(navDraft).length;

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
      <div className={styles.settingsLayout}>
        <nav className={styles.settingsSubnav} aria-label="Settings sections">
          <button
            type="button"
            data-active={section === "site"}
            onClick={() => setSection("site")}
          >
            <strong>Site and SEO</strong>
            <small>Identity, sharing, and advanced policy</small>
          </button>
          <button
            type="button"
            data-active={section === "navigation"}
            onClick={() => setSection("navigation")}
          >
            <strong>Navigation</strong>
            <small>{nav.length} links · {pendingNavCount || "no"} pending</small>
          </button>
        </nav>

        <div className={styles.settingsContent}>
          {section === "site" ? (
            <section className={styles.settingsSection}>
              <div className={styles.settingsHeader}>
                <div>
                  <p className={styles.cardLabel}>Site settings</p>
                  <h2 className={styles.panelTitle}>Identity and discovery</h2>
                </div>
                <span
                  className={styles.statusPill}
                  data-state={settingsDirty ? "smart-release" : "noop"}
                >
                  {settingsDirty ? "Unsaved changes" : "Saved"}
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
            </section>
          ) : (
            <section className={styles.settingsSection}>
              <div className={styles.settingsHeader}>
                <div>
                  <p className={styles.cardLabel}>Navigation</p>
                  <h2 className={styles.panelTitle}>Public links</h2>
                  <p className={styles.cardText}>
                    Edit labels, routes, visibility, and display order.
                  </p>
                </div>
                <div className={styles.panelActions}>
                  <Button
                    onClick={() => void addNavRow("top")}
                    variant="subtle"
                    size="sm"
                    disabled={busy}
                  >
                    Add primary
                  </Button>
                  <Button
                    onClick={() => void addNavRow("more")}
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                  >
                    Add more
                  </Button>
                  <Button
                    onClick={() => void saveAllNavRows()}
                    tone="accent"
                    size="sm"
                    disabled={busy || pendingNavCount === 0}
                  >
                    Save all
                  </Button>
                </div>
              </div>
              {(["top", "more"] as const).map((group) => {
                const rows = navByGroup[group];
                return (
                  <div className={styles.settingsNavGroup} key={group}>
                    <div className={styles.settingsNavGroupHeader}>
                      <strong>{group === "top" ? "Primary" : "More"}</strong>
                      <small>{rows.length} links</small>
                    </div>
                    <div className={styles.settingsNavList}>
                      {rows.map((row) => (
                        <div key={row.rowId} className={styles.settingsNavRow}>
                          <input
                            className={styles.textField}
                            aria-label="Navigation label"
                            value={String(navValue(row, "label"))}
                            onChange={(event) =>
                              updateNavDraftField(row.rowId, { label: event.target.value })
                            }
                          />
                          <input
                            className={styles.textField}
                            aria-label="Navigation route"
                            value={String(navValue(row, "href"))}
                            onChange={(event) =>
                              updateNavDraftField(row.rowId, { href: event.target.value })
                            }
                          />
                          <input
                            className={styles.textField}
                            aria-label="Navigation order"
                            type="number"
                            value={Number(navValue(row, "order"))}
                            onChange={(event) =>
                              updateNavDraftField(row.rowId, {
                                order: Number(event.target.value),
                              })
                            }
                          />
                          <label className={styles.checkField}>
                            <input
                              type="checkbox"
                              checked={Boolean(navValue(row, "enabled"))}
                              onChange={(event) =>
                                updateNavDraftField(row.rowId, {
                                  enabled: event.target.checked,
                                })
                              }
                            />
                            Visible
                          </label>
                          <Button
                            onClick={() => void saveNavRow(row)}
                            variant="subtle"
                            size="sm"
                            disabled={busy || !navDraft[row.rowId]}
                          >
                            Save row
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          )}
        </div>
      </div>
    </section>
  );
}
