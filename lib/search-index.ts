import "server-only";

import { readContentJsonWithStat } from "@/lib/server/content-json";

export type SearchIndexItem = {
  id: string;
  title: string;
  kind: string;
  routePath: string;
  headings?: string[];
  text: string;
};

function isObject(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

function capHeadings(headings: string[] | undefined): string[] | undefined {
  const arr = Array.isArray(headings) ? headings : [];
  if (!arr.length) return undefined;
  const out: string[] = [];
  let chars = 0;
  for (const s0 of arr) {
    const s = String(s0 || "").replace(/\s+/g, " ").trim();
    if (!s) continue;
    out.push(s);
    chars += s.length + 1;
    if (out.length >= 18) break;
    if (chars >= 520) break;
  }
  return out.length ? out : undefined;
}

function capText(text: string): string {
  const t = String(text || "");
  if (!t) return "";
  return t.length > 2200 ? t.slice(0, 2200) : t;
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
            headings: capHeadings(
              Array.isArray((x as Record<string, unknown>).headings)
                ? ((x as Record<string, unknown>).headings as unknown[])
                    .map((s) => String(s || "").trim())
                    .filter(Boolean)
                : undefined,
            ),
            text: capText(String(x.text || "")),
          };
          if (!it.routePath) return null;
          return it;
        })
        .filter((x): x is SearchIndexItem => Boolean(x))
    : [];

  __cache = { file: data.file, mtimeMs: data.mtimeMs, items };
  return items;
}
