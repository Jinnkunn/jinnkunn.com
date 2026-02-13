/**
 * Shared search API contract and boundary parsing.
 * Keep this module runtime-safe for both Next.js routes and client code.
 */

const SEARCH_KIND_SET = new Set(["page", "blog", "database"]);

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function toStringTrimmed(value) {
  return String(value ?? "").trim();
}

export function normalizeSearchKind(value) {
  const raw = toStringTrimmed(value).toLowerCase();
  return SEARCH_KIND_SET.has(raw) ? raw : "page";
}

export function parseSearchItem(value) {
  if (!value || typeof value !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (value);
  const routePath = toStringTrimmed(o.routePath || "/") || "/";
  if (!routePath.startsWith("/")) return null;

  const title = toStringTrimmed(o.title) || "Untitled";
  const snippet = toStringTrimmed(o.snippet);
  const breadcrumb = toStringTrimmed(o.breadcrumb);

  return {
    title,
    routePath,
    kind: normalizeSearchKind(o.kind),
    snippet,
    breadcrumb,
  };
}

export function parseSearchItems(value) {
  const arr = Array.isArray(value) ? value : [];
  return arr
    .map(parseSearchItem)
    .filter((item) => Boolean(item));
}

export function parseSearchMeta(value) {
  if (!value || typeof value !== "object") return null;
  const m = /** @type {Record<string, unknown>} */ (value);
  const counts0 = m.counts;
  const countsObj =
    counts0 && typeof counts0 === "object"
      ? /** @type {Record<string, unknown>} */ (counts0)
      : null;

  const all = toFiniteNumber(countsObj?.all);
  const pages = toFiniteNumber(countsObj?.pages);
  const blog = toFiniteNumber(countsObj?.blog);
  const databases = toFiniteNumber(countsObj?.databases);

  const total = toFiniteNumber(m.total);
  const filteredTotal = toFiniteNumber(m.filteredTotal);
  const offset = toFiniteNumber(m.offset);
  const limit = toFiniteNumber(m.limit);
  const hasMore = Boolean(m.hasMore);

  if (
    ![all, pages, blog, databases, total, filteredTotal, offset, limit].every(
      (n) => Number.isFinite(n),
    )
  ) {
    return null;
  }

  const groups0 = m.groups;
  const groups = Array.isArray(groups0)
    ? groups0
        .map((g) => {
          if (!g || typeof g !== "object") return null;
          const gg = /** @type {Record<string, unknown>} */ (g);
          const label = toStringTrimmed(gg.label);
          const count = toFiniteNumber(gg.count);
          if (!label || !Number.isFinite(count)) return null;
          return { label, count };
        })
        .filter((g) => Boolean(g))
    : undefined;

  return {
    total,
    filteredTotal,
    counts: { all, pages, blog, databases },
    groups,
    offset,
    limit,
    hasMore,
  };
}

export function parseSearchResponse(value) {
  if (!value || typeof value !== "object") return { items: [], meta: null };
  const o = /** @type {{ items?: unknown; meta?: unknown }} */ (value);
  return {
    items: parseSearchItems(o.items),
    meta: parseSearchMeta(o.meta),
  };
}

export function emptySearchResponse({ limit = 20 } = {}) {
  return {
    items: [],
    meta: {
      total: 0,
      filteredTotal: 0,
      counts: { all: 0, pages: 0, blog: 0, databases: 0 },
      offset: 0,
      limit: Number.isFinite(Number(limit)) ? Number(limit) : 20,
      hasMore: false,
    },
  };
}
