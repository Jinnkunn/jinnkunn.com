import { cache } from "react";

import { findContentFile, readJsonFile } from "@/lib/server/content-files";

export type RouteManifestItem = {
  id: string;
  title: string;
  kind: string;
  routePath: string;
  parentId: string;
  parentRoutePath: string;
  navGroup: string;
  overridden: boolean;
};

export const getRoutesManifest = cache((): RouteManifestItem[] => {
  const file = findContentFile("routes-manifest.json");
  if (!file) return [];
  const parsed = readJsonFile(file);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((x) => {
      if (!x || typeof x !== "object") return null;
      const o = x as Record<string, unknown>;
      return {
        id: String(o.id || ""),
        title: String(o.title || ""),
        kind: String(o.kind || ""),
        routePath: String(o.routePath || ""),
        parentId: String(o.parentId || ""),
        parentRoutePath: String(o.parentRoutePath || "/"),
        navGroup: String(o.navGroup || ""),
        overridden: Boolean(o.overridden),
      } satisfies RouteManifestItem;
    })
    .filter((x): x is RouteManifestItem => Boolean(x?.id && x?.routePath));
});
