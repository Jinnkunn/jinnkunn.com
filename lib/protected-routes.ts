import "server-only";

import { readContentJsonWithStat } from "@/lib/server/content-json";
import type { ProtectedRoute } from "@/lib/shared/protected-route";

function isObject(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

function normalizeRoute(x: unknown): ProtectedRoute | null {
  if (!isObject(x)) return null;
  const id = String(x.id || "").trim();
  const path = String(x.path || "").trim();
  const mode = String(x.mode || "").trim();
  const token = String(x.token || "").trim();
  if (!id || !path || (mode !== "exact" && mode !== "prefix") || !token) return null;
  const auth0 = String(x.auth || "").trim();
  const auth = auth0 === "github" ? "github" : auth0 === "password" ? "password" : undefined;
  const key0 = String(x.key || "").trim();
  const key = key0 === "pageId" ? "pageId" : key0 === "path" ? "path" : undefined;
  const pageId = String(x.pageId || "").trim() || undefined;

  return { id, path, mode, token, auth, key, pageId };
}

export function getProtectedRoutes(): ProtectedRoute[] {
  const data = readContentJsonWithStat("protected-routes.json");
  if (!data) return [];

  const parsed = data.parsed;
  return Array.isArray(parsed)
    ? parsed.map(normalizeRoute).filter((x): x is ProtectedRoute => Boolean(x))
    : [];
}
