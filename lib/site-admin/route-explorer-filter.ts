import type { RouteTreeItem } from "./route-explorer-types.ts";

export function normalizeSearchQuery(q: string): string {
  return String(q || "").trim().toLowerCase();
}

export function filterOrderedRoutes(
  ordered: RouteTreeItem[],
  q: string,
  filter: "all" | "nav" | "overrides",
): RouteTreeItem[] {
  const query = normalizeSearchQuery(q);
  return ordered.filter((it) => {
    if (filter === "nav" && !it.navGroup) return false;
    if (filter === "overrides" && !it.overridden) return false;
    if (!query) return true;
    return (
      it.routePath.toLowerCase().includes(query) ||
      it.title.toLowerCase().includes(query) ||
      it.id.toLowerCase().includes(query)
    );
  });
}

export function computeVisibleRoutes({
  filtered,
  collapsed,
  q,
  parentById,
}: {
  filtered: RouteTreeItem[];
  collapsed: Record<string, boolean>;
  q: string;
  parentById: Map<string, string>;
}): RouteTreeItem[] {
  // When searching, don't hide nodes via collapse (users need to see matches).
  const query = normalizeSearchQuery(q);
  if (query) return filtered;

  const collapsedSet = new Set(
    Object.entries(collapsed)
      .filter(([, v]) => v)
      .map(([k]) => k),
  );

  const isHiddenByCollapsedAncestor = (id: string): boolean => {
    let pid = parentById.get(id) || "";
    let guard = 0;
    while (pid && guard++ < 200) {
      if (collapsedSet.has(pid)) return true;
      pid = parentById.get(pid) || "";
    }
    return false;
  };

  return filtered.filter((it) => !isHiddenByCollapsedAncestor(it.id));
}
