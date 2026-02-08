import fs from "node:fs";
import path from "node:path";
import { cache } from "react";

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

function readJsonFile(filePath: string): unknown | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function findManifestFile(): string | null {
  const candidates = [
    path.join(process.cwd(), "content", "generated", "routes-manifest.json"),
    path.join(process.cwd(), "content", "routes-manifest.json"),
  ];
  for (const p of candidates) {
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

export const getRoutesManifest = cache((): RouteManifestItem[] => {
  const file = findManifestFile();
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

