import type { RouteManifestItem } from "../routes-manifest";
import { normalizeRoutePath } from "../shared/route-utils.ts";
import type { RouteTree, RouteTreeItem } from "./route-explorer-types.ts";

export function buildRouteTree(items: RouteManifestItem[]): RouteTree {
  const byId = new Map<string, RouteManifestItem>();
  for (const it of items) byId.set(it.id, it);

  // Defensive parent resolution:
  // - Prefer Notion parentId when present and resolvable.
  // - Otherwise derive parent from the longest routePath prefix in the set.
  const byRoute = new Map<string, RouteManifestItem>();
  for (const it of items) byRoute.set(it.routePath, it);

  const parentById = new Map<string, string>(); // id -> effective parentId
  for (const it of items) {
    const pid = it.parentId || "";
    if (pid && byId.has(pid)) {
      parentById.set(it.id, pid);
      continue;
    }
    const p = normalizeRoutePath(it.routePath);
    if (p === "/") {
      parentById.set(it.id, "");
      continue;
    }
    const segs = p.split("/").filter(Boolean);
    let parent: RouteManifestItem | null = null;
    for (let i = segs.length - 1; i >= 1; i--) {
      const prefix = `/${segs.slice(0, i).join("/")}`;
      const hit = byRoute.get(prefix) || null;
      if (hit) {
        parent = hit;
        break;
      }
    }
    parentById.set(it.id, parent?.id || "");
  }

  const kids = new Map<string, string[]>(); // parentId -> childIds
  for (const it of items) {
    const pid = parentById.get(it.id) || "";
    const arr = kids.get(pid) || [];
    arr.push(it.id);
    kids.set(pid, arr);
  }

  for (const [pid, childIds] of kids.entries()) {
    childIds.sort((a, b) => {
      const aa = byId.get(a);
      const bb = byId.get(b);
      return String(aa?.routePath || "").localeCompare(String(bb?.routePath || ""));
    });
    kids.set(pid, childIds);
  }

  // Deterministic roots: use effective parent mapping, then sort by route path.
  const roots = items
    .filter((it) => !(parentById.get(it.id) || ""))
    .slice()
    .sort((a, b) => a.routePath.localeCompare(b.routePath));

  const ordered: RouteTreeItem[] = [];
  const seen = new Set<string>();

  const dfs = (node: RouteManifestItem, depth: number) => {
    if (!node?.id || seen.has(node.id)) return;
    seen.add(node.id);
    ordered.push({
      ...node,
      depth,
      hasChildren: (kids.get(node.id) || []).length > 0,
    });
    const childIds = kids.get(node.id) || [];
    for (const cid of childIds) {
      const c = byId.get(cid);
      if (c) dfs(c, depth + 1);
    }
  };

  for (const r of roots) dfs(r, 0);
  // Include any remaining nodes (defensive: broken parent pointers).
  for (const it of items) if (!seen.has(it.id)) dfs(it, 0);

  return { ordered, parentById, childrenById: kids };
}

export function getDefaultCollapsed(ordered: RouteTreeItem[]): Record<string, boolean> {
  // Default: only show root + one level (Super-like). Deeper folders start collapsed.
  const next: Record<string, boolean> = {};
  for (const it of ordered) {
    if (it.hasChildren && it.depth >= 1) next[it.id] = true;
  }
  return next;
}

export function buildDescendantsGetter(childrenById: Map<string, string[]>) {
  const memo = new Map<string, string[]>();

  const walk = (id: string): string[] => {
    if (memo.has(id)) return memo.get(id)!;
    const out: string[] = [];
    const childIds = childrenById.get(id) || [];
    for (const cid of childIds) {
      out.push(cid);
      out.push(...walk(cid));
    }
    memo.set(id, out);
    return out;
  };

  return walk;
}
