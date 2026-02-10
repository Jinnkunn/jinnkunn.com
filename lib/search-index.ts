import "server-only";

import { readContentJsonWithStat } from "@/lib/server/content-json";

export type SearchIndexItem = {
  id: string;
  title: string;
  kind: string;
  routePath: string;
  text: string;
};

function isObject(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

type Cached = { file: string; mtimeMs: number; items: SearchIndexItem[] };
let __cache: Cached | null = null;

export function getSearchIndex(): SearchIndexItem[] {
  const data = readContentJsonWithStat("search-index.json");
  if (!data) return [];

  if (__cache && __cache.file === data.file && __cache.mtimeMs === data.mtimeMs) return __cache.items;

  const parsed = data.parsed;
  const items: SearchIndexItem[] = Array.isArray(parsed)
    ? parsed
        .map((x): SearchIndexItem | null => {
          if (!isObject(x)) return null;
          const it: SearchIndexItem = {
            id: String(x.id || ""),
            title: String(x.title || ""),
            kind: String(x.kind || ""),
            routePath: String(x.routePath || ""),
            text: String(x.text || ""),
          };
          if (!it.routePath) return null;
          return it;
        })
        .filter((x): x is SearchIndexItem => Boolean(x))
    : [];

  __cache = { file: data.file, mtimeMs: data.mtimeMs, items };
  return items;
}

