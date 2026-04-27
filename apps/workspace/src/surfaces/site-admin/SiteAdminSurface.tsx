import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSurfaceNav } from "../../shell/surface-nav-context";
import type { SurfaceNavItem } from "../types";
import { CommandPalette } from "./CommandPalette";
import type { ComponentName } from "./ComponentEditor";
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
import type {
  ItemSelection,
  PageListRow,
  PostListRow,
  SiteAdminTab,
} from "./types";
import { normalizePageListRow, normalizePostListRow } from "./utils";
import { SITE_COMPONENT_NAMES } from "../../../../../lib/site-admin/component-registry.ts";

const ComponentsPanel = lazy(() =>
  import("./ComponentsPanel").then((module) => ({
    default: module.ComponentsPanel,
  })),
);
const HomePanel = lazy(() =>
  import("./HomePanel").then((module) => ({ default: module.HomePanel })),
);
const PagesPanel = lazy(() =>
  import("./PagesPanel").then((module) => ({ default: module.PagesPanel })),
);
const PostsPanel = lazy(() =>
  import("./PostsPanel").then((module) => ({ default: module.PostsPanel })),
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

type DecodedNavItem =
  | { tab: "posts" | "pages"; slug: string }
  | { tab: "components"; name: ComponentName };

const COMPONENT_NAMES: readonly ComponentName[] = SITE_COMPONENT_NAMES;

function isComponentName(value: string): value is ComponentName {
  return (COMPONENT_NAMES as readonly string[]).includes(value);
}

// Decode an active nav item id of the form "posts:my-slug" / "pages:..."
// / "components:news" into a tab + payload pair. Plain ids (no colon)
// decode to null. Used both to derive the active tab when the sidebar
// deep-links into an editor and to trigger the corresponding selection
// state on the panel.
function decodeNavItemId(id: string | null): DecodedNavItem | null {
  if (!id) return null;
  const colon = id.indexOf(":");
  if (colon < 0) return null;
  const prefix = id.slice(0, colon);
  const tail = id.slice(colon + 1);
  if (!tail) return null;
  if (prefix === "posts" || prefix === "pages") {
    return { tab: prefix, slug: tail };
  }
  if (prefix === "components" && isComponentName(tail)) {
    return { tab: "components", name: tail };
  }
  return null;
}

// Group flat slug rows like ["docs/intro", "docs/api/auth"] into a
// nested SurfaceNavItem tree. Intermediate path segments without their
// own page just appear as folder rows; the leaf row carries the real
// title.
function normalizePageOrderSlugs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const slug = item.trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

function orderedPageSlugs(rows: PageListRow[], savedOrder: string[]): string[] {
  const known = new Set(rows.map((row) => row.slug));
  const ordered = savedOrder.filter((slug) => known.has(slug));
  const orderedSet = new Set(ordered);
  const appended = rows
    .map((row) => row.slug)
    .filter((slug) => slug && !orderedSet.has(slug))
    .sort((a, b) => a.localeCompare(b));
  return [...ordered, ...appended];
}

function sortPagesForTree(rows: PageListRow[], savedOrder: string[]): PageListRow[] {
  const orderedSlugs = orderedPageSlugs(rows, savedOrder);
  const index = new Map(orderedSlugs.map((slug, i) => [slug, i]));
  return rows
    .filter((r) => r.slug)
    .slice()
    .sort((a, b) => {
      const ai = index.get(a.slug);
      const bi = index.get(b.slug);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return a.slug.localeCompare(b.slug);
    });
}

function remapSavedPageOrder(
  currentOrder: string[],
  rows: PageListRow[],
  replacement?: { fromSlug: string; toSlug: string },
): string[] {
  const nextRows = rows.map((row) =>
    replacement && row.slug === replacement.fromSlug
      ? { ...row, slug: replacement.toSlug }
      : row,
  );
  const saved = replacement
    ? currentOrder.map((slug) =>
        slug === replacement.fromSlug ? replacement.toSlug : slug,
      )
    : currentOrder;
  return orderedPageSlugs(nextRows, saved);
}

function sameStringList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

type PageOrderNode = {
  childMap: Map<string, PageOrderNode>;
  children: PageOrderNode[];
  hasPage: boolean;
  slug: string;
};

function buildPageOrderNodes(
  rows: PageListRow[],
  savedOrder: string[],
): PageOrderNode[] {
  const root: PageOrderNode[] = [];
  const rootMap = new Map<string, PageOrderNode>();
  const sorted = sortPagesForTree(rows, savedOrder);

  for (const row of sorted) {
    const parts = row.slug.split("/");
    let level = root;
    let levelMap = rootMap;
    let path = "";
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      path = path ? `${path}/${part}` : part;
      const isLeaf = index === parts.length - 1;
      let node = levelMap.get(part);
      if (!node) {
        node = {
          childMap: new Map(),
          children: [],
          hasPage: isLeaf,
          slug: path,
        };
        levelMap.set(part, node);
        level.push(node);
      } else if (isLeaf) {
        node.hasPage = true;
      }
      level = node.children;
      levelMap = node.childMap;
    }
  }
  return root;
}

function findSiblingNodes(
  nodes: PageOrderNode[],
  slug: string,
): PageOrderNode[] | null {
  for (const node of nodes) {
    if (node.slug === slug) return nodes;
    const nested = findSiblingNodes(node.children, slug);
    if (nested) return nested;
  }
  return null;
}

function flattenPageOrder(nodes: PageOrderNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.hasPage) out.push(node.slug);
    flattenPageOrder(node.children, out);
  }
  return out;
}

function reorderPageWithinSiblings(
  rows: PageListRow[],
  savedOrder: string[],
  slug: string,
  direction: "up" | "down",
): string[] | null {
  if (!rows.some((row) => row.slug === slug)) return null;
  const tree = buildPageOrderNodes(rows, savedOrder);
  const siblings = findSiblingNodes(tree, slug);
  if (!siblings) return null;
  const from = siblings.findIndex((node) => node.slug === slug);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= siblings.length) return null;
  [siblings[from], siblings[to]] = [siblings[to], siblings[from]];
  return flattenPageOrder(tree);
}

function buildPagesTree(rows: PageListRow[], savedOrder: string[] = []): SurfaceNavItem[] {
  type Node = {
    hasPage: boolean;
    id: string;
    label: string;
    children: Map<string, Node>;
  };
  const root = new Map<string, Node>();
  const sorted = sortPagesForTree(rows, savedOrder);
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
          hasPage: isLeaf,
          id: `pages:${path}`,
          label: isLeaf ? title || part : part,
          children: new Map(),
        };
        level.set(part, node);
      } else if (isLeaf) {
        node.hasPage = true;
        node.label = title || node.label;
      }
      level = node.children;
    }
  }
  function toItems(level: Map<string, Node>): SurfaceNavItem[] {
    return Array.from(level.values()).map((n) => ({
      id: n.id,
      label: n.label,
      selectable: n.hasPage,
      // Notion-style sub-pages: every page row gets the "+" affordance
      // so the user can add a sub-page under any leaf or folder. The
      // surface decodes "add:pages:<prefix>" into a fresh PageEditor
      // pre-filled with `<prefix>/`, and the slug rules cap the
      // hierarchy at PAGE_MAX_DEPTH (= 4 segments). Older versions
      // gated this on `n.children.size > 0`, which only let you add
      // children to existing folders — surprising once we wanted real
      // page trees.
      canAddChild: true,
      // Every page row is a drag source; both leaves and folders are
      // valid drop targets. Dropping A onto B reparents A under B.
      // Dropping onto the Home parent (handled separately below)
      // reparents to root.
      draggable: n.hasPage,
      droppable: true,
      orderable: n.hasPage,
      children: n.children.size > 0 ? toItems(n.children) : undefined,
    }));
  }
  return toItems(root);
}

// Mirrors lib/posts/slug.ts — kept inline because the server-side
// validator lives outside the workspace bundle. Regex copy is fine;
// the slug rules are stable.
const POST_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/;

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

// Apply the current sidebar grouping to a flat post list. "all" returns
// a flat tree (one row per post). "drafts" / "published" filter by the
// draft flag but stay flat. "by-year" extracts the year from dateIso
// (or "Undated" when missing) and produces one folder per year newest
// first; posts within each year are date-desc.
function buildPostsTree(
  rows: PostListRow[],
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
  // year too. dateIso is nullable on PostListRow — undated posts land
  // in the "Undated" bucket which sinks to the bottom.
  const buckets = new Map<string, PostListRow[]>();
  for (const row of filtered) {
    const iso = row.dateIso ?? "";
    const yearMatch = /^(\d{4})/.exec(iso);
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
      .sort((a, b) => (b.dateIso ?? "").localeCompare(a.dateIso ?? ""))
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
    setReorderNavItemHandler,
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
    setPagesIndex,
    setPostsIndex,
  } = useSiteAdmin();
  const ready = Boolean(connection.baseUrl) && Boolean(connection.authToken);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Selection state lives in the shell (not the panels) so the command
  // palette can deep-link straight into a specific post/page.
  const [postsSelected, setPostsSelected] = useState<ItemSelection>(null);
  const [pagesSelected, setPagesSelected] = useState<ItemSelection>(null);
  // Components panel only ever shows one component at a time; the
  // sidebar leaf id ("components:news") drives this state via
  // decodeNavItemId.
  const [componentsSelected, setComponentsSelected] =
    useState<ComponentName | null>(null);
  // Cached post / page rows — drive both the sidebar tree and the
  // command palette index. Phase 2 dropped the panel-local lists so
  // these are now the only fetch.
  const [postRows, setPostRows] = useState<PostListRow[]>([]);
  const [pageRows, setPageRows] = useState<PageListRow[]>([]);
  const [pagesTree, setPagesTree] = useState<readonly SurfaceNavItem[]>([]);
  const [pageIndexLoaded, setPageIndexLoaded] = useState(false);
  const [pageOrderSlugs, setPageOrderSlugs] = useState<string[]>([]);
  const [pageTreeFileSha, setPageTreeFileSha] = useState("");
  const [pageTreeConflict, setPageTreeConflict] = useState(false);

  // Derived tree applies the current grouping setting to the cached
  // post rows. Cheap enough to recompute on every grouping change; no
  // need to refetch.
  const postsTree = useMemo(
    () => buildPostsTree(postRows, postsGrouping),
    [postRows, postsGrouping],
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

  // When the user clicks a sidebar child (posts:slug / pages:slug /
  // components:news), open the editor for that target. The
  // activeNavItemId is what the shell persists; the *Selected state
  // is what the panel renders.
  /* eslint-disable react-hooks/set-state-in-effect -- Sidebar ids are persisted shell state; editor selections intentionally mirror that external state. */
  useEffect(() => {
    if (!decodedItem) return;
    if (decodedItem.tab === "posts") {
      setPostsSelected({ kind: "edit", slug: decodedItem.slug });
    } else if (decodedItem.tab === "pages") {
      if (!pageIndexLoaded) return;
      if (pageRows.some((row) => row.slug === decodedItem.slug)) {
        setPagesSelected({ kind: "edit", slug: decodedItem.slug });
      } else {
        setPagesSelected(null);
        if (activeNavItemId === `pages:${decodedItem.slug}`) {
          setActiveNavItemId("pages");
        }
      }
    } else if (decodedItem.tab === "components") {
      setComponentsSelected(decodedItem.name);
    }
  }, [activeNavItemId, decodedItem, pageIndexLoaded, pageRows, setActiveNavItemId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Synthetic "add:<itemId>" ids fired by the sidebar's "+" button.
  // Decode and dispatch to the appropriate New flow, then bounce the
  // active id back to the parent tab so the magic id doesn't stick in
  // localStorage. A ref prevents the effect from re-firing on the
  // bounce-back.
  const lastHandledAddRef = useRef<string | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- Synthetic add ids are a sidebar event channel that must be consumed and reset synchronously. */
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
    // "+" on the Home row → create a new page at root. Home replaced
    // the old "pages" parent as the page-tree's root affordance.
    if (target === "home") {
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
  /* eslint-enable react-hooks/set-state-in-effect */

  // Eager-fetch the posts + pages indexes once we have credentials.
  // This is the single source for both the sidebar tree (Phase 1) and
  // the command palette index — Phase 2 deleted the panel-local list
  // that used to populate the palette. Two parallel calls; failures
  // are silent (the sidebar just stays collapsed, palette empty).
  /* eslint-disable react-hooks/set-state-in-effect -- Ready changes invalidate the cached admin indexes before the async refetch repopulates them. */
  useEffect(() => {
    if (!ready) {
      setPostRows([]);
      setPageRows([]);
      setPagesTree([]);
      setPageIndexLoaded(false);
      setPageOrderSlugs([]);
      setPageTreeFileSha("");
      setPageTreeConflict(false);
      setPostsIndex([]);
      setPagesIndex([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [postsResp, pagesResp, pageTreeResp] = await Promise.all([
        request("/api/site-admin/posts?drafts=1", "GET"),
        request("/api/site-admin/pages?drafts=1", "GET"),
        request("/api/site-admin/pages/tree", "GET"),
      ]);
      if (cancelled) return;
      let fetchedPageOrder: string[] = [];
      if (pageTreeResp.ok) {
        const data = (pageTreeResp.data ?? {}) as Record<string, unknown>;
        fetchedPageOrder = normalizePageOrderSlugs(data.slugs);
        const sourceVersion = (data.sourceVersion ?? {}) as { fileSha?: unknown };
        setPageTreeFileSha(
          typeof sourceVersion.fileSha === "string" ? sourceVersion.fileSha : "",
        );
        setPageOrderSlugs(fetchedPageOrder);
        setPageTreeConflict(false);
      } else {
        setPageTreeFileSha("");
        setPageOrderSlugs([]);
        setPageTreeConflict(false);
      }
      if (postsResp.ok) {
        const data = (postsResp.data ?? {}) as Record<string, unknown>;
        const raw = Array.isArray(data.posts) ? data.posts : [];
        const parsed: PostListRow[] = [];
        for (const r of raw) {
          const row = normalizePostListRow(r);
          if (row) parsed.push(row);
        }
        setPostRows(parsed);
        setPostsIndex(parsed);
      }
      if (pagesResp.ok) {
        const data = (pagesResp.data ?? {}) as Record<string, unknown>;
        const raw = Array.isArray(data.pages) ? data.pages : [];
        const parsed: PageListRow[] = [];
        for (const r of raw) {
          const row = normalizePageListRow(r);
          if (row) parsed.push(row);
        }
        const completeOrder = orderedPageSlugs(parsed, fetchedPageOrder);
        setPageRows(parsed);
        setPagesTree(buildPagesTree(parsed, completeOrder));
        setPagesIndex(parsed);
      }
      setPageIndexLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, request, contentRevision, setPostsIndex, setPagesIndex]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const savePageOrder = useCallback(
    async (slugs: string[], expectedFileSha = pageTreeFileSha) => {
      if (pageTreeConflict) {
        setMessage("warn", "Page tree is in conflict state. Reload latest before saving order.");
        return false;
      }
      const normalized = normalizePageOrderSlugs(slugs);
      const response = await request("/api/site-admin/pages/tree", "POST", {
        slugs: normalized,
        expectedFileSha,
      });
      if (!response.ok) {
        if (response.code === "SOURCE_CONFLICT" || response.status === 409) {
          setPageTreeConflict(true);
          setMessage(
            "warn",
            "Page tree order changed on the server. Reload pages before saving order again.",
          );
          return false;
        }
        setMessage("error", `Save page tree failed: ${response.code}: ${response.error}`);
        return false;
      }
      const data = (response.data ?? {}) as Record<string, unknown>;
      const sourceVersion = (data.sourceVersion ?? {}) as { fileSha?: unknown };
      setPageOrderSlugs(normalized);
      setPagesTree(buildPagesTree(pageRows, normalized));
      setPageTreeConflict(false);
      if (typeof sourceVersion.fileSha === "string") {
        setPageTreeFileSha(sourceVersion.fileSha);
      }
      return true;
    },
    [pageRows, pageTreeConflict, pageTreeFileSha, request, setMessage],
  );

  const handlePageMutation = useCallback(
    (action: "saved" | "deleted", slug?: string) => {
      if (!slug) return;
      const baseOrder = orderedPageSlugs(pageRows, pageOrderSlugs);
      const nextOrder =
        action === "deleted"
          ? baseOrder.filter((item) => item !== slug)
          : baseOrder.includes(slug)
            ? baseOrder
            : [...baseOrder, slug];
      if (sameStringList(baseOrder, nextOrder)) return;
      void savePageOrder(nextOrder);
    },
    [pageOrderSlugs, pageRows, savePageOrder],
  );

  // Build the unified Home tree. Home is the only top-level item under
  // Content; underneath it the sidebar shows:
  //   - "Blog" (id "posts") — a virtual parent whose children are the
  //     real post leaves. Clicking the row routes to the Posts panel.
  //   - one row per standalone page (about, bio, etc.) at the top
  //     level, plus nested folders for hierarchical slugs.
  // App.tsx merges children only at the top-level `home` item — it
  // doesn't recurse — so we pre-assemble Blog's children inline rather
  // than calling setNavItemChildren("posts", ...) separately.
  const homeChildren = useMemo<readonly SurfaceNavItem[]>(() => {
    const blog: SurfaceNavItem = {
      id: "posts",
      label: "Blog",
      // No icon — Blog sits among the page leaves (which are also
      // icon-less) under Home; an icon would single it out
      // visually when it's just one of the children.
      // "+" on Blog creates a new post (the surface decodes
      // "add:posts" into a fresh PostEditor).
      canAddChild: true,
      children: postsTree.length > 0 ? postsTree : undefined,
    };
    return [blog, ...pagesTree];
  }, [postsTree, pagesTree]);

  useEffect(() => {
    setNavItemChildren(
      "home",
      homeChildren.length > 0 ? homeChildren : null,
    );
  }, [homeChildren, setNavItemChildren]);

  useEffect(() => {
    setReorderNavItemHandler(async (itemId, direction) => {
      if (!itemId.startsWith("pages:")) return;
      if (pageTreeConflict) {
        setMessage("warn", "Page tree is in conflict state. Reload latest before sorting.");
        return;
      }
      const slug = itemId.slice("pages:".length);
      const nextOrder = reorderPageWithinSiblings(
        pageRows,
        pageOrderSlugs,
        slug,
        direction,
      );
      if (!nextOrder || sameStringList(nextOrder, orderedPageSlugs(pageRows, pageOrderSlugs))) {
        return;
      }
      const ok = await savePageOrder(nextOrder);
      if (ok) setMessage("success", "Page order saved to source branch.");
    });
    return () => setReorderNavItemHandler(null);
  }, [
    pageOrderSlugs,
    pageRows,
    pageTreeConflict,
    savePageOrder,
    setMessage,
    setReorderNavItemHandler,
  ]);

  // Drag-reparent handler: Sidebar fires (fromId, toId) with sidebar
  // ids like "pages:docs/intro" and "pages" (the static root). Decode
  // both into slugs, build the target slug from target prefix + dragged
  // leaf, look up the dragged page's version, POST to /move, and bump
  // contentRevision on success so the eager-fetch refreshes the tree.
  useEffect(() => {
    setMoveNavItemHandler(async (fromId, toId) => {
      if (!fromId.startsWith("pages:")) return;
      if (pageTreeConflict) {
        setMessage("warn", "Page tree is in conflict state. Reload latest before moving pages.");
        return;
      }
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
      if (toId === "home") {
        // Drop on the Home parent row → reparent to root (slug becomes
        // just its leaf). Home replaced the old "pages" parent as the
        // root drop target.
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
        if (response.code === "SOURCE_CONFLICT" || response.status === 409) {
          setPageTreeConflict(true);
          setMessage("warn", "Move conflict. Reload latest before moving pages again.");
          return;
        }
        setMessage(
          "error",
          `Move failed: ${response.code}: ${response.error}`,
        );
        return;
      }
      void savePageOrder(
        remapSavedPageOrder(pageOrderSlugs, pageRows, { fromSlug, toSlug }),
      );
      setMessage("success", `Moved ${fromSlug} → ${toSlug}`);
      bumpContentRevision();
      // Switch the active nav item to the new id so highlight follows.
      setActiveNavItemId(`pages:${toSlug}`);
    });
    return () => setMoveNavItemHandler(null);
  }, [
    bumpContentRevision,
    pageRows,
    pageOrderSlugs,
    request,
    savePageOrder,
    pageTreeConflict,
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
        const row = postRows.find((r) => r.slug === fromSlug);
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
          if (response.code === "SOURCE_CONFLICT" || response.status === 409) {
            setMessage("warn", "Rename conflict. Reload latest before renaming posts again.");
            return;
          }
          setMessage("error", `Rename failed: ${response.code}: ${response.error}`);
          return;
        }
        setMessage("success", `Renamed ${fromSlug} → ${cleaned}`);
        bumpContentRevision();
        setActiveNavItemId(`posts:${cleaned}`);
        return;
      }
      if (itemId.startsWith("pages:")) {
        if (pageTreeConflict) {
          setMessage("warn", "Page tree is in conflict state. Reload latest before renaming pages.");
          return;
        }
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
          if (response.code === "SOURCE_CONFLICT" || response.status === 409) {
            setPageTreeConflict(true);
            setMessage("warn", "Rename conflict. Reload latest before renaming pages again.");
            return;
          }
          setMessage("error", `Rename failed: ${response.code}: ${response.error}`);
          return;
        }
        void savePageOrder(
          remapSavedPageOrder(pageOrderSlugs, pageRows, { fromSlug, toSlug: cleaned }),
        );
        setMessage("success", `Renamed ${fromSlug} → ${cleaned}`);
        bumpContentRevision();
        setActiveNavItemId(`pages:${cleaned}`);
      }
    });
    return () => setRenameNavItemHandler(null);
  }, [
    bumpContentRevision,
    pageOrderSlugs,
    pageRows,
    pageTreeConflict,
    request,
    savePageOrder,
    setActiveNavItemId,
    setMessage,
    setRenameNavItemHandler,
    postRows,
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
          return "1–120 chars: lowercase letters, digits, dashes (no leading/trailing dash)";
        }
        const fromSlug = itemId.slice("posts:".length);
        if (trimmed !== fromSlug && postRows.some((r) => r.slug === trimmed)) {
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
  }, [pageRows, setRenameValidator, postRows]);

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
            document.getElementById("home-document-editor-form") ??
            document.getElementById("post-document-editor-form") ??
            document.getElementById("page-document-editor-form") ??
            document.getElementById("component-document-editor-form");
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
        {pageTreeConflict && (
          <div className="site-admin-conflict-banner" role="alert">
            <span>
              Page tree order changed remotely. Reload latest before sorting,
              renaming, or moving pages again.
            </span>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                setPageTreeConflict(false);
                bumpContentRevision();
              }}
            >
              Reload latest
            </button>
          </div>
        )}

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
                  onPageMutation={handlePageMutation}
                  selected={pagesSelected}
                  onSelectedChange={setPagesSelected}
                />
              )}
              {activeTab === "components" && (
                <ComponentsPanel
                  selected={componentsSelected}
                  onSelectedChange={setComponentsSelected}
                />
              )}
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
