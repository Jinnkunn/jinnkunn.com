import { useCallback, useEffect, useState } from "react";
import {
  ConfigIcon,
  PagesIcon,
  PostsIcon,
  RoutesIcon,
  StatusIcon,
} from "../icons";
import { CommandPalette } from "./CommandPalette";
import { ConfigPanel } from "./ConfigPanel";
import { MessageBar } from "./MessageBar";
import { NewsPanel } from "./NewsPanel";
import { PagesPanel } from "./PagesPanel";
import { PostsPanel } from "./PostsPanel";
import { PublicationsPanel } from "./PublicationsPanel";
import { RoutesPanel } from "./RoutesPanel";
import { HomePanel } from "./HomePanel";
import { TeachingPanel } from "./TeachingPanel";
import { WorksPanel } from "./WorksPanel";
import { SiteAdminDevDrawer } from "./SiteAdminDevDrawer";
import {
  SiteAdminSidebar,
  type SiteAdminSectionDef,
  type SiteAdminTab,
} from "./SiteAdminSidebar";
import { SiteAdminTopBar } from "./SiteAdminTopBar";
import { SiteAdminProvider } from "./state";
import { StatusPanel } from "./StatusPanel";
import type { ItemSelection } from "./types";

// Grouped into three buckets so the sidebar communicates intent:
//   Content → day-to-day authoring
//   Site    → configuration that tunes the public site
//   Ops     → runtime / deployment health
const SECTIONS: readonly SiteAdminSectionDef[] = [
  {
    id: "content",
    label: "Content",
    items: [
      { id: "home", label: "Home", Icon: PagesIcon },
      { id: "posts", label: "Posts", Icon: PostsIcon },
      { id: "pages", label: "Pages", Icon: PagesIcon },
      { id: "publications", label: "Publications", Icon: PagesIcon },
      { id: "news", label: "News", Icon: PagesIcon },
      { id: "teaching", label: "Teaching", Icon: PagesIcon },
      { id: "works", label: "Works", Icon: PagesIcon },
    ],
  },
  {
    id: "site",
    label: "Site",
    items: [
      { id: "config", label: "Settings & Navigation", Icon: ConfigIcon },
      { id: "routes", label: "Routes", Icon: RoutesIcon },
    ],
  },
  {
    id: "ops",
    label: "Ops",
    items: [{ id: "status", label: "Status", Icon: StatusIcon }],
  },
];

function SiteAdminContent() {
  const [activeTab, setActiveTab] = useState<SiteAdminTab>("status");
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Selection state lives in the shell (not the panels) so the command
  // palette can deep-link straight into a specific post/page.
  const [postsSelected, setPostsSelected] = useState<ItemSelection>(null);
  const [pagesSelected, setPagesSelected] = useState<ItemSelection>(null);

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
  const selectTab = useCallback((tab: SiteAdminTab) => setActiveTab(tab), []);

  const openPost = useCallback((slug: string) => {
    setActiveTab("posts");
    setPostsSelected({ kind: "edit", slug });
  }, []);
  const openPage = useCallback((slug: string) => {
    setActiveTab("pages");
    setPagesSelected({ kind: "edit", slug });
  }, []);
  const newPost = useCallback(() => {
    setActiveTab("posts");
    setPostsSelected({ kind: "new" });
  }, []);
  const newPage = useCallback(() => {
    setActiveTab("pages");
    setPagesSelected({ kind: "new" });
  }, []);

  return (
    <div className="site-admin-shell">
      <SiteAdminTopBar sections={SECTIONS} activeTab={activeTab} />
      <div className="site-admin-layout">
        <SiteAdminSidebar
          sections={SECTIONS}
          activeTab={activeTab}
          onSelect={setActiveTab}
        />
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
