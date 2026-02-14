import { canonicalizePublicRoute, normalizePathname } from "../routes/strategy.ts";
import { scoreSearchResult } from "./rank.ts";
import { groupLabelForRoutePath } from "../shared/search-group.ts";
import type { SearchItem, SearchMeta, SearchResponse } from "../shared/search-contract.ts";
import {
  bestPos,
  buildBreadcrumb,
  buildGroupCounts,
  buildSnippetByTerms,
  classifyType,
  dedupeByCanonicalRoute,
  matchTypeKey,
  normalizeKindForTypeKey,
  readHeadings,
  safeLower,
  tokenizeSearchQuery,
  type SearchIndexItem,
  type SearchManifestItem,
  type TypeKey,
} from "./api-model.ts";

export type SearchTypeParam = "all" | "page" | "pages" | "blog" | "database" | "databases";

type SearchRunInput = {
  q: string;
  type: SearchTypeParam;
  offset: number;
  limit: number;
  scope: string;
  index: SearchIndexItem[];
  manifest: SearchManifestItem[];
};

function inScope(routePath: string, scope: string): boolean {
  if (!scope) return true;
  const p = canonicalizePublicRoute(routePath);
  return p === scope || p.startsWith(`${scope}/`);
}

function countByType<T extends { typeKey: TypeKey }>(items: T[]) {
  const counts = { all: items.length, pages: 0, blog: 0, databases: 0 };
  for (const item of items) counts[item.typeKey] += 1;
  return counts;
}

function buildMeta(
  allMatches: Array<{ typeKey: TypeKey; canon: string }>,
  filtered: Array<{ typeKey: TypeKey; canon: string }>,
  offset: number,
  limit: number,
): SearchMeta {
  return {
    total: allMatches.length,
    filteredTotal: filtered.length,
    counts: countByType(allMatches),
    groups: buildGroupCounts(filtered.map((m) => groupLabelForRoutePath(m.canon))),
    offset,
    limit,
    hasMore: offset + limit < filtered.length,
  };
}

function buildMaps(manifest: SearchManifestItem[]) {
  const byRoute = new Map<string, SearchManifestItem>();
  const byId = new Map<string, SearchManifestItem>();
  for (const item of manifest) {
    byRoute.set(normalizePathname(item.routePath), item);
    const id = String(item.id || "").replace(/-/g, "").toLowerCase();
    if (id) byId.set(id, item);
  }
  return { byRoute, byId };
}

export function buildSearchResponse(input: SearchRunInput): SearchResponse {
  const { q, type, offset, limit, scope, index, manifest } = input;
  const ql = q.toLowerCase();
  const terms = tokenizeSearchQuery(q);
  const { byRoute, byId } = buildMaps(manifest);

  if (index.length) {
    const allMatches0 = index
      .filter((item) => {
        const canon = canonicalizePublicRoute(item.routePath);
        if (!inScope(canon, scope)) return false;
        const headings = readHeadings(item).join("\n");
        const hay = `${safeLower(item.title)}\n${safeLower(canon)}\n${safeLower(headings)}\n${safeLower(item.text)}`;
        if (terms.length <= 1) return hay.includes(ql);
        return terms.every((t) => hay.includes(t));
      })
      .map((item) => {
        const canon = canonicalizePublicRoute(item.routePath);
        const typeKey = classifyType(item.kind, canon);
        const titlePos = bestPos(safeLower(item.title), terms);
        const routePos = bestPos(safeLower(canon), terms);

        const homePenalty = canon === "/" && titlePos === -1 && routePos === -1 ? 250 : 0;
        const navBoost = byRoute.get(normalizePathname(item.routePath))?.navGroup ? 180 : 0;
        const headings = readHeadings(item).join("\n");
        const exactTitle = safeLower(item.title).trim() === safeLower(q).trim();
        const exactRoute = safeLower(canon).trim() === safeLower(q).trim();
        const exactBoost = exactTitle ? 1800 : exactRoute ? 900 : 0;
        const score =
          scoreSearchResult({
            title: item.title,
            route: canon,
            text: `${headings}\n${item.text || ""}`.trim(),
            query: q,
            navBoost,
          }) + homePenalty - exactBoost;
        return { item, score, canon, typeKey };
      })
      .sort(
        (a, b) =>
          a.score - b.score ||
          String(a.item.title || "").localeCompare(String(b.item.title || "")) ||
          a.canon.localeCompare(b.canon),
      );

    const allMatches = dedupeByCanonicalRoute(allMatches0);
    const filtered = allMatches.filter((m) => matchTypeKey(type, m.typeKey));

    const items: SearchItem[] = filtered.slice(offset, offset + limit).map(({ item, canon, typeKey }) => ({
      title: item.routePath === "/" ? "Home" : item.title || "Untitled",
      routePath: canon,
      kind: normalizeKindForTypeKey(typeKey),
      snippet: (() => {
        const headingsArr = readHeadings(item);
        const headings = headingsArr.join("\n");
        const body = String(item.text || "");
        const bodyPos = bestPos(safeLower(body), terms);
        const src = bodyPos >= 0 ? body : `${headings}\n${body}`.trim();
        return buildSnippetByTerms(src, terms);
      })(),
      breadcrumb: buildBreadcrumb(item.routePath, byRoute, byId) || (canon === "/" ? "Home" : ""),
    }));

    return {
      items,
      meta: buildMeta(allMatches, filtered, offset, limit),
    } satisfies SearchResponse;
  }

  const allMatches = manifest
    .filter((item) => {
      const canon = canonicalizePublicRoute(item.routePath);
      if (!inScope(canon, scope)) return false;
      const hay = `${safeLower(item.title)}\n${safeLower(canon)}\n${safeLower(item.id)}`;
      if (terms.length <= 1) return hay.includes(ql);
      return terms.every((t) => hay.includes(t));
    })
    .map((item) => {
      const canon = canonicalizePublicRoute(item.routePath);
      const typeKey = classifyType(item.kind, canon);
      const titlePos = bestPos(safeLower(item.title), terms);
      const routePos = bestPos(safeLower(canon), terms);
      const score =
        (titlePos === -1 ? 50 : titlePos) +
        (routePos === -1 ? 80 : routePos + 10) +
        Math.min(200, canon.length / 8);
      return { item, score, canon, typeKey };
    })
    .sort(
      (a, b) =>
        a.score - b.score ||
        String(a.item.title || "").localeCompare(String(b.item.title || "")) ||
        a.canon.localeCompare(b.canon),
    );

  const filtered = allMatches.filter((m) => matchTypeKey(type, m.typeKey));
  const items: SearchItem[] = filtered.slice(offset, offset + limit).map(({ item, canon, typeKey }) => ({
    title: item.routePath === "/" ? "Home" : item.title || "Untitled",
    routePath: canon,
    kind: normalizeKindForTypeKey(typeKey),
    breadcrumb: buildBreadcrumb(item.routePath, byRoute, byId) || (item.routePath === "/" ? "Home" : ""),
  }));

  return {
    items,
    meta: buildMeta(allMatches, filtered, offset, limit),
  } satisfies SearchResponse;
}
