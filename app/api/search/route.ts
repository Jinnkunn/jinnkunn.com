import { NextResponse } from "next/server";

import { canonicalizePublicRoute } from "@/lib/routes/strategy.mjs";
import { getSearchIndex } from "@/lib/search-index";
import { getRoutesManifest } from "@/lib/routes-manifest";
import { scoreSearchResult } from "@/lib/search/rank.mjs";
import { groupLabelForRoutePath, sortGroupLabels } from "@/lib/shared/search-group.mjs";
import { tokenizeQuery } from "@/lib/shared/text-utils";

export const runtime = "nodejs";

type ManifestItem = ReturnType<typeof getRoutesManifest>[number];

type TypeKey = "pages" | "blog" | "databases";

type SearchIndexItem = ReturnType<typeof getSearchIndex>[number];

function json(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: {
      "cache-control": "no-store",
    },
  });
}

function safeLower(s: unknown): string {
  return String(s ?? "").toLowerCase();
}

function readSearchIndex(): SearchIndexItem[] {
  return getSearchIndex();
}

function readManifest(): ManifestItem[] {
  return getRoutesManifest();
}

function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, " ");
}

function normalizePath(p: string): string {
  const s = String(p || "").trim();
  if (!s) return "/";
  if (s === "/") return "/";
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function buildGroupCounts(labels: string[]): Array<{ label: string; count: number }> {
  const counts: Record<string, number> = {};
  for (const l0 of labels) {
    const l = String(l0 || "").trim();
    if (!l) continue;
    counts[l] = (counts[l] || 0) + 1;
  }
  const ordered = sortGroupLabels(Object.keys(counts));
  return ordered.map((label) => ({ label, count: counts[label] || 0 }));
}

function buildBreadcrumb(
  routePath: string,
  byRoute: Map<string, ManifestItem>,
  byId: Map<string, ManifestItem>,
): string {
  const startRoute = normalizePath(routePath);
  const start = byRoute.get(startRoute) || null;
  if (!start) return "";

  const parts: Array<{ title: string; routePath: string }> = [];
  const seen = new Set<string>();

  let cur: ManifestItem | null = start;
  let guard = 0;
  while (cur && guard++ < 200) {
    const id = String(cur.id || "").replace(/-/g, "").toLowerCase();
    if (!id || seen.has(id)) break;
    seen.add(id);

    const rp = normalizePath(String(cur.routePath || "/"));
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

function isIgnoredPath(routePath: string): boolean {
  const p = routePath || "/";
  if (p.startsWith("/_next")) return true;
  if (p.startsWith("/api/")) return true;
  if (p === "/auth") return true;
  if (p.startsWith("/site-admin/")) return true; // keep admin out of normal search
  // Hide internal blog database helpers (they are implementation details).
  if (p === "/blog/list" || p === "/list") return true;
  return false;
}

function classifyType(kind: string, routePath: string): TypeKey {
  const p = canonicalizePublicRoute(routePath);
  const k = String(kind || "").toLowerCase();
  if (k === "database") return "databases";
  if (p === "/blog" || p.startsWith("/blog/")) {
    // Treat the backing DB helpers as "databases" even if exported as pages.
    const raw = normalizePath(routePath);
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

function matchTypeKey(type: string, key: TypeKey): boolean {
  const t = String(type || "all")
    .trim()
    .toLowerCase();
  if (t === "database" || t === "databases") return key === "databases";
  if (t === "blog") return key === "blog";
  if (t === "page" || t === "pages") return key === "pages";
  return true;
}

function bestPos(hay: string, terms: string[]): number {
  let best = -1;
  for (const t of terms) {
    if (!t) continue;
    const i = hay.indexOf(t);
    if (i < 0) continue;
    if (best === -1 || i < best) best = i;
  }
  return best;
}

function buildSnippetByTerms(text: string, terms: string[]): string {
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = normalizeQuery(url.searchParams.get("q") || "");
  if (!q) {
    return json({
      items: [],
      meta: {
        total: 0,
        filteredTotal: 0,
        counts: { all: 0, pages: 0, blog: 0, databases: 0 },
        offset: 0,
        limit: 20,
        hasMore: false,
      },
    });
  }

  const type = String(url.searchParams.get("type") || "all")
    .trim()
    .toLowerCase();
  const offset = Math.max(0, Number.parseInt(String(url.searchParams.get("offset") || "0"), 10) || 0);
  const limitRaw = Number.parseInt(String(url.searchParams.get("limit") || "20"), 10);
  const limit = Math.max(1, Math.min(50, Number.isFinite(limitRaw) ? limitRaw : 20));
  const scopeRaw = String(url.searchParams.get("scope") || "").trim();
  const scope = scopeRaw && scopeRaw.startsWith("/") ? normalizePath(scopeRaw) : "";

  const ql = q.toLowerCase();
  const terms = tokenizeQuery(q);
  const index = readSearchIndex().filter((it) => !isIgnoredPath(it.routePath));
  const manifest = readManifest().filter((it) => !isIgnoredPath(it.routePath));
  const byRoute = new Map<string, ManifestItem>();
  const byId = new Map<string, ManifestItem>();
  for (const it of manifest) {
    byRoute.set(normalizePath(it.routePath), it);
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
    const allMatches = index
      .filter((it) => {
        const canon = canonicalizePublicRoute(it.routePath);
        if (!inScope(canon)) return false;
        const headings = Array.isArray((it as { headings?: unknown }).headings)
          ? String(((it as { headings?: string[] }).headings || []).join("\n") || "")
          : "";
        const hay = `${safeLower(it.title)}\n${safeLower(canon)}\n${safeLower(headings)}\n${safeLower(it.text)}`;
        if (terms.length <= 1) return hay.includes(ql);
        return terms.every((t) => hay.includes(t));
      })
      .map((it) => {
        const canon = canonicalizePublicRoute(it.routePath);
        const typeKey = classifyType(it.kind, canon);
        const titlePos = bestPos(safeLower(it.title), terms);
        const routePos = bestPos(safeLower(canon), terms);
        const textPos = bestPos(safeLower(it.text), terms);

        const homePenalty = canon === "/" && titlePos === -1 && routePos === -1 ? 250 : 0;
        const navBoost = byRoute.get(normalizePath(it.routePath))?.navGroup ? 180 : 0;
        const headings = Array.isArray((it as { headings?: unknown }).headings)
          ? String(((it as { headings?: string[] }).headings || []).join("\n") || "")
          : "";
        const score =
          scoreSearchResult({
            title: it.title,
            route: canon,
            text: `${headings}\n${it.text || ""}`.trim(),
            query: q,
            navBoost,
          }) + homePenalty;
        return { it, score, canon, typeKey };
      })
      .sort(
        (a, b) =>
          a.score - b.score ||
          String(a.it.title || "").localeCompare(String(b.it.title || "")) ||
          a.canon.localeCompare(b.canon),
      );

    const counts = { all: allMatches.length, pages: 0, blog: 0, databases: 0 };
    for (const m of allMatches) counts[m.typeKey] += 1;

    const filtered = allMatches.filter((m) => matchTypeKey(type, m.typeKey));
    const groups = buildGroupCounts(filtered.map((m) => groupLabelForRoutePath(m.canon)));
    const hasMore = offset + limit < filtered.length;

    const items = filtered.slice(offset, offset + limit).map(({ it, canon }) => ({
      title: it.routePath === "/" ? "Home" : it.title || "Untitled",
      routePath: canon,
      kind: it.kind || "page",
      snippet: buildSnippetByTerms(it.text || "", terms),
      breadcrumb: buildBreadcrumb(it.routePath, byRoute, byId) || (canon === "/" ? "Home" : ""),
    }));

    return json({
      items,
      meta: {
        total: allMatches.length,
        filteredTotal: filtered.length,
        counts,
        groups,
        offset,
        limit,
        hasMore,
      },
    });
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

  const items = filtered.slice(offset, offset + limit).map(({ it }) => ({
    title: it.routePath === "/" ? "Home" : it.title || "Untitled",
    routePath: canonicalizePublicRoute(it.routePath),
    kind: it.kind || "page",
    breadcrumb: buildBreadcrumb(it.routePath, byRoute, byId) || (it.routePath === "/" ? "Home" : ""),
  }));

  return json({
    items,
    meta: { total: allMatches.length, filteredTotal: filtered.length, counts, groups, offset, limit, hasMore },
  });
}
