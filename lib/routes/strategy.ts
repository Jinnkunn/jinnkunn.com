import type { ProtectedRoute } from "@/lib/shared/protected-route";
import {
  canonicalizeRoutePath,
  compactId,
  normalizeRoutePath,
} from "../shared/route-utils.ts";

export function normalizePathname(pathname: string): string {
  const p = String(pathname || "").trim();
  if (!p) return "/";
  if (p === "/") return "/";
  return p.endsWith("/") ? p.slice(0, -1) : p;
}

export function canonicalizePublicRoute(routePath: string): string {
  const p = normalizePathname(routePath);
  if (!p.startsWith("/")) return p;
  return canonicalizeRoutePath(p) || "/";
}

export function resolveNotionIdPathRedirect(
  pathname: string,
  pageIdToRoute: Record<string, string>,
): string {
  const p = normalizePathname(pathname);
  const m = p.match(/^\/([0-9a-f]{32})$/i);
  if (!m) return "";
  const id = m[1].toLowerCase();
  const target = pageIdToRoute?.[id] || "";
  if (!target) return "";
  const canon = normalizeRoutePath(target);
  if (!canon || canon === p) return "";
  return canon;
}

export function lookupPageIdForPath(pathname: string, routesMap: Record<string, unknown>): string {
  const p = canonicalizePublicRoute(normalizePathname(pathname));

  const direct = routesMap?.[p];
  if (typeof direct === "string" && direct) return compactId(direct);

  const m = p.match(/^\/blog\/([^/]+)$/);
  if (m) {
    const alt = `/blog/list/${m[1]}`;
    const hit = routesMap?.[alt];
    if (typeof hit === "string" && hit) return compactId(hit);
  }

  return "";
}

export function buildParentByPageIdMap(routesManifest: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const items = Array.isArray(routesManifest) ? routesManifest : [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = compactId(typeof row.id === "string" ? row.id : "");
    if (!id) continue;
    const parentId = compactId(typeof row.parentId === "string" ? row.parentId : "");
    out[id] = parentId || "";
  }
  return out;
}

export function findProtectedMatch(pathname: string, rules: ProtectedRoute[]): ProtectedRoute | null {
  const p = normalizePathname(pathname);

  for (const rule of rules) {
    if (rule.mode !== "exact") continue;
    const rp = normalizePathname(rule.path);
    if (rp === p || p.startsWith(`${rp}/`)) return rule;
  }

  let best: ProtectedRoute | null = null;
  for (const rule of rules) {
    if (rule.mode !== "prefix") continue;
    const rp = normalizePathname(rule.path);
    if (rp === "/") continue;
    if (p === rp || p.startsWith(`${rp}/`)) {
      if (!best || rp.length > normalizePathname(best.path).length) best = rule;
    }
  }
  return best;
}

export function findProtectedByPageHierarchy(
  pageId32: string,
  rules: ProtectedRoute[],
  parentByPageId: Record<string, string>,
): ProtectedRoute | null {
  const byId: Record<string, ProtectedRoute> = {};
  for (const rule of rules) {
    if ((rule.key || "") !== "pageId") continue;
    const pid = compactId(rule.pageId || rule.id || "");
    if (!pid) continue;
    if (!byId[pid] || (byId[pid].auth || "password") !== "password") byId[pid] = rule;
  }

  let cur = compactId(pageId32);
  let guard = 0;
  while (cur && guard++ < 200) {
    const hit = byId[cur];
    if (hit) return hit;
    cur = parentByPageId?.[cur] || "";
  }
  return null;
}

export function pickProtectedRule(
  pathname: string,
  rules: ProtectedRoute[],
  routesMap: Record<string, unknown>,
  parentByPageId: Record<string, string>,
): ProtectedRoute | null {
  const pageId = lookupPageIdForPath(pathname, routesMap);
  const byPage = pageId ? findProtectedByPageHierarchy(pageId, rules, parentByPageId) : null;
  return byPage || findProtectedMatch(pathname, rules);
}

export function blogSourceRouteForPublicPath(pathname: string): string {
  const p = canonicalizePublicRoute(normalizePathname(pathname));
  const m = p.match(/^\/blog\/([^/]+)$/);
  if (!m) return "";
  return `/blog/list/${m[1]}`;
}
