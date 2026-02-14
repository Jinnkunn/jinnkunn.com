import type { RouteManifestItem } from "../routes-manifest";
import { asRecordArray, isRecord, readTrimmedString } from "../notion/coerce.ts";
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
