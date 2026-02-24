import { normalizePathname } from "@/lib/routes/strategy";
import { getSearchIndex } from "@/lib/search-index";
import { getRoutesManifest } from "@/lib/routes-manifest";
import { isIgnoredPath, normalizeQuery } from "@/lib/search/api-model";
import { buildSearchResponse, type SearchTypeParam } from "@/lib/search/api-service";
import { emptySearchResponse, type SearchResponse } from "@/lib/shared/search-contract";
import { noStoreErrorOnly, noStoreJson, withNoStoreApi } from "@/lib/server/api-response";
import { searchRichSnippetsFlag } from "@/lib/flags";

export const runtime = "nodejs";

const SEARCH_TYPES: SearchTypeParam[] = ["all", "page", "pages", "blog", "database", "databases"];

function isSearchTypeParam(value: string): value is SearchTypeParam {
  return SEARCH_TYPES.includes(value as SearchTypeParam);
}

export async function GET(req: Request) {
  return withNoStoreApi(async () => {
    const url = new URL(req.url);
    const q = normalizeQuery(url.searchParams.get("q") || "");
    if (!q) {
      return noStoreJson(emptySearchResponse({ limit: 20 }) satisfies SearchResponse);
    }

    const type = String(url.searchParams.get("type") || "all").trim().toLowerCase();
    if (!isSearchTypeParam(type)) {
      return noStoreErrorOnly("Invalid type", { status: 400 });
    }

    const offsetRaw = Number.parseInt(String(url.searchParams.get("offset") || "0"), 10);
    const offset = Math.max(0, Math.min(10_000, Number.isFinite(offsetRaw) ? offsetRaw : 0));

    const limitRaw = Number.parseInt(String(url.searchParams.get("limit") || "20"), 10);
    const limit = Math.max(1, Math.min(50, Number.isFinite(limitRaw) ? limitRaw : 20));
    const scopeRaw = String(url.searchParams.get("scope") || "").trim();
    const scope = scopeRaw && scopeRaw.startsWith("/") ? normalizePathname(scopeRaw) : "";
    const includeSnippets = await searchRichSnippetsFlag();
    const response = buildSearchResponse({
      q,
      type,
      offset,
      limit,
      scope,
      index: getSearchIndex().filter((it) => !isIgnoredPath(it.routePath)),
      manifest: getRoutesManifest().filter((it) => !isIgnoredPath(it.routePath)),
      includeSnippets,
    });
    return noStoreJson(response satisfies SearchResponse);
  }, { status: 500, fallback: "Search failed" });
}
