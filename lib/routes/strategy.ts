import { compactId, normalizeRoutePath } from "@/lib/shared/route-utils";

export type ProtectedRoute = {
  id: string;
  auth?: "password" | "github";
  key?: "pageId" | "path";
  pageId?: string;
  path: string;
  mode: "exact" | "prefix";
  token: string;
};

export function normalizePathname(pathname: string): string {
  const p = String(pathname || "").trim();
  if (!p) return "/";
  if (p === "/") return "/";
  return p.endsWith("/") ? p.slice(0, -1) : p;
}

export function canonicalizePublicRoute(routePath: string): string {
  const p = normalizePathname(routePath);
  if (p === "/blog/list") return "/blog";
  if (p.startsWith("/blog/list/")) return p.replace(/^\/blog\/list\//, "/blog/");
  if (p === "/list") return "/blog";
  if (p.startsWith("/list/")) return p.replace(/^\/list\//, "/blog/");
  return p;
}

export function resolveNotionIdPathRedirect(pathname: string, pageIdToRoute: Record<string, string>): string {
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
  try {
    const items = Array.isArray(routesManifest) ? routesManifest : [];
    for (const it of items) {
      const row = (it && typeof it === "object" ? it : {}) as {
        id?: unknown;
        parentId?: unknown;
      };
      const id = compactId(String(row.id || ""));
      if (!id) continue;
      const pid = compactId(String(row.parentId || ""));
      out[id] = pid || "";
    }
  } catch {
    // ignore
  }
  return out;
}

export function findProtectedMatch(pathname: string, rules: ProtectedRoute[]): ProtectedRoute | null {
  const p = normalizePathname(pathname);

  for (const r of rules) {
    if (r.mode !== "exact") continue;
    const rp = normalizePathname(r.path);
    if (rp === p || p.startsWith(`${rp}/`)) return r;
  }

  let best: ProtectedRoute | null = null;
  for (const r of rules) {
    if (r.mode !== "prefix") continue;
    const rp = normalizePathname(r.path);
    if (rp === "/") continue;
    if (p === rp || p.startsWith(`${rp}/`)) {
      if (!best || rp.length > normalizePathname(best.path).length) best = r;
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
  for (const r of rules) {
    if ((r.key || "") !== "pageId") continue;
    const pid = compactId(r.pageId || r.id || "");
    if (!pid) continue;
    if (!byId[pid] || (byId[pid].auth || "password") !== "password") byId[pid] = r;
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
