"use client";
import type { Dispatch, SetStateAction } from "react";
import type { SiteAdminNowData, SiteAdminNowUpdate } from "@jinnkunn/contracts/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SiteAdminDraftStatus } from "./site-admin-draft-status";
import { SiteAdminVersionHistory } from "./site-admin-version-history";

import type { useSiteAdminSingletonDraft } from "./use-site-admin-singleton-draft";
import styles from "./site-admin-dashboard.module.css";
type Form = { text: string; context: string; location: string; date: string };
type Props = {
 now: { data: SiteAdminNowData; sourceVersion: { fileSha: string } } | null;
 nowPersistence: ReturnType<typeof useSiteAdminSingletonDraft<Form>>;
 nowText: string; setNowText: Dispatch<SetStateAction<string>>;
nowDate: string; setNowDate: Dispatch<SetStateAction<string>>;
nowContext: string; setNowContext: Dispatch<SetStateAction<string>>;
nowLocation: string; setNowLocation: Dispatch<SetStateAction<string>>;
editingHistoryId: string; setEditingHistoryId: Dispatch<SetStateAction<string>>;
historyText: string; setHistoryText: Dispatch<SetStateAction<string>>;
historyDate: string; setHistoryDate: Dispatch<SetStateAction<string>>;
 nowDirty: boolean; saving: boolean;
 publicationState: (path: string) => { pending: boolean; live: boolean };
 shortSha: (sha?: string) => string; onReview: () => void; beforeRestore: () => Promise<boolean>;
 onRestored: () => Promise<void>;
 onRestoringChange: (saving: boolean) => void;
  formatWhen: (value: string | number | undefined) => string; saveHistoryEdit: () => Promise<void>; startHistoryEdit: (item: SiteAdminNowUpdate) => void; deleteHistory: (id: string) => Promise<void>;
};
export function SiteAdminNowEditor({ now, nowPersistence, nowText, setNowText, nowDate, setNowDate, nowContext, setNowContext, nowLocation, setNowLocation, editingHistoryId, setEditingHistoryId, historyText, setHistoryText, historyDate, setHistoryDate, nowDirty, saving, publicationState, shortSha, onReview, beforeRestore, onRestored, onRestoringChange, formatWhen, saveHistoryEdit, startHistoryEdit, deleteHistory }: Props) {
 return (
          <div className={styles.nowEditorStack}>
            <Card className={styles.formPanel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.cardLabel}>Now</p>
                <h2 className={styles.panelTitle}>Current status</h2>
              </div>
              <Button onClick={() => void nowPersistence.save()} tone="accent" disabled={!now || saving || !nowDirty}>
                {saving ? "Saving draft" : "Save draft"}
              </Button>
            </div>
            <SiteAdminDraftStatus {...nowPersistence} {...publicationState("now.json")} dirty={nowDirty} saving={saving} onRetry={() => void nowPersistence.save()} onRestore={nowPersistence.restore} onDismiss={nowPersistence.dismiss} onReview={onReview} />
            <label className={styles.fieldLabel}>
              Status
              <textarea
                className={styles.nowEditor}
                value={nowText}
                onChange={(event) => setNowText(event.target.value)}
              />
            </label>
            <div className={styles.fieldGrid}>
              <label className={styles.fieldLabel}>
                Date
                <input
                  className={styles.textField}
                  type="date"
                  value={nowDate}
                  onChange={(event) => setNowDate(event.target.value)}
                />
              </label>
              <label className={styles.fieldLabel}>
                Context
                <input
                  className={styles.textField}
                  value={nowContext}
                  onChange={(event) => setNowContext(event.target.value)}
                />
              </label>
              <label className={styles.fieldLabel}>
                Location
                <input
                  className={styles.textField}
                  value={nowLocation}
                  onChange={(event) => setNowLocation(event.target.value)}
                />
              </label>
            </div>
            <p className={styles.editorHint}>
              Saved content can be published from the Publish tab.
            </p>
            {now ? (
              <details className={styles.editorDetails}>
                <summary>
                  <span>Version history</span>
                  <small>{shortSha(now.sourceVersion.fileSha)}</small>
                </summary>
                <div className={styles.editorDetailsBody}>
                  <SiteAdminVersionHistory
                    path="content/now.json"
                    currentSource={JSON.stringify({ ...now.data, current: { ...now.data.current, text: nowText, context: nowContext, location: nowLocation, updatedAt: nowDate === now.data.current.updatedAt?.slice(0, 10) ? now.data.current.updatedAt : nowDate } }, null, 2)}
                    currentVersion={now.sourceVersion.fileSha}
                  beforeRestore={beforeRestore}
                  onRestoringChange={onRestoringChange}
                    onRestored={onRestored}
                  />
                </div>
              </details>
            ) : null}
            </Card>

            <Card className={styles.historyPanel}>
            <p className={styles.cardLabel}>History</p>
            <div className={styles.historyList}>
              {(now?.data.updates || []).map((item) => (
                <div key={item.id} className={styles.historyItem}>
                  {editingHistoryId === item.id ? (
                    <>
                      <textarea
                        className={styles.historyEditor}
                        value={historyText}
                        onChange={(event) => setHistoryText(event.target.value)}
                      />
                      <div className={styles.historyActions}>
                        <input
                          className={styles.textField}
                          type="date"
                          value={historyDate}
                          onChange={(event) => setHistoryDate(event.target.value)}
                        />
                        <Button
                          onClick={() => void saveHistoryEdit()}
                          tone="accent"
                          size="sm"
                          disabled={saving}
                        >
                          Save
                        </Button>
                        <Button
                          onClick={() => setEditingHistoryId("")}
                          variant="ghost"
                          size="sm"
                        >
                          Cancel
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p>{item.text}</p>
                      <small>{formatWhen(item.at)}</small>
                      <div className={styles.historyActions}>
                        <Button
                          onClick={() => startHistoryEdit(item)}
                          variant="subtle"
                          size="sm"
                        >
                          Edit
                        </Button>
                        <Button
                          onClick={() => void deleteHistory(item.id)}
                          variant="ghost"
                          tone="danger"
                          size="sm"
                          disabled={saving}
                        >
                          Delete
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
            </Card>
          </div>
 );
}

