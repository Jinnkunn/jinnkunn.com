"use client";
import type { Dispatch, SetStateAction } from "react";
import type { SiteAdminHomeData } from "@jinnkunn/contracts/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SiteAdminDraftStatus } from "./site-admin-draft-status";
import { SiteAdminVersionHistory } from "./site-admin-version-history";
import { SiteAdminMarkdownEditor } from "./site-admin-markdown-editor";
import type { useSiteAdminSingletonDraft } from "./use-site-admin-singleton-draft";
import styles from "./site-admin-dashboard.module.css";
type Form = { title: string; bodyMdx: string };
type Props = {
 home: { data: SiteAdminHomeData; sourceVersion: { fileSha: string } } | null;
 homePersistence: ReturnType<typeof useSiteAdminSingletonDraft<Form>>;
 homeTitle: string; setHomeTitle: Dispatch<SetStateAction<string>>;
homeBody: string; setHomeBody: Dispatch<SetStateAction<string>>;
 homeDirty: boolean; saving: boolean;
 publicationState: (path: string) => { pending: boolean; live: boolean };
 shortSha: (sha?: string) => string; onReview: () => void; beforeRestore: () => Promise<boolean>;
 onRestored: () => Promise<void>;
 onRestoringChange: (saving: boolean) => void;
  actor: string; blockingMutation: boolean;
};
export function SiteAdminHomeEditor({ home, homePersistence, homeTitle, setHomeTitle, homeBody, setHomeBody, homeDirty, saving, publicationState, shortSha, onReview, beforeRestore, onRestored, onRestoringChange, actor, blockingMutation }: Props) {
 return (
          <Card className={styles.formPanel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.cardLabel}>Home</p>
              <h2 className={styles.panelTitle}>Landing page MDX</h2>
            </div>
            <Button
              onClick={() => void homePersistence.save()}
              tone="accent"
              disabled={!home || saving || !homeDirty}
            >
              {saving ? "Saving draft" : "Save draft"}
            </Button>
          </div>
          <SiteAdminDraftStatus {...homePersistence} {...publicationState("home.json")} dirty={homeDirty} saving={saving} onRetry={() => void homePersistence.save()} onRestore={homePersistence.restore} onDismiss={homePersistence.dismiss} onReview={onReview} />
          <label className={styles.fieldLabel}>
            Title
            <input
              className={styles.textField}
              value={homeTitle}
              onChange={(event) => setHomeTitle(event.target.value)}
            />
          </label>
          <label className={styles.fieldLabel}>
            Body MDX
            <SiteAdminMarkdownEditor
              label="Home body MDX"
              persistenceKey={`${actor}:home`}
              pagePreview={{ title: homeTitle, home: true, routePath: "/" }}
              value={homeBody}
              onChange={setHomeBody}
              minHeight={620}
              size="large"
              blocking={blockingMutation}
            />
          </label>
          <p className={styles.editorHint}>
            Source version {shortSha(home?.sourceVersion.fileSha)}. Empty body MDX
            renders the public home shell only.
          </p>
          {home ? (
            <details className={styles.editorDetails}>
              <summary>
                <span>Version history</span>
                <small>{shortSha(home.sourceVersion.fileSha)}</small>
              </summary>
              <div className={styles.editorDetailsBody}>
                <SiteAdminVersionHistory
                  path="content/home.json"
                  currentSource={JSON.stringify({ ...home.data, title: homeTitle, bodyMdx: homeBody }, null, 2)}
                  currentVersion={home.sourceVersion.fileSha}
                  beforeRestore={beforeRestore}
                  onRestoringChange={onRestoringChange}
                  onRestored={onRestored}
                />
              </div>
            </details>
          ) : null}
          </Card>
 );
}

