import { useEffect, useMemo } from "react";
import { Bug } from "lucide-react";

import { handleWindowDragMouseDown } from "../../shell/windowDrag";
import { OUTBOX_RETRY_EVENT } from "../../shell/useTrayBindings";
import {
  WorkspaceCommandBar,
  WorkspaceCommandButton,
  WorkspaceCommandGroup,
} from "../../ui/primitives";
import { useSiteAdmin, useSiteAdminEphemeral } from "./state";
import { PipelineStatusPill } from "./PipelineStatusPill";
import { PublishButton } from "./PublishButton";
import { SiteAdminConnectionPill } from "./SiteAdminConnectionPill";
import { SyncStatusPill } from "./SyncStatusPill";
import type { LocalSyncCredentials } from "./local-content";
import { useLocalSync } from "./use-local-sync";
import { useOutbox } from "./use-outbox";

/** Thin global action bar. The shell titlebar/sidebar already identify
 * the current location, so this bar is reserved for environment,
 * sync, publish, and debug controls. */
export function SiteAdminTopBar() {
  const {
    drawerOpen,
    environment,
    productionReadOnly,
    toggleDrawer,
    connection,
  } = useSiteAdmin();
  const { topbarSaveAction } = useSiteAdminEphemeral();

  // Phase 5a — drive the local SQLite mirror at one stable mount point so
  // we have one timer + one in-flight pull per app instance regardless of
  // how often editor tabs unmount/remount. Credentials are memoized so a
  // re-render that doesn't change the connection identity doesn't
  // re-arm the interval.
  const syncCredentials = useMemo<LocalSyncCredentials | null>(() => {
    if (!connection.baseUrl || !connection.authToken) return null;
    return {
      baseUrl: connection.baseUrl,
      authToken: connection.authToken,
      cfAccessClientId: connection.cfAccessClientId || undefined,
      cfAccessClientSecret: connection.cfAccessClientSecret || undefined,
    };
  }, [
    connection.baseUrl,
    connection.authToken,
    connection.cfAccessClientId,
    connection.cfAccessClientSecret,
  ]);
  const sync = useLocalSync(syncCredentials);
  // Phase 5b — write outbox. Same single-mount-point story as the
  // local sync hook: one drain timer + one focus listener per app
  // instance, regardless of editor tab churn.
  const outboxAuth = useMemo(
    () =>
      syncCredentials
        ? {
            bearer_token: syncCredentials.authToken,
            cf_access_client_id: syncCredentials.cfAccessClientId,
            cf_access_client_secret: syncCredentials.cfAccessClientSecret,
          }
        : null,
    [syncCredentials],
  );
  const outbox = useOutbox(outboxAuth);

  // Tray's "Retry now" → drainNow handshake. The tray is mounted at the
  // shell layer where credentials aren't available, so it dispatches a
  // window event and we (with auth in scope) consume it. Cheap; the
  // listener is no-op when the queue is empty.
  useEffect(() => {
    const onRetry = () => {
      void outbox.drainNow();
    };
    window.addEventListener(OUTBOX_RETRY_EVENT, onRetry);
    return () => window.removeEventListener(OUTBOX_RETRY_EVENT, onRetry);
  }, [outbox]);

  return (
    <WorkspaceCommandBar
      className="site-admin-topbar"
      role="banner"
      data-tauri-drag-region
      onMouseDown={handleWindowDragMouseDown}
      trailing={
        <WorkspaceCommandGroup
          align="end"
          className="site-admin-topbar__right"
        >
          <SyncStatusPill sync={sync} outbox={outbox} />
          <SiteAdminConnectionPill />
          <PipelineStatusPill
            contentDirty={Boolean(topbarSaveAction?.dirty)}
            pendingOutbox={outbox?.status.pending ?? 0}
          />
          {topbarSaveAction?.dirty ? (
            <button
              className="btn btn--primary site-admin-topbar__save-btn"
              disabled={
                topbarSaveAction.disabled ||
                topbarSaveAction.saving ||
                productionReadOnly
              }
              onClick={() => {
                void topbarSaveAction.onSave();
              }}
              title={
                productionReadOnly
                  ? environment.helpText
                  : topbarSaveAction.title
              }
              type="button"
            >
              {topbarSaveAction.saving ? "Saving…" : topbarSaveAction.label}
            </button>
          ) : null}
          <PublishButton
            contentDirty={Boolean(topbarSaveAction?.dirty)}
            label={productionReadOnly ? "Read-only" : `Publish ${environment.label}`}
            outbox={outbox}
            requirePendingChanges
            sync={sync}
          />
          <WorkspaceCommandButton
            tone="ghost"
            onClick={toggleDrawer}
            aria-pressed={drawerOpen}
            title="Toggle dev drawer (⌘\\)"
          >
            <Bug
              absoluteStrokeWidth
              aria-hidden="true"
              focusable="false"
              size={14}
              strokeWidth={1.65}
            />
            <span>Debug</span>
          </WorkspaceCommandButton>
        </WorkspaceCommandGroup>
      }
    />
  );
}
