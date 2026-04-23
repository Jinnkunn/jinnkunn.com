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
import { PagesPanel } from "./PagesPanel";
import { PostsPanel } from "./PostsPanel";
import { RoutesPanel } from "./RoutesPanel";
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
      { id: "posts", label: "Posts", Icon: PostsIcon },
      { id: "pages", label: "Pages", Icon: PagesIcon },
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

  // Global ⌘K / Ctrl+K opens the command palette. CodeMirror binds Mod-k
  // at Prec.high for "insert link" inside the editor and stops propagation,
  // so this window-level listener only fires when focus is outside the
  // editor — exactly the behavior we want.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "k") return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.shiftKey || event.altKey) return;
      event.preventDefault();
      setPaletteOpen((open) => !open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
