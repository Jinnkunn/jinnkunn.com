import {
  blogSourceRouteForPublicPath as blogSourceRouteForPublicPathRaw,
  buildParentByPageIdMap as buildParentByPageIdMapRaw,
  canonicalizePublicRoute as canonicalizePublicRouteRaw,
  findProtectedByPageHierarchy as findProtectedByPageHierarchyRaw,
  findProtectedMatch as findProtectedMatchRaw,
  lookupPageIdForPath as lookupPageIdForPathRaw,
  normalizePathname as normalizePathnameRaw,
  pickProtectedRule as pickProtectedRuleRaw,
  resolveNotionIdPathRedirect as resolveNotionIdPathRedirectRaw,
} from "./strategy.mjs";
import type { ProtectedRoute } from "@/lib/shared/protected-route";

function isProtectedRoute(value: unknown): value is ProtectedRoute {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.path === "string" &&
    typeof row.mode === "string" &&
    typeof row.token === "string"
  );
}

function parseProtectedRoute(value: unknown): ProtectedRoute | null {
  return isProtectedRoute(value) ? value : null;
}

export function normalizePathname(pathname: string): string {
  return normalizePathnameRaw(pathname);
}

export function canonicalizePublicRoute(routePath: string): string {
  return canonicalizePublicRouteRaw(routePath);
}

export function resolveNotionIdPathRedirect(
  pathname: string,
  pageIdToRoute: Record<string, string>,
): string {
  return resolveNotionIdPathRedirectRaw(pathname, pageIdToRoute);
}

export function lookupPageIdForPath(pathname: string, routesMap: Record<string, unknown>): string {
  return lookupPageIdForPathRaw(pathname, routesMap);
}

export function buildParentByPageIdMap(routesManifest: unknown): Record<string, string> {
  return buildParentByPageIdMapRaw(routesManifest);
}

export function findProtectedMatch(pathname: string, rules: ProtectedRoute[]): ProtectedRoute | null {
  const out = findProtectedMatchRaw(pathname, rules);
  return parseProtectedRoute(out);
}

export function findProtectedByPageHierarchy(
  pageId32: string,
  rules: ProtectedRoute[],
  parentByPageId: Record<string, string>,
): ProtectedRoute | null {
  const out = findProtectedByPageHierarchyRaw(pageId32, rules, parentByPageId);
  return parseProtectedRoute(out);
}

export function pickProtectedRule(
  pathname: string,
  rules: ProtectedRoute[],
  routesMap: Record<string, unknown>,
  parentByPageId: Record<string, string>,
): ProtectedRoute | null {
  const out = pickProtectedRuleRaw(pathname, rules, routesMap, parentByPageId);
  return parseProtectedRoute(out);
}

export function blogSourceRouteForPublicPath(pathname: string): string {
  return blogSourceRouteForPublicPathRaw(pathname);
}
