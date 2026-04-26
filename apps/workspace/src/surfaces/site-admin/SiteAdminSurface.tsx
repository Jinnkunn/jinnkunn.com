import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { SiteAdminProvider, useSiteAdmin, type PostsGrouping } from "./state";
import type { ItemSelection, SiteAdminTab } from "./types";

const HomePanel = lazy(() =>
  import("./HomePanel").then((module) => ({ default: module.HomePanel })),
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
const SettingsPanel = lazy(() =>
  import("./SettingsPanel").then((module) => ({ default: module.SettingsPanel })),
);
const StatusPanel = lazy(() =>
  import("./StatusPanel").then((module) => ({ default: module.StatusPanel })),
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
  version: string;
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
      // Folders (intermediate path segments) get the "+" affordance so
      // users can create a sub-page under that prefix; leaves don't —
      // pages don't nest beyond a single slug-derived hierarchy.
      canAddChild: n.children.size > 0,
      // Every page row is a drag source; both leaves and folders are
      // valid drop targets. Dropping A onto B reparents A under B.
      // Dropping onto the static "Pages" parent (handled separately
      // below) reparents to root.
      draggable: true,
      droppable: true,
      children: n.children.size > 0 ? toItems(n.children) : undefined,
    }));
  }
  return toItems(root);
}

// Mirrors lib/posts/slug.ts — kept inline because the server-side
// validator lives outside the workspace bundle. Regex copy is fine;
// the slug rules are stable.
const POST_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

function isValidPostSlugClient(slug: string): boolean {
  return typeof slug === "string" && POST_SLUG_RE.test(slug);
}

// Mirrors lib/pages/slug.ts — same rules per segment plus "/" join up
// to 4 segments deep.
const PAGE_SEGMENT_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
const PAGE_MAX_DEPTH = 4;

function isValidPageSlugClient(slug: string): boolean {
  if (typeof slug !== "string" || !slug) return false;
  if (slug.startsWith("/") || slug.endsWith("/") || slug.includes("//")) {
    return false;
  }
  const parts = slug.split("/");
  if (parts.length > PAGE_MAX_DEPTH) return false;
  return parts.every((part) => PAGE_SEGMENT_RE.test(part));
}

interface SidebarPostRow {
  slug: string;
  title: string;
  draft: boolean;
  dateIso: string;
  version: string;
}

// Apply the current sidebar grouping to a flat post list. "all" returns
// a flat tree (one row per post). "drafts" / "published" filter by the
// draft flag but stay flat. "by-year" extracts the year from dateIso
// (or "Undated" when missing) and produces one folder per year newest
// first; posts within each year are date-desc.
function buildPostsTree(
  rows: SidebarPostRow[],
  grouping: PostsGrouping,
): SurfaceNavItem[] {
  const filtered =
    grouping === "drafts"
      ? rows.filter((r) => r.draft)
      : grouping === "published"
        ? rows.filter((r) => !r.draft)
        : rows.slice();
  if (grouping !== "by-year") {
    return filtered.map((r) => ({
      id: `posts:${r.slug}`,
      label: r.title || r.slug,
      // Posts are draggable so the rename ✎ shows up. Drag-reparent is
      // not meaningful for posts (they're flat), but the inline rename
      // affordance is — Sidebar gates ✎ on `draggable`.
      draggable: true,
    }));
  }
  // "by-year": group by 4-digit year extracted from dateIso. Years sort
  // newest first; posts inside each year sort newest first within their
  // year too.
  const buckets = new Map<string, SidebarPostRow[]>();
  for (const row of filtered) {
    const yearMatch = /^(\d{4})/.exec(row.dateIso);
    const year = yearMatch ? yearMatch[1] : "Undated";
    const arr = buckets.get(year);
    if (arr) arr.push(row);
    else buckets.set(year, [row]);
  }
  const orderedYears = Array.from(buckets.keys()).sort((a, b) => {
    if (a === "Undated") return 1;
    if (b === "Undated") return -1;
    return b.localeCompare(a);
  });
  return orderedYears.map((year) => {
    const items = (buckets.get(year) ?? [])
      .sort((a, b) => b.dateIso.localeCompare(a.dateIso))
      .map((r) => ({
        id: `posts:${r.slug}`,
        label: r.title || r.slug,
        draggable: true,
      }));
    return {
      id: `posts-year:${year}`,
      label: year,
      children: items,
    };
  });
}

function SiteAdminContent() {
  const {
    activeNavItemId,
    setActiveNavItemId,
    setNavItemChildren,
    setMoveNavItemHandler,
    setRenameNavItemHandler,
    setRenameValidator,
  } = useSurfaceNav();
  const {
    bumpContentRevision,
    connection,
    contentRevision,
    postsGrouping,
    request,
    setMessage,
  } = useSiteAdmin();
  const ready = Boolean(connection.baseUrl) && Boolean(connection.authToken);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Selection state lives in the shell (not the panels) so the command
  // palette can deep-link straight into a specific post/page.
  const [postsSelected, setPostsSelected] = useState<ItemSelection>(null);
  const [pagesSelected, setPagesSelected] = useState<ItemSelection>(null);
  const [sidebarPostRows, setSidebarPostRows] = useState<SidebarPostRow[]>([]);
  const [pageRows, setPageRows] = useState<SidebarPageRow[]>([]);
  const [pagesTree, setPagesTree] = useState<readonly SurfaceNavItem[]>([]);

  // Derived tree applies the current grouping setting to the cached
  // post rows. Cheap enough to recompute on every grouping change; no
  // need to refetch.
  const postsTree = useMemo(
    () => buildPostsTree(sidebarPostRows, postsGrouping),
    [sidebarPostRows, postsGrouping],
  );

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

  // Synthetic "add:<itemId>" ids fired by the sidebar's "+" button.
  // Decode and dispatch to the appropriate New flow, then bounce the
  // active id back to the parent tab so the magic id doesn't stick in
  // localStorage. A ref prevents the effect from re-firing on the
  // bounce-back.
  const lastHandledAddRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeNavItemId?.startsWith("add:")) return;
    if (lastHandledAddRef.current === activeNavItemId) return;
    lastHandledAddRef.current = activeNavItemId;
    const target = activeNavItemId.slice("add:".length);
    if (target === "posts") {
      setActiveNavItemId("posts");
      setPostsSelected({ kind: "new" });
      return;
    }
    if (target === "pages") {
      setActiveNavItemId("pages");
      setPagesSelected({ kind: "new" });
      return;
    }
    if (target.startsWith("pages:")) {
      const prefix = target.slice("pages:".length);
      setActiveNavItemId("pages");
      setPagesSelected({
        kind: "new",
        initialSlug: prefix ? `${prefix}/` : undefined,
      });
      return;
    }
  }, [activeNavItemId, setActiveNavItemId]);

  // Eager-fetch the posts + pages indexes once we have credentials so
  // the sidebar tree shows up without first visiting the Posts/Pages
  // tabs. Two parallel calls — failures are silent (the sidebar just
  // stays collapsed).
  useEffect(() => {
    if (!ready) {
      setSidebarPostRows([]);
      setPageRows([]);
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
        const out: SidebarPostRow[] = [];
        for (const raw of rows) {
          if (!raw || typeof raw !== "object") continue;
          const obj = raw as Record<string, unknown>;
          const slug = typeof obj.slug === "string" ? obj.slug : "";
          if (!slug) continue;
          const title = typeof obj.title === "string" ? obj.title : slug;
          const draft = obj.draft === true;
          const dateIso = typeof obj.dateIso === "string" ? obj.dateIso : "";
          const version = typeof obj.version === "string" ? obj.version : "";
          out.push({ slug, title, draft, dateIso, version });
        }
        setSidebarPostRows(out);
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
          const version = typeof obj.version === "string" ? obj.version : "";
          flat.push({ slug, title, version });
        }
        setPageRows(flat);
        setPagesTree(buildPagesTree(flat));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, request, contentRevision]);

  // Push trees up to the App-level nav state so Sidebar can render
  // them under the static "Posts" / "Pages" rows.
  useEffect(() => {
    setNavItemChildren("posts", postsTree.length > 0 ? postsTree : null);
  }, [postsTree, setNavItemChildren]);
  useEffect(() => {
    setNavItemChildren("pages", pagesTree.length > 0 ? pagesTree : null);
  }, [pagesTree, setNavItemChildren]);

  // Drag-reparent handler: Sidebar fires (fromId, toId) with sidebar
  // ids like "pages:docs/intro" and "pages" (the static root). Decode
  // both into slugs, build the target slug from target prefix + dragged
  // leaf, look up the dragged page's version, POST to /move, and bump
  // contentRevision on success so the eager-fetch refreshes the tree.
  useEffect(() => {
    setMoveNavItemHandler(async (fromId, toId) => {
      if (!fromId.startsWith("pages:")) return;
      const fromSlug = fromId.slice("pages:".length);
      const draggedRow = pageRows.find((r) => r.slug === fromSlug);
      if (!draggedRow) {
        setMessage("error", `Couldn't find page metadata for ${fromSlug}.`);
        return;
      }
      const leaf = fromSlug.includes("/")
        ? fromSlug.slice(fromSlug.lastIndexOf("/") + 1)
        : fromSlug;
      let toSlug: string;
      if (toId === "pages") {
        toSlug = leaf;
      } else if (toId.startsWith("pages:")) {
        const targetSlug = toId.slice("pages:".length);
        // If the user drops onto the page itself, no-op (Sidebar already
        // guards same-id, but a leaf can technically equal the dragged
        // row's parent prefix in degenerate cases).
        if (targetSlug === fromSlug) return;
        // If the target is the same parent as the source, the slug
        // wouldn't change — skip the API call.
        const targetIsAncestorOfSource =
          fromSlug === targetSlug ||
          fromSlug.startsWith(`${targetSlug}/`);
        if (targetIsAncestorOfSource) {
          setMessage(
            "warn",
            "That move would orphan the page under itself — try dropping somewhere else.",
          );
          return;
        }
        toSlug = `${targetSlug}/${leaf}`;
      } else {
        return;
      }
      if (toSlug === fromSlug) return;
      const response = await request("/api/site-admin/pages/move", "POST", {
        fromSlug,
        toSlug,
        version: draggedRow.version,
      });
      if (!response.ok) {
        setMessage(
          "error",
          `Move failed: ${response.code}: ${response.error}`,
        );
        return;
      }
      setMessage("success", `Moved ${fromSlug} → ${toSlug}`);
      bumpContentRevision();
      // Switch the active nav item to the new id so highlight follows.
      setActiveNavItemId(`pages:${toSlug}`);
    });
    return () => setMoveNavItemHandler(null);
  }, [
    bumpContentRevision,
    pageRows,
    request,
    setActiveNavItemId,
    setMessage,
    setMoveNavItemHandler,
  ]);

  // Inline rename handler. Decodes the row id ("posts:hello" or
  // "pages:docs/intro") and POSTs the corresponding /move endpoint.
  // The user typed the new slug verbatim; the server validates.
  useEffect(() => {
    setRenameNavItemHandler(async (itemId, newSlug) => {
      const cleaned = newSlug.trim();
      if (!cleaned) return;
      if (itemId.startsWith("posts:")) {
        const fromSlug = itemId.slice("posts:".length);
        if (fromSlug === cleaned) return;
        const row = sidebarPostRows.find((r) => r.slug === fromSlug);
        if (!row) {
          setMessage("error", `Couldn't find post metadata for ${fromSlug}.`);
          return;
        }
        const response = await request("/api/site-admin/posts/move", "POST", {
          fromSlug,
          toSlug: cleaned,
          version: row.version,
        });
        if (!response.ok) {
          setMessage("error", `Rename failed: ${response.code}: ${response.error}`);
          return;
        }
        setMessage("success", `Renamed ${fromSlug} → ${cleaned}`);
        bumpContentRevision();
        setActiveNavItemId(`posts:${cleaned}`);
        return;
      }
      if (itemId.startsWith("pages:")) {
        const fromSlug = itemId.slice("pages:".length);
        if (fromSlug === cleaned) return;
        const row = pageRows.find((r) => r.slug === fromSlug);
        if (!row) {
          setMessage("error", `Couldn't find page metadata for ${fromSlug}.`);
          return;
        }
        const response = await request("/api/site-admin/pages/move", "POST", {
          fromSlug,
          toSlug: cleaned,
          version: row.version,
        });
        if (!response.ok) {
          setMessage("error", `Rename failed: ${response.code}: ${response.error}`);
          return;
        }
        setMessage("success", `Renamed ${fromSlug} → ${cleaned}`);
        bumpContentRevision();
        setActiveNavItemId(`pages:${cleaned}`);
      }
    });
    return () => setRenameNavItemHandler(null);
  }, [
    bumpContentRevision,
    pageRows,
    request,
    setActiveNavItemId,
    setMessage,
    setRenameNavItemHandler,
    sidebarPostRows,
  ]);

  // Live-validate the rename input against the slug rules so users see
  // an inline error before they hit Enter. Cheap pure-function check
  // — runs on every keystroke. Validator dispatch is dead simple
  // (prefix-driven) since posts and pages have separate rules.
  useEffect(() => {
    setRenameValidator((itemId, newSlug) => {
      const trimmed = newSlug.trim();
      if (!trimmed) return "Slug cannot be empty";
      if (itemId.startsWith("posts:")) {
        if (!isValidPostSlugClient(trimmed)) {
          return "1–60 chars: lowercase letters, digits, dashes (no leading/trailing dash)";
        }
        const fromSlug = itemId.slice("posts:".length);
        if (trimmed !== fromSlug && sidebarPostRows.some((r) => r.slug === trimmed)) {
          return `A post already exists at "${trimmed}"`;
        }
        return null;
      }
      if (itemId.startsWith("pages:")) {
        if (!isValidPageSlugClient(trimmed)) {
          return "Each segment 1–60 lowercase chars, separated by '/' (max 4 levels)";
        }
        const fromSlug = itemId.slice("pages:".length);
        if (trimmed !== fromSlug && pageRows.some((r) => r.slug === trimmed)) {
          return `A page already exists at "${trimmed}"`;
        }
        return null;
      }
      return null;
    });
    return () => setRenameValidator(null);
  }, [pageRows, setRenameValidator, sidebarPostRows]);

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
              {activeTab === "settings" && <SettingsPanel />}
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
