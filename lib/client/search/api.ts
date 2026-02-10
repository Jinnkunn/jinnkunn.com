import type { SearchItem } from "@/lib/client/site-search-render";

import type { SearchMeta } from "./types";

function parseSearchMeta(meta0: unknown): SearchMeta | null {
  if (!meta0 || typeof meta0 !== "object") return null;
  const m = meta0 as Record<string, unknown>;
  const counts0 = m.counts;
  const counts = counts0 && typeof counts0 === "object" ? (counts0 as Record<string, unknown>) : null;

  const all = Number(counts?.all ?? NaN);
  const pages = Number(counts?.pages ?? NaN);
  const blog = Number(counts?.blog ?? NaN);
  const databases = Number(counts?.databases ?? NaN);

  const total = Number(m.total ?? NaN);
  const filteredTotal = Number(m.filteredTotal ?? NaN);
  const offset = Number(m.offset ?? NaN);
  const limit = Number(m.limit ?? NaN);
  const hasMore = Boolean(m.hasMore);

  if (![all, pages, blog, databases, total, filteredTotal, offset, limit].every((n) => Number.isFinite(n)))
    return null;

  const groups0 = m.groups;
  const groups = Array.isArray(groups0)
    ? groups0
        .map((g) => {
          if (!g || typeof g !== "object") return null;
          const gg = g as Record<string, unknown>;
          const label = String(gg.label || "").trim();
          const count = Number(gg.count ?? NaN);
          if (!label || !Number.isFinite(count)) return null;
          return { label, count };
        })
        .filter((x): x is { label: string; count: number } => Boolean(x))
    : undefined;

  return { total, filteredTotal, counts: { all, pages, blog, databases }, groups, offset, limit, hasMore };
}

function parseSearchItems(items0: unknown): SearchItem[] {
  const items = Array.isArray(items0) ? items0 : [];
  return items
    .map((x) => {
      if (!x || typeof x !== "object") return null;
      const o = x as Record<string, unknown>;
      const it: SearchItem = {
        title: String(o.title || ""),
        routePath: String(o.routePath || ""),
        kind: String(o.kind || "page"),
        snippet: String(o.snippet || ""),
        breadcrumb: String(o.breadcrumb || ""),
      };
      return it;
    })
    .filter((x): x is SearchItem => Boolean(x && x.routePath));
}

export async function fetchSearchResults(
  q: string,
  opts: { type: string; scope: string; offset: number; limit: number },
  signal: AbortSignal,
): Promise<{ items: SearchItem[]; meta: SearchMeta | null }> {
  const url = new URL("/api/search", window.location.origin);
  url.searchParams.set("q", q);
  if (opts.type && opts.type !== "all") url.searchParams.set("type", opts.type);
  if (opts.scope) url.searchParams.set("scope", opts.scope);
  if (opts.offset > 0) url.searchParams.set("offset", String(opts.offset));
  if (opts.limit && opts.limit !== 20) url.searchParams.set("limit", String(opts.limit));

  const res = await fetch(url, { signal, headers: { "cache-control": "no-store" } });
  if (!res.ok) return { items: [], meta: null };

  const data = (await res.json().catch(() => null)) as unknown;
  if (!data || typeof data !== "object") return { items: [], meta: null };

  const obj = data as { items?: unknown; meta?: unknown };
  return { items: parseSearchItems(obj.items), meta: parseSearchMeta(obj.meta) };
}

