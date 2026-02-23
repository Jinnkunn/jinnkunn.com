import type { RouteManifestItem } from "../routes-manifest";
import { normalizeRoutePath } from "../shared/route-utils.ts";

export type OverrideConflictTarget = {
  id: string;
  title: string;
  routePath: string;
};

export type OverrideConflict = {
  path: string;
  count: number;
  others: OverrideConflictTarget[];
};

export function createOverrideConflictFinder({
  items,
  overrides,
}: {
  items: RouteManifestItem[];
  overrides: Record<string, string>;
}) {
  const byPath = new Map<string, OverrideConflictTarget[]>();

  for (const it of items) {
    const resolved = normalizeRoutePath(overrides[it.id] || it.routePath);
    if (!resolved) continue;
    const arr = byPath.get(resolved) || [];
    arr.push({
      id: it.id,
      title: it.title || "Untitled",
      routePath: resolved,
    });
    byPath.set(resolved, arr);
  }

  return (pageId: string, candidatePath: string): OverrideConflict | null => {
    const p = normalizeRoutePath(candidatePath);
    if (!p) return null;
    const arr = byPath.get(p) || [];
    const others = arr.filter((it) => it.id !== pageId);
    if (!others.length) return null;
    return {
      path: p,
      count: others.length,
      others,
    };
  };
}
