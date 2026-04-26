import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";

import { useSurfaceNav } from "../../shell/surface-nav-context";
import type { SurfaceNavItem } from "../types";
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

// Decode an active nav item id of the form "posts:my-slug" into a tab +
// slug pair. Plain ids (no colon) decode to null. Used both to derive
// the active tab when the sidebar deep-links into an editor and to
// trigger the corresponding `setSelected({kind:"edit", slug})`.
function decodeNavItemId(
  id: string | null,
): { tab: "posts" | "pages"; slug: string } | null {
  if (!id) return null;
  const colon = id.indexOf(":");
  if (colon < 0) return null;
  const prefix = id.slice(0, colon);
  if (prefix !== "posts" && prefix !== "pages") return null;
  const slug = id.slice(colon + 1);
  if (!slug) return null;
  return { tab: prefix, slug };
}

interface SidebarPageRow {
  slug: string;
  title: string;
}

// Group flat slug rows like ["docs/intro", "docs/api/auth"] into a
// nested SurfaceNavItem tree. Intermediate path segments without their
// own page just appear as folder rows; the leaf row carries the real
// title.
function buildPagesTree(rows: SidebarPageRow[]): SurfaceNavItem[] {
  type Node = {
    id: string;
    label: string;
    children: Map<string, Node>;
  };
  const root = new Map<string, Node>();
  const sorted = rows
    .filter((r) => r.slug)
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug));
  for (const { slug, title } of sorted) {
    const parts = slug.split("/");
    let level = root;
    let path = "";
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      path = path ? `${path}/${part}` : part;
      const isLeaf = i === parts.length - 1;
      let node = level.get(part);
      if (!node) {
        node = {
          id: `pages:${path}`,
          label: isLeaf ? title || part : part,
          children: new Map(),
        };
        level.set(part, node);
      } else if (isLeaf) {
        node.label = title || node.label;
      }
      level = node.children;
    }
  }
  function toItems(level: Map<string, Node>): SurfaceNavItem[] {
    return Array.from(level.values()).map((n) => ({
      id: n.id,
      label: n.label,
      children: n.children.size > 0 ? toItems(n.children) : undefined,
    }));
  }
  return toItems(root);
}

function SiteAdminContent() {
  const { activeNavItemId, setActiveNavItemId, setNavItemChildren } =
    useSurfaceNav();
  const { connection, request } = useSiteAdmin();
  const ready = Boolean(connection.baseUrl) && Boolean(connection.authToken);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Selection state lives in the shell (not the panels) so the command
  // palette can deep-link straight into a specific post/page.
  const [postsSelected, setPostsSelected] = useState<ItemSelection>(null);
  const [pagesSelected, setPagesSelected] = useState<ItemSelection>(null);
  const [postsTree, setPostsTree] = useState<readonly SurfaceNavItem[]>([]);
  const [pagesTree, setPagesTree] = useState<readonly SurfaceNavItem[]>([]);

  const decodedItem = useMemo(
    () => decodeNavItemId(activeNavItemId),
    [activeNavItemId],
  );

  // Narrow the shell-provided id to our tab union. Sidebar children use
  // encoded ids ("posts:my-slug"); decode the prefix into the parent
  // tab so the right panel mounts. Plain ids fall through unchanged.
  const activeTab: SiteAdminTab = useMemo(() => {
    if (decodedItem) return decodedItem.tab;
    return isSiteAdminTab(activeNavItemId)
      ? activeNavItemId
      : SITE_ADMIN_DEFAULT_TAB;
  }, [activeNavItemId, decodedItem]);

  // When the user clicks a sidebar child (posts:slug / pages:slug),
  // open the editor for that slug. The activeNavItemId is what the
  // shell persists; the *Selected state is what the panel renders.
  useEffect(() => {
    if (!decodedItem) return;
    if (decodedItem.tab === "posts") {
      setPostsSelected({ kind: "edit", slug: decodedItem.slug });
    } else if (decodedItem.tab === "pages") {
      setPagesSelected({ kind: "edit", slug: decodedItem.slug });
    }
  }, [decodedItem]);

  // Eager-fetch the posts + pages indexes once we have credentials so
  // the sidebar tree shows up without first visiting the Posts/Pages
  // tabs. Two parallel calls — failures are silent (the sidebar just
  // stays collapsed).
  useEffect(() => {
    if (!ready) {
      setPostsTree([]);
      setPagesTree([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [postsResp, pagesResp] = await Promise.all([
        request("/api/site-admin/posts?drafts=1", "GET"),
        request("/api/site-admin/pages?drafts=1", "GET"),
      ]);
      if (cancelled) return;
      if (postsResp.ok) {
        const data = (postsResp.data ?? {}) as Record<string, unknown>;
        const rows = Array.isArray(data.posts) ? data.posts : [];
        const items: SurfaceNavItem[] = [];
        for (const raw of rows) {
          if (!raw || typeof raw !== "object") continue;
          const obj = raw as Record<string, unknown>;
          const slug = typeof obj.slug === "string" ? obj.slug : "";
          if (!slug) continue;
          const title = typeof obj.title === "string" ? obj.title : slug;
          items.push({ id: `posts:${slug}`, label: title });
        }
        setPostsTree(items);
      }
      if (pagesResp.ok) {
        const data = (pagesResp.data ?? {}) as Record<string, unknown>;
        const rows = Array.isArray(data.pages) ? data.pages : [];
        const flat: SidebarPageRow[] = [];
        for (const raw of rows) {
          if (!raw || typeof raw !== "object") continue;
          const obj = raw as Record<string, unknown>;
          const slug = typeof obj.slug === "string" ? obj.slug : "";
          if (!slug) continue;
          const title = typeof obj.title === "string" ? obj.title : slug;
          flat.push({ slug, title });
        }
        setPagesTree(buildPagesTree(flat));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, request]);

  // Push trees up to the App-level nav state so Sidebar can render
  // them under the static "Posts" / "Pages" rows.
  useEffect(() => {
    setNavItemChildren("posts", postsTree.length > 0 ? postsTree : null);
  }, [postsTree, setNavItemChildren]);
  useEffect(() => {
    setNavItemChildren("pages", pagesTree.length > 0 ? pagesTree : null);
  }, [pagesTree, setNavItemChildren]);

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
