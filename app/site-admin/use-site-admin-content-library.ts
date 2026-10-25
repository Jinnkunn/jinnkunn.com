"use client";
import { useCallback, useMemo, useState } from "react";
import type { PublicationReview } from "@/lib/shared/publication-snapshot";
import { contentMatchesTask, type ContentTaskFilter } from "./site-admin-content-tasks";
import { buildPageTree, filterPageTree } from "./site-admin-page-tree-model";
import { useSiteAdminContentPins } from "./use-site-admin-content-pins";

export type ContentLibraryItem = { id: string; title: string; href: string; meta: string; draft?: boolean; version?: string; pending?: boolean; issueCount?: number; modifiedAt?: string | null; pinned?: boolean };
export type ContentLibraryKind = "posts" | "pages" | "components";

export function useSiteAdminContentLibrary({ actor, rawPages, rawPosts, review, pageTreeOrder }: {
  actor: string; rawPages: ContentLibraryItem[]; rawPosts: ContentLibraryItem[]; review: PublicationReview | null; pageTreeOrder: string[];
}) {
  const [documentKind, setDocumentKind] = useState<"posts" | "pages">("posts");
  const [showCollectionIndex, setShowCollectionIndex] = useState(false);
  const [contentSearch, setContentSearch] = useState("");
  const [contentTask, setContentTask] = useState<ContentTaskFilter>("all");
  const [collapsedPageSlugs, setCollapsedPageSlugs] = useState<string[]>([]);
  const contentPins = useSiteAdminContentPins(actor);
  const taskMetadata = useMemo(() => {
    const inventory = new Map(review?.inventory?.map((item) => [item.path, item]));
    const paths = new Set(review?.changes.flatMap((item) => [item.path, item.oldPath]));
    const routes = new Set(review?.changes.flatMap((item) => item.details?.routes || []));
    return (kind: ContentLibraryKind, item: ContentLibraryItem): ContentLibraryItem => {
      const status = inventory.get(`${kind}/${item.id}.mdx`);
      return { ...item, pending: review ? paths.has(`${kind}/${item.id}.mdx`) || routes.has(item.href) : undefined,
        issueCount: status?.issues.length || 0, modifiedAt: status?.modifiedAt, pinned: contentPins.pins.includes(`${kind}:${item.id}`) };
    };
  }, [review, contentPins.pins]);
  const enrich = useCallback((kind: "posts" | "pages", raw: ContentLibraryItem[]) => {
    const ids = new Set(raw.map((item) => `${kind}/${item.id}.mdx`));
    const missing = review?.inventory?.filter((item) => item.path.startsWith(`${kind}/`) && !ids.has(item.path)) || [];
    return [...raw, ...missing.map((item) => {
      const id = item.path.slice(kind.length + 1, -4);
      return { id, title: id, href: `/${kind === "posts" ? "blog" : "pages"}/${id}`, meta: "Source needs review", draft: item.hidden };
    })].map((item) => taskMetadata(kind, item));
  }, [review, taskMetadata]);
  const pageItems = useMemo(() => enrich("pages", rawPages), [rawPages, enrich]);
  const postItems = useMemo(() => enrich("posts", rawPosts), [rawPosts, enrich]);
  const currentItems = documentKind === "pages" ? pageItems : postItems;
  const query = contentSearch.trim().toLowerCase();
  const matches = (item: ContentLibraryItem) => !query || [item.title, item.id, item.meta].some((value) => String(value || "").toLowerCase().includes(query));
  const visibleItems = currentItems.filter(matches);
  const globalSearchItems = query ? (["posts", "pages"] as const).flatMap((kind) => (kind === "posts" ? postItems : pageItems).filter(matches).map((item) => ({ kind, item }))) : [];
  const pageTree = useMemo(() => filterPageTree(buildPageTree(pageItems, pageTreeOrder), (item) => contentMatchesTask({ ...item, issueCount: item.issueCount || 0 }, contentTask)), [pageItems, pageTreeOrder, contentTask]);
  const collapsedPageSlugSet = useMemo(() => new Set(collapsedPageSlugs), [collapsedPageSlugs]);
  return { documentKind, setDocumentKind, showCollectionIndex, setShowCollectionIndex, contentSearch, setContentSearch, contentTask, setContentTask, collapsedPageSlugs, setCollapsedPageSlugs, contentPins, taskMetadata, pageItems, postItems, currentItems, visibleItems, globalSearchItems, pageTree, collapsedPageSlugSet };
}
