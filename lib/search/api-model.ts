import { canonicalizePublicRoute, normalizePathname } from "../routes/strategy.ts";
import { groupLabelForSearchResult, sortGroupLabels } from "../shared/search-group.ts";
import { normalizeSearchKind, type SearchItem } from "../shared/search-contract.ts";
import { tokenizeQuery } from "../shared/text-utils.ts";

export type TypeKey = "pages" | "blog" | "databases";

export type SearchManifestItem = {
  id: string;
  parentId?: string;
  routePath: string;
  title: string;
  kind: string;
  navGroup?: string;
};

export type SearchIndexItem = {
  routePath: string;
  title: string;
  kind: string;
  text?: string;
  headings?: unknown;
};

export function safeLower(s: unknown): string {
  return String(s ?? "").toLowerCase();
}

export function readHeadings(item: SearchIndexItem): string[] {
  const raw = item.headings;
  if (!Array.isArray(raw)) return [];
  return raw.map((value) => String(value || "")).filter(Boolean);
}

export function normalizeQuery(q: string): string {
  // Keep queries stable and bounded to avoid expensive scans.
  return q.trim().replace(/\s+/g, " ").slice(0, 200);
}

export function buildGroupCounts(labels: string[]): Array<{ label: string; count: number }> {
  const counts: Record<string, number> = {};
  for (const l0 of labels) {
    const l = String(l0 || "").trim();
    if (!l) continue;
    counts[l] = (counts[l] || 0) + 1;
  }
  const ordered = sortGroupLabels(Object.keys(counts));
  return ordered.map((label) => ({ label, count: counts[label] || 0 }));
}

export function buildBreadcrumb(
  routePath: string,
  byRoute: Map<string, SearchManifestItem>,
  byId: Map<string, SearchManifestItem>,
): string {
  const startRoute = normalizePathname(routePath);
  const start = byRoute.get(startRoute) || null;
  if (!start) return "";

  const parts: Array<{ title: string; routePath: string }> = [];
  const seen = new Set<string>();

  let cur: SearchManifestItem | null = start;
  let guard = 0;
  while (cur && guard++ < 200) {
    const id = String(cur.id || "").replace(/-/g, "").toLowerCase();
    if (!id || seen.has(id)) break;
    seen.add(id);

    const rp = normalizePathname(String(cur.routePath || "/"));
    const title = rp === "/" ? "Home" : String(cur.title || "").trim() || "Untitled";

    // Hide internal list helpers in breadcrumbs:
    // - Blog database pages often sit under /blog/list.
    // - We want: Home / Blog / Post
    const hide =
      rp === "/blog/list" ||
      rp === "/list" ||
      String(cur.title || "").trim().toLowerCase() === "list";

    if (!hide) parts.push({ title, routePath: rp });

    const pid = String(cur.parentId || "").replace(/-/g, "").toLowerCase();
    cur = pid ? byId.get(pid) || null : null;
  }

  parts.reverse();
  const out: string[] = [];
  for (const p of parts) {
    if (!out.length || out[out.length - 1] !== p.title) out.push(p.title);
  }
  return out.join(" / ");
}

export function isIgnoredPath(routePath: string): boolean {
  const p = normalizePathname(routePath || "/");
  if (p.startsWith("/_next")) return true;
  if (p.startsWith("/api/")) return true;
  if (p === "/auth") return true;
  if (p.startsWith("/site-admin/")) return true; // keep admin out of normal search
  // Hide internal blog database helpers (they are implementation details).
  if (p === "/blog/list" || p === "/list") return true;
  return false;
}

export function classifyType(kind: string, routePath: string): TypeKey {
  const p = canonicalizePublicRoute(routePath);
  const k = String(kind || "").toLowerCase();
  if (k === "database") return "databases";
  if (p === "/blog" || p.startsWith("/blog/")) {
    // Treat the backing DB helpers as "databases" even if exported as pages.
    const raw = normalizePathname(routePath);
    if (
      raw === "/blog/list" ||
      raw.startsWith("/blog/list/") ||
      raw === "/list" ||
      raw.startsWith("/list/")
    ) {
      return "databases";
    }
    return "blog";
  }
  return "pages";
}

export function matchTypeKey(type: string, key: TypeKey): boolean {
  const t = String(type || "all")
    .trim()
    .toLowerCase();
  if (t === "database" || t === "databases") return key === "databases";
  if (t === "blog") return key === "blog";
  if (t === "page" || t === "pages") return key === "pages";
  return true;
}

export function kindForTypeKey(typeKey: TypeKey): SearchItem["kind"] {
  if (typeKey === "blog") return "blog";
  if (typeKey === "databases") return "database";
  return "page";
}

export function groupLabelForTypeAndRoute(typeKey: TypeKey, routePath: string): string {
  return groupLabelForSearchResult(kindForTypeKey(typeKey), routePath);
}

export function normalizeKindForTypeKey(typeKey: TypeKey): SearchItem["kind"] {
  return normalizeSearchKind(kindForTypeKey(typeKey));
}

export function bestPos(hay: string, terms: string[]): number {
  let best = -1;
  for (const t of terms) {
    if (!t) continue;
    const i = hay.indexOf(t);
    if (i < 0) continue;
    if (best === -1 || i < best) best = i;
  }
  return best;
}

export function dedupeByCanonicalRoute<T extends { canon: string; score: number }>(arr: T[]): T[] {
  // Keep the best (lowest score) match per canonical public routePath.
  const out: T[] = [];
  const seen = new Set<string>();
  for (const it of arr) {
    const k = String(it.canon || "").trim() || "/";
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

export function buildSnippetByTerms(text: string, terms: string[]): string {
  const raw0 = String(text || "");
  const raw = raw0.replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const hay = safeLower(raw);
  const idx = bestPos(hay, terms);
  if (idx < 0) {
    // If the query matched the title/route but not the content, still show a
    // stable excerpt so results don't look "empty".
    const maxLen = 190;
    let snippet = raw.slice(0, maxLen).trim();
    if (raw.length > snippet.length) snippet = `${snippet} …`;
    return snippet;
  }

  // Prefer sentence boundaries for a more readable excerpt.
  const maxLen = 190;
  const leftWindow = 140;
  const rightWindow = 180;

  const lookLeft = raw.slice(Math.max(0, idx - leftWindow), idx);
  const lookRight = raw.slice(idx, Math.min(raw.length, idx + rightWindow));

  const leftBoundaryCandidates = [
    lookLeft.lastIndexOf(". "),
    lookLeft.lastIndexOf("! "),
    lookLeft.lastIndexOf("? "),
    lookLeft.lastIndexOf("; "),
  ];
  let leftBoundary = Math.max(...leftBoundaryCandidates);
  if (leftBoundary < 0) leftBoundary = lookLeft.lastIndexOf(" ");
  const start = Math.max(0, idx - lookLeft.length + (leftBoundary >= 0 ? leftBoundary + 2 : 0));

  const rightBoundaryCandidates = [
    lookRight.indexOf(". "),
    lookRight.indexOf("! "),
    lookRight.indexOf("? "),
    lookRight.indexOf("; "),
  ].filter((n) => n >= 0);
  let end = Math.min(raw.length, idx + lookRight.length);
  if (rightBoundaryCandidates.length) {
    end = Math.min(end, idx + Math.min(...rightBoundaryCandidates) + 1);
  } else {
    // fallback to a word boundary
    const s = raw.slice(idx, Math.min(raw.length, idx + rightWindow));
    const sp = s.lastIndexOf(" ");
    if (sp > 60) end = idx + sp;
  }

  // Clamp and add ellipses.
  let snippet = raw.slice(start, end).trim();
  if (snippet.length > maxLen) snippet = snippet.slice(0, maxLen).trim();
  if (start > 0) snippet = `… ${snippet}`;
  if (end < raw.length) snippet = `${snippet} …`;
  return snippet;
}

export function tokenizeSearchQuery(query: string): string[] {
  return tokenizeQuery(query);
}
