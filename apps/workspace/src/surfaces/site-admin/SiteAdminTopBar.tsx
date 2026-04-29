import { useMemo } from "react";

import { handleWindowDragMouseDown } from "../../shell/windowDrag";
import { useSiteAdmin, useSiteAdminEphemeral } from "./state";
import { PromoteToProductionButton } from "./PromoteToProductionButton";
import { PublishButton } from "./PublishButton";
import { SiteAdminConnectionPill } from "./SiteAdminConnectionPill";
import { SyncStatusPill } from "./SyncStatusPill";
import type { LocalSyncCredentials } from "./local-content";
import { useLocalSync } from "./use-local-sync";

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

  return (
    <header
      className="site-admin-topbar"
      role="banner"
      data-tauri-drag-region
      onMouseDown={handleWindowDragMouseDown}
    >
      <div className="site-admin-topbar__spacer" aria-hidden="true" />

      <div className="site-admin-topbar__right" data-window-drag-exclude>
        <SyncStatusPill sync={sync} />
        <SiteAdminConnectionPill />
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
            {topbarSaveAction.saving ? "Saving..." : topbarSaveAction.label}
          </button>
        ) : null}
        <PublishButton
          label={productionReadOnly ? "Read-only" : `Publish ${environment.label}`}
          requirePendingChanges
        />
        <PromoteToProductionButton />
        <button
          type="button"
          className="site-admin-topbar__drawer-btn"
          onClick={toggleDrawer}
          aria-pressed={drawerOpen}
          title="Toggle dev drawer (⌘\\)"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M2 3h12v10H2z M2 10h12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>Debug</span>
        </button>
      </div>
    </header>
  );
}
