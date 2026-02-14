import { canonicalizePublicRoute, normalizePathname } from "@/lib/routes/strategy";
import { getSearchIndex } from "@/lib/search-index";
import { getRoutesManifest } from "@/lib/routes-manifest";
import {
  bestPos,
  buildBreadcrumb,
  buildGroupCounts,
  buildSnippetByTerms,
  classifyType,
  dedupeByCanonicalRoute,
  isIgnoredPath,
  matchTypeKey,
  normalizeKindForTypeKey,
  normalizeQuery,
  readHeadings,
  safeLower,
  tokenizeSearchQuery,
  type SearchIndexItem,
  type SearchManifestItem,
} from "@/lib/search/api-model";
import { scoreSearchResult } from "@/lib/search/rank";
import { groupLabelForRoutePath } from "@/lib/shared/search-group";
import {
  emptySearchResponse,
  type SearchItem,
  type SearchMeta,
  type SearchResponse,
} from "@/lib/shared/search-contract";
import { noStoreErrorOnly, noStoreJson } from "@/lib/server/api-response";

export const runtime = "nodejs";

const json = noStoreJson;

function readSearchIndex(): SearchIndexItem[] {
  return getSearchIndex() as SearchIndexItem[];
}

function readManifest(): SearchManifestItem[] {
  return getRoutesManifest() as SearchManifestItem[];
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = normalizeQuery(url.searchParams.get("q") || "");
  if (!q) {
    return json(emptySearchResponse({ limit: 20 }) satisfies SearchResponse);
  }

  const type = String(url.searchParams.get("type") || "all").trim().toLowerCase();
  if (!["all", "page", "pages", "blog", "database", "databases"].includes(type)) {
    return noStoreErrorOnly("Invalid type", { status: 400 });
  }

  const offsetRaw = Number.parseInt(String(url.searchParams.get("offset") || "0"), 10);
  const offset = Math.max(0, Math.min(10_000, Number.isFinite(offsetRaw) ? offsetRaw : 0));

  const limitRaw = Number.parseInt(String(url.searchParams.get("limit") || "20"), 10);
  const limit = Math.max(1, Math.min(50, Number.isFinite(limitRaw) ? limitRaw : 20));
  const scopeRaw = String(url.searchParams.get("scope") || "").trim();
  const scope = scopeRaw && scopeRaw.startsWith("/") ? normalizePathname(scopeRaw) : "";

  const ql = q.toLowerCase();
  const terms = tokenizeSearchQuery(q);
  const index = readSearchIndex().filter((it) => !isIgnoredPath(it.routePath));
  const manifest = readManifest().filter((it) => !isIgnoredPath(it.routePath));
  const byRoute = new Map<string, SearchManifestItem>();
  const byId = new Map<string, SearchManifestItem>();
  for (const it of manifest) {
    byRoute.set(normalizePathname(it.routePath), it);
    const id = String(it.id || "").replace(/-/g, "").toLowerCase();
    if (id) byId.set(id, it);
  }

  const inScope = (routePath: string): boolean => {
    if (!scope) return true;
    const p = canonicalizePublicRoute(routePath);
    return p === scope || p.startsWith(`${scope}/`);
  };

  // Prefer the richer, content-based index if present; otherwise fall back.
  if (index.length) {
    const allMatches0 = index
      .filter((it) => {
        const canon = canonicalizePublicRoute(it.routePath);
        if (!inScope(canon)) return false;
        const headings = readHeadings(it).join("\n");
        const hay = `${safeLower(it.title)}\n${safeLower(canon)}\n${safeLower(headings)}\n${safeLower(it.text)}`;
        if (terms.length <= 1) return hay.includes(ql);
        return terms.every((t) => hay.includes(t));
      })
      .map((it) => {
        const canon = canonicalizePublicRoute(it.routePath);
        const typeKey = classifyType(it.kind, canon);
        const titlePos = bestPos(safeLower(it.title), terms);
        const routePos = bestPos(safeLower(canon), terms);

        const homePenalty = canon === "/" && titlePos === -1 && routePos === -1 ? 250 : 0;
        const navBoost = byRoute.get(normalizePathname(it.routePath))?.navGroup ? 180 : 0;
        const headings = readHeadings(it).join("\n");
        const exactTitle = safeLower(it.title).trim() === safeLower(q).trim();
        const exactRoute = safeLower(canon).trim() === safeLower(q).trim();
        const exactBoost = exactTitle ? 1800 : exactRoute ? 900 : 0;
        const score =
          scoreSearchResult({
            title: it.title,
            route: canon,
            text: `${headings}\n${it.text || ""}`.trim(),
            query: q,
            navBoost,
          }) + homePenalty - exactBoost;
        return { it, score, canon, typeKey };
      })
      .sort(
        (a, b) =>
          a.score - b.score ||
          String(a.it.title || "").localeCompare(String(b.it.title || "")) ||
          a.canon.localeCompare(b.canon),
      );

    const allMatches = dedupeByCanonicalRoute(allMatches0);

    const counts = { all: allMatches.length, pages: 0, blog: 0, databases: 0 };
    for (const m of allMatches) counts[m.typeKey] += 1;

    const filtered = allMatches.filter((m) => matchTypeKey(type, m.typeKey));
    const groups = buildGroupCounts(filtered.map((m) => groupLabelForRoutePath(m.canon)));
    const hasMore = offset + limit < filtered.length;

    const items: SearchItem[] = filtered.slice(offset, offset + limit).map(({ it, canon, typeKey }) => ({
      title: it.routePath === "/" ? "Home" : it.title || "Untitled",
      routePath: canon,
      kind: normalizeKindForTypeKey(typeKey),
      snippet: (() => {
        const headingsArr = readHeadings(it);
        const headings = headingsArr.join("\n");
        const body = String(it.text || "");
        // Prefer body snippets when the query matches body content; otherwise fall back to headings.
        const bodyPos = bestPos(safeLower(body), terms);
        const src = bodyPos >= 0 ? body : `${headings}\n${body}`.trim();
        return buildSnippetByTerms(src, terms);
      })(),
      breadcrumb: buildBreadcrumb(it.routePath, byRoute, byId) || (canon === "/" ? "Home" : ""),
    }));

    const meta: SearchMeta = {
      total: allMatches.length,
      filteredTotal: filtered.length,
      counts,
      groups,
      offset,
      limit,
      hasMore,
    };

    return json({
      items,
      meta,
    } satisfies SearchResponse);
  }

  const all = manifest;

  const allMatches = all
    .filter((it) => {
      const canon = canonicalizePublicRoute(it.routePath);
      if (!inScope(canon)) return false;
      const hay = `${safeLower(it.title)}\n${safeLower(canon)}\n${safeLower(it.id)}`;
      if (terms.length <= 1) return hay.includes(ql);
      return terms.every((t) => hay.includes(t));
    })
    .map((it) => {
      // Rank: title matches first, then route matches, then shorter routes.
      const canon = canonicalizePublicRoute(it.routePath);
      const typeKey = classifyType(it.kind, canon);
      const titlePos = bestPos(safeLower(it.title), terms);
      const routePos = bestPos(safeLower(canon), terms);
      const score =
        (titlePos === -1 ? 50 : titlePos) +
        (routePos === -1 ? 80 : routePos + 10) +
        Math.min(200, canon.length / 8);
      return { it, score, typeKey };
    })
    .sort(
      (a, b) =>
        a.score - b.score ||
        String(a.it.title || "").localeCompare(String(b.it.title || "")) ||
        canonicalizePublicRoute(a.it.routePath).localeCompare(canonicalizePublicRoute(b.it.routePath)),
    );

  const counts = { all: allMatches.length, pages: 0, blog: 0, databases: 0 };
  for (const m of allMatches) counts[m.typeKey] += 1;
  const filtered = allMatches.filter((m) => matchTypeKey(type, m.typeKey));
  const groups = buildGroupCounts(
    filtered.map((m) => groupLabelForRoutePath(canonicalizePublicRoute(m.it.routePath))),
  );
  const hasMore = offset + limit < filtered.length;

  const items: SearchItem[] = filtered.slice(offset, offset + limit).map(({ it, typeKey }) => ({
    title: it.routePath === "/" ? "Home" : it.title || "Untitled",
    routePath: canonicalizePublicRoute(it.routePath),
    kind: normalizeKindForTypeKey(typeKey),
    breadcrumb: buildBreadcrumb(it.routePath, byRoute, byId) || (it.routePath === "/" ? "Home" : ""),
  }));

  const meta: SearchMeta = {
    total: allMatches.length,
    filteredTotal: filtered.length,
    counts,
    groups,
    offset,
    limit,
    hasMore,
  };

  return json({
    items,
    meta,
  } satisfies SearchResponse);
}
