import { normalizePathname } from "@/lib/routes/strategy";
import { getSearchIndex } from "@/lib/search-index";
import { getRoutesManifest } from "@/lib/routes-manifest";
import { isIgnoredPath, normalizeQuery } from "@/lib/search/api-model";
import { buildSearchResponse, type SearchTypeParam } from "@/lib/search/api-service";
import { emptySearchResponse, type SearchResponse } from "@/lib/shared/search-contract";
import { noStoreErrorOnly, noStoreJson, withNoStoreApi } from "@/lib/server/api-response";
import { searchRichSnippetsFlag } from "@/lib/flags";
import generatedSearchIndex from "@/content/generated/search-index.json";
import generatedRoutesManifest from "@/content/generated/routes-manifest.json";
import type { SearchIndexItem } from "@/lib/search-index";
import type { RouteManifestItem } from "@/lib/routes-manifest";

export const runtime = "nodejs";

const SEARCH_TYPES: SearchTypeParam[] = ["all", "page", "pages", "blog", "database", "databases"];

// The generated search-index + routes-manifest are immutable for the
// lifetime of a runtime instance — they come from files baked into the
// deploy and never change until redeploy. Normalising them on every
// request was wasted CPU (especially painful on Workers Free under the
// 10ms/request cap). Compute once per isolate and reuse.
let cachedFallbackIndex: SearchIndexItem[] | null = null;
let cachedFallbackManifest: RouteManifestItem[] | null = null;

function getFallbackIndex(): SearchIndexItem[] {
  if (cachedFallbackIndex === null) {
    cachedFallbackIndex = normalizeSearchIndexSnapshot(generatedSearchIndex);
  }
  return cachedFallbackIndex;
}

function getFallbackManifest(): RouteManifestItem[] {
  if (cachedFallbackManifest === null) {
    cachedFallbackManifest = normalizeRoutesManifestSnapshot(generatedRoutesManifest);
  }
  return cachedFallbackManifest;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeSearchIndexSnapshot(raw: unknown): SearchIndexItem[] {
  if (!Array.isArray(raw)) return [];
  const out: SearchIndexItem[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row) continue;
    const routePath = String(row.routePath || "");
    if (!routePath) continue;
    out.push({
      id: String(row.id || ""),
      title: String(row.title || ""),
      kind: String(row.kind || ""),
      routePath,
      headings: Array.isArray(row.headings)
        ? row.headings.map((s) => String(s || "").trim()).filter(Boolean)
        : undefined,
      text: String(row.text || ""),
    });
  }
  return out;
}

function normalizeRoutesManifestSnapshot(raw: unknown): RouteManifestItem[] {
  if (!Array.isArray(raw)) return [];
  const out: RouteManifestItem[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row) continue;
    const id = String(row.id || "");
    const routePath = String(row.routePath || "");
    if (!id || !routePath) continue;
    out.push({
      id,
      title: String(row.title || ""),
      kind: String(row.kind || ""),
      routePath,
      parentId: String(row.parentId || ""),
      parentRoutePath: String(row.parentRoutePath || "/"),
      navGroup: String(row.navGroup || ""),
      overridden: Boolean(row.overridden),
    });
  }
  return out;
}

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
    const liveIndex = getSearchIndex();
    const liveManifest = getRoutesManifest();
    const indexSource = liveIndex.length > 0 ? liveIndex : getFallbackIndex();
    const manifestSource = liveManifest.length > 0 ? liveManifest : getFallbackManifest();
    const response = buildSearchResponse({
      q,
      type,
      offset,
      limit,
      scope,
      index: indexSource.filter((it) => !isIgnoredPath(it.routePath)),
      manifest: manifestSource.filter((it) => !isIgnoredPath(it.routePath)),
      includeSnippets,
    });
    return noStoreJson(response satisfies SearchResponse);
  }, { status: 500, fallback: "Search failed" });
}
