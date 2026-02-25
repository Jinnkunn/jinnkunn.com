import type { RouteManifestItem } from "../routes-manifest";
import { asRecordArray, isRecord, readTrimmedString } from "../notion/coerce.ts";
import { normalizeProtectedAccessMode } from "../shared/access.ts";
import { compactId, normalizeRoutePath } from "../shared/route-utils.ts";
import type { AdminConfig, EffectiveAccess, RouteTree } from "./route-explorer-types.ts";

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
  for (const it of protectedInput) {
    const rawPath = readTrimmedString(it.path);
    const rawMode = readTrimmedString(it.mode);
    if (!rawPath || !rawMode) continue;

    const p = normalizeRoutePath(rawPath);
    if (!p) continue;
    const mode: "exact" | "prefix" = rawMode === "prefix" ? "prefix" : "exact";
    const auth = normalizeProtectedAccessMode(readTrimmedString(it.auth), "password");
    const pid = compactId(readTrimmedString(it.pageId));
    if (pid) {
      protectedByPageId[pid] = { auth, mode, path: p };
      continue;
    }

    // Accept rows without pageId only if we can map an existing route.
    const mapped = pathToPageId.get(p) || "";
    if (mapped) protectedByPageId[mapped] = { auth, mode, path: p };
  }

  return { overrides, protectedByPageId };
}

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

    return null;
  };
}
