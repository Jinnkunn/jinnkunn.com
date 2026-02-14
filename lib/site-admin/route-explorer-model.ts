import type { RouteManifestItem } from "../routes-manifest";
import { compactId, normalizeRoutePath } from "../shared/route-utils.ts";
import { asRecordArray, isRecord, readTrimmedString } from "../notion/coerce.ts";

export type RouteTreeItem = RouteManifestItem & {
  depth: number;
  hasChildren: boolean;
};

export type RouteTree = {
  ordered: RouteTreeItem[];
  parentById: Map<string, string>; // id -> effective parent id ("" = root)
  childrenById: Map<string, string[]>; // id -> child ids
};

export type AdminProtectedRule = {
  auth: "password" | "github";
  mode: "exact" | "prefix";
  path: string;
};

export type AdminConfig = {
  overrides: Record<string, string>; // pageId -> routePath
  protectedByPageId: Record<string, AdminProtectedRule>; // pageId -> protection rule
  protectedByPath: Record<
    string,
    { auth: "password" | "github"; mode: "exact" | "prefix" }
  >; // legacy path -> rule
};

export function normalizeSearchQuery(q: string): string {
  return String(q || "").trim().toLowerCase();
}

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

export function parseAdminRoutesPayload(
  payload: unknown,
  items: RouteManifestItem[],
): AdminConfig {
  const raw = isRecord(payload) ? payload : {};
  const overridesInput = asRecordArray(raw.overrides);
  const protectedInput = asRecordArray(raw.protectedRoutes);

  const overrides: Record<string, string> = {};
  for (const it of overridesInput) {
    const pageId = readTrimmedString(it.pageId);
    const routePath = readTrimmedString(it.routePath);
    if (!pageId || !routePath) continue;
    overrides[pageId] = routePath;
  }

  const pathToPageId = new Map<string, string>();
  for (const it of items) pathToPageId.set(normalizeRoutePath(it.routePath), it.id);

  const protectedByPageId: AdminConfig["protectedByPageId"] = {};
  const protectedByPath: AdminConfig["protectedByPath"] = {};
  for (const it of protectedInput) {
    const rawPath = readTrimmedString(it.path);
    const rawMode = readTrimmedString(it.mode);
    if (!rawPath || !rawMode) continue;

    const p = normalizeRoutePath(rawPath);
    if (!p) continue;
    const mode: "exact" | "prefix" = rawMode === "prefix" ? "prefix" : "exact";
    const auth: "password" | "github" = readTrimmedString(it.auth) === "github" ? "github" : "password";
    const pid = compactId(readTrimmedString(it.pageId));
    if (pid) {
      protectedByPageId[pid] = { auth, mode, path: p };
      continue;
    }

    // Back-compat for legacy DB rows that only stored Path.
    const mapped = pathToPageId.get(p) || "";
    if (mapped) protectedByPageId[mapped] = { auth, mode, path: p };
    else protectedByPath[p] = { auth, mode };
  }

  return { overrides, protectedByPageId, protectedByPath };
}

export type EffectiveAccess = {
  auth: "password" | "github";
  direct: boolean;
  inherited: boolean;
  sourceId: string; // 32-hex if known
  sourcePath: string;
};

export function createEffectiveAccessFinder({
  cfg,
  tree,
  items,
}: {
  cfg: AdminConfig;
  tree: RouteTree;
  items: RouteManifestItem[];
}) {
  const byId = new Map<string, RouteManifestItem>();
  for (const it of items) byId.set(it.id, it);

  const directById = cfg.protectedByPageId || {};
  const legacyByPath = cfg.protectedByPath || {};

  const findLegacyByPath = (routePath: string) => {
    const p = normalizeRoutePath(routePath);
    let best: { sourcePath: string; auth: "password" | "github" } | null = null;
    for (const [k, v] of Object.entries(legacyByPath)) {
      const kp = normalizeRoutePath(k);
      if (!kp || kp === "/") continue;
      if (p === kp || p.startsWith(`${kp}/`)) {
        if (!best || kp.length > best.sourcePath.length) best = { sourcePath: kp, auth: v.auth };
      }
    }
    return best;
  };

  return (pageId: string, routePath: string): EffectiveAccess | null => {
    const pid = compactId(pageId);
    const direct = pid ? directById[pid] : null;
    if (direct) {
      return {
        auth: direct.auth,
        direct: true,
        inherited: false,
        sourceId: pid,
        sourcePath: byId.get(pid)?.routePath || direct.path || routePath,
      };
    }

    // Inherit by Notion hierarchy (parentId chain), not by URL prefix.
    let cur = tree.parentById.get(pid) || "";
    let guard = 0;
    while (cur && guard++ < 300) {
      const hit = directById[cur];
      if (hit) {
        return {
          auth: hit.auth,
          direct: false,
          inherited: true,
          sourceId: cur,
          sourcePath: byId.get(cur)?.routePath || hit.path || "",
        };
      }
      cur = tree.parentById.get(cur) || "";
    }

    // Back-compat fallback: legacy path-only rule.
    const legacy = findLegacyByPath(routePath);
    if (legacy) {
      return {
        auth: legacy.auth,
        direct: false,
        inherited: true,
        sourceId: "",
        sourcePath: legacy.sourcePath,
      };
    }

    return null;
  };
}
