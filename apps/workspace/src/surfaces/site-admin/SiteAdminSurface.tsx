import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";

import { useSurfaceNav } from "../../shell/surface-nav-context";
import { CommandPalette } from "./CommandPalette";
import { DisconnectedNotice } from "./DisconnectedNotice";
import { MessageBar } from "./MessageBar";
import {
  SITE_ADMIN_DEFAULT_TAB,
  SITE_ADMIN_NAV_GROUPS,
  isSiteAdminTab,
} from "./nav";
import { SiteAdminDevDrawer } from "./SiteAdminDevDrawer";
import { SiteAdminTopBar } from "./SiteAdminTopBar";
import { SiteAdminProvider, useSiteAdmin } from "./state";
import type { ItemSelection, SiteAdminTab } from "./types";

const ConfigPanel = lazy(() =>
  import("./ConfigPanel").then((module) => ({ default: module.ConfigPanel })),
);
const HomePanel = lazy(() =>
  import("./HomePanel").then((module) => ({ default: module.HomePanel })),
);
const NewsPanel = lazy(() =>
  import("./NewsPanel").then((module) => ({ default: module.NewsPanel })),
);
const PagesPanel = lazy(() =>
  import("./PagesPanel").then((module) => ({ default: module.PagesPanel })),
);
const PostsPanel = lazy(() =>
  import("./PostsPanel").then((module) => ({ default: module.PostsPanel })),
);
const PublicationsPanel = lazy(() =>
  import("./PublicationsPanel").then((module) => ({
    default: module.PublicationsPanel,
  })),
);
const RoutesPanel = lazy(() =>
  import("./RoutesPanel").then((module) => ({ default: module.RoutesPanel })),
);
const StatusPanel = lazy(() =>
  import("./StatusPanel").then((module) => ({ default: module.StatusPanel })),
);
const TeachingPanel = lazy(() =>
  import("./TeachingPanel").then((module) => ({ default: module.TeachingPanel })),
);
const WorksPanel = lazy(() =>
  import("./WorksPanel").then((module) => ({ default: module.WorksPanel })),
);

function PanelFallback() {
  return (
    <section className="surface-card panel-loading" role="status">
      Loading panel…
    </section>
  );
}

function SiteAdminContent() {
  const { activeNavItemId, setActiveNavItemId } = useSurfaceNav();
  const { connection } = useSiteAdmin();
  const ready = Boolean(connection.baseUrl) && Boolean(connection.authToken);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Selection state lives in the shell (not the panels) so the command
  // palette can deep-link straight into a specific post/page.
  const [postsSelected, setPostsSelected] = useState<ItemSelection>(null);
  const [pagesSelected, setPagesSelected] = useState<ItemSelection>(null);

  // Narrow the shell-provided id to our tab union. Defends against a
  // persisted id that's valid in the shell (a plain string) but no
  // longer maps to a panel here.
  const activeTab: SiteAdminTab = useMemo(
    () =>
      isSiteAdminTab(activeNavItemId) ? activeNavItemId : SITE_ADMIN_DEFAULT_TAB,
    [activeNavItemId],
  );

  const selectTab = useCallback(
    (tab: SiteAdminTab) => setActiveNavItemId(tab),
    [setActiveNavItemId],
  );

  // Global keyboard shortcuts. CodeMirror binds a few modifiers (Mod-k,
  // Mod-b, Mod-i, Mod-`) at Prec.high inside the editor and stops
  // propagation, so this window-level listener only fires when focus is
  // outside the editor — the behavior we want for every shortcut here.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.altKey || event.shiftKey) return;

      switch (event.key) {
        case "k": {
          // Toggle command palette.
          event.preventDefault();
          setPaletteOpen((open) => !open);
          return;
        }
        case "s": {
          // Save current editor. PostEditor and PageEditor each render
          // their form with a stable id; submitting that form reuses the
          // same path the Save button takes, including validation + the
          // "Saving…" spinner. If no editor is mounted, fall through so
          // the browser's default save-page dialog still doesn't fire.
          const form =
            document.getElementById("post-editor-form") ??
            document.getElementById("page-editor-form");
          event.preventDefault();
          if (form instanceof HTMLFormElement) {
            form.requestSubmit();
          }
          return;
        }
        case "n": {
          // New post / new page, scoped to the current tab. Outside of
          // content tabs the shortcut is a no-op (we don't default to
          // Posts so ⌘N in Routes doesn't silently jump elsewhere).
          if (activeTab === "posts") {
            event.preventDefault();
            setPostsSelected({ kind: "new" });
          } else if (activeTab === "pages") {
            event.preventDefault();
            setPagesSelected({ kind: "new" });
          }
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTab]);

  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const openPost = useCallback(
    (slug: string) => {
      selectTab("posts");
      setPostsSelected({ kind: "edit", slug });
    },
    [selectTab],
  );
  const openPage = useCallback(
    (slug: string) => {
      selectTab("pages");
      setPagesSelected({ kind: "edit", slug });
    },
    [selectTab],
  );
  const newPost = useCallback(() => {
    selectTab("posts");
    setPostsSelected({ kind: "new" });
  }, [selectTab]);
  const newPage = useCallback(() => {
    selectTab("pages");
    setPagesSelected({ kind: "new" });
  }, [selectTab]);

  return (
    <div className="site-admin-shell">
      <SiteAdminTopBar sections={SITE_ADMIN_NAV_GROUPS} activeTab={activeTab} />
      <div className="site-admin-layout__main">
        <MessageBar />

        <Suspense fallback={<PanelFallback />}>
          {/* Status renders even when disconnected — it's the diagnostic
           * surface and shows the missing connection itself. Every other
           * panel is replaced by DisconnectedNotice so users don't see
           * grids of disabled buttons before they've signed in. */}
          {activeTab === "status" && <StatusPanel />}
          {activeTab !== "status" && !ready ? (
            <DisconnectedNotice />
          ) : (
            <>
              {activeTab === "home" && <HomePanel />}
              {activeTab === "posts" && (
                <PostsPanel
                  selected={postsSelected}
                  onSelectedChange={setPostsSelected}
                />
              )}
              {activeTab === "pages" && (
                <PagesPanel
                  selected={pagesSelected}
                  onSelectedChange={setPagesSelected}
                />
              )}
              {activeTab === "publications" && <PublicationsPanel />}
              {activeTab === "news" && <NewsPanel />}
              {activeTab === "teaching" && <TeachingPanel />}
              {activeTab === "works" && <WorksPanel />}
              {activeTab === "config" && <ConfigPanel />}
              {activeTab === "routes" && <RoutesPanel />}
            </>
          )}
        </Suspense>
      </div>
      <SiteAdminDevDrawer />
      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        activeTab={activeTab}
        onSelectTab={selectTab}
        onOpenPost={openPost}
        onOpenPage={openPage}
        onNewPost={newPost}
        onNewPage={newPage}
      />
    </div>
  );
}

export function SiteAdminSurface() {
  return (
    <SiteAdminProvider>
      <SiteAdminContent />
    </SiteAdminProvider>
  );
}
