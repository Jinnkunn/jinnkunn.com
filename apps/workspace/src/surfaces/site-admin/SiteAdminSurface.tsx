import { useCallback, useEffect, useMemo, useState } from "react";

import { useSurfaceNav } from "../../shell/surface-nav-context";
import { CommandPalette } from "./CommandPalette";
import { ConfigPanel } from "./ConfigPanel";
import { HomePanel } from "./HomePanel";
import { MessageBar } from "./MessageBar";
import {
  SITE_ADMIN_DEFAULT_TAB,
  SITE_ADMIN_NAV_GROUPS,
  isSiteAdminTab,
} from "./nav";
import { NewsPanel } from "./NewsPanel";
import { PagesPanel } from "./PagesPanel";
import { PostsPanel } from "./PostsPanel";
import { PublicationsPanel } from "./PublicationsPanel";
import { RoutesPanel } from "./RoutesPanel";
import { SiteAdminDevDrawer } from "./SiteAdminDevDrawer";
import { SiteAdminTopBar } from "./SiteAdminTopBar";
import { SiteAdminProvider } from "./state";
import { StatusPanel } from "./StatusPanel";
import { TeachingPanel } from "./TeachingPanel";
import { WorksPanel } from "./WorksPanel";
import type { ItemSelection, SiteAdminTab } from "./types";

function SiteAdminContent() {
  const { activeNavItemId, setActiveNavItemId } = useSurfaceNav();
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

        {activeTab === "status" && <StatusPanel />}
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
