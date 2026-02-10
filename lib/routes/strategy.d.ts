export type ProtectedRoute = {
  id: string;
  auth?: "password" | "github";
  key?: "pageId" | "path";
  pageId?: string;
  path: string;
  mode: "exact" | "prefix";
  token: string;
};

export function normalizePathname(pathname: string): string;
export function canonicalizePublicRoute(routePath: string): string;
export function resolveNotionIdPathRedirect(pathname: string, pageIdToRoute: Record<string, string>): string;
export function lookupPageIdForPath(pathname: string, routesMap: Record<string, unknown>): string;
export function buildParentByPageIdMap(routesManifest: unknown): Record<string, string>;

export function findProtectedMatch(pathname: string, rules: ProtectedRoute[]): ProtectedRoute | null;
export function findProtectedByPageHierarchy(
  pageId32: string,
  rules: ProtectedRoute[],
  parentByPageId: Record<string, string>,
): ProtectedRoute | null;
export function pickProtectedRule(
  pathname: string,
  rules: ProtectedRoute[],
  routesMap: Record<string, unknown>,
  parentByPageId: Record<string, string>,
): ProtectedRoute | null;

export function blogSourceRouteForPublicPath(pathname: string): string;

