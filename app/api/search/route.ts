import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ManifestItem = {
  id: string;
  title: string;
  kind: string;
  routePath: string;
  navGroup?: string;
  overridden?: boolean;
  parentId?: string;
};

type SearchIndexItem = {
  id: string;
  title: string;
  kind: string;
  routePath: string;
  text: string;
};

type CachedManifest = {
  mtimeMs: number;
  items: ManifestItem[];
};

let __cache: CachedManifest | null = null;
let __searchIndexCache: { mtimeMs: number; items: SearchIndexItem[] } | null = null;

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

function isObject(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === "object" && !Array.isArray(x);
}

function findSearchIndexFile(): string | null {
  const candidates = [
    path.join(process.cwd(), "content", "generated", "search-index.json"),
    path.join(process.cwd(), "content", "search-index.json"),
  ];
  for (const p of candidates) {
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

function findManifestFile(): string | null {
  const candidates = [
    path.join(process.cwd(), "content", "generated", "routes-manifest.json"),
    path.join(process.cwd(), "content", "routes-manifest.json"),
  ];
  for (const p of candidates) {
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

function readSearchIndex(): SearchIndexItem[] {
  const file = findSearchIndexFile();
  if (!file) return [];

  const st = fs.statSync(file);
  if (__searchIndexCache && __searchIndexCache.mtimeMs === st.mtimeMs) return __searchIndexCache.items;

  const raw = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(raw) as unknown;
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

  __searchIndexCache = { mtimeMs: st.mtimeMs, items };
  return items;
}

function readManifest(): ManifestItem[] {
  const file = findManifestFile();
  if (!file) return [];

  const st = fs.statSync(file);
  if (__cache && __cache.mtimeMs === st.mtimeMs) return __cache.items;

  const raw = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const items: ManifestItem[] = Array.isArray(parsed)
    ? parsed
        .map((x): ManifestItem | null => {
          if (!isObject(x)) return null;
          const it: ManifestItem = {
            id: String(x.id || ""),
            title: String(x.title || ""),
            kind: String(x.kind || ""),
            routePath: String(x.routePath || ""),
            navGroup: String(x.navGroup || ""),
            overridden: Boolean(x.overridden),
            parentId: String(x.parentId || ""),
          };
          if (!it.routePath) return null;
          return it;
        })
        .filter((x): x is ManifestItem => Boolean(x))
    : [];

  __cache = { mtimeMs: st.mtimeMs, items };
  return items;
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

function canonicalizePublicRoute(routePath: string): string {
  const p = normalizePath(routePath);
  if (p === "/blog/list") return "/blog";
  if (p.startsWith("/blog/list/")) return p.replace(/^\/blog\/list\//, "/blog/");
  if (p === "/list") return "/blog";
  if (p.startsWith("/list/")) return p.replace(/^\/list\//, "/blog/");
  return p;
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
  return false;
}

function buildSnippet(text: string, ql: string): string {
  const raw = String(text || "");
  const hay = safeLower(raw);
  const idx = hay.indexOf(ql);
  if (idx < 0) return "";

  // Keep it compact and readable; search overlay isn't a full preview.
  const radius = 70;
  const start = Math.max(0, idx - radius);
  const end = Math.min(raw.length, idx + ql.length + radius);
  let s = raw.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) s = `… ${s}`;
  if (end < raw.length) s = `${s} …`;
  return s;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = normalizeQuery(url.searchParams.get("q") || "");
  if (!q) return json({ items: [] });

  const ql = q.toLowerCase();
  const index = readSearchIndex().filter((it) => !isIgnoredPath(it.routePath));
  const manifest = readManifest().filter((it) => !isIgnoredPath(it.routePath));
  const byRoute = new Map<string, ManifestItem>();
  const byId = new Map<string, ManifestItem>();
  for (const it of manifest) {
    byRoute.set(normalizePath(it.routePath), it);
    const id = String(it.id || "").replace(/-/g, "").toLowerCase();
    if (id) byId.set(id, it);
  }

  // Prefer the richer, content-based index if present; otherwise fall back.
  if (index.length) {
    const matches = index
      .filter((it) => {
        const hay = `${safeLower(it.title)}\n${safeLower(it.routePath)}\n${safeLower(it.text)}`;
        return hay.includes(ql);
      })
      .map((it) => {
        const canon = canonicalizePublicRoute(it.routePath);
        const titlePos = safeLower(it.title).indexOf(ql);
        const routePos = safeLower(canon).indexOf(ql);
        const textPos = safeLower(it.text).indexOf(ql);
        const homePenalty = canon === "/" && titlePos === -1 && routePos === -1 ? 250 : 0;
        const textLenPenalty = Math.min(900, Math.floor(String(it.text || "").length / 140));
        // Rank: title > route > content. Earlier match positions are better.
        const score =
          (titlePos === -1 ? 5000 : titlePos) +
          (routePos === -1 ? 8000 : routePos + 50) +
          (textPos === -1 ? 12000 : textPos + 200) +
          homePenalty +
          textLenPenalty;
        return { it, score, canon };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, 20)
      .map(({ it, canon }) => ({
        title: it.routePath === "/" ? "Home" : it.title || "Untitled",
        routePath: canon,
        kind: it.kind || "page",
        snippet: buildSnippet(it.text || "", ql),
        breadcrumb: buildBreadcrumb(it.routePath, byRoute, byId) || (canon === "/" ? "Home" : ""),
      }));

    return json({ items: matches });
  }

  const all = manifest;

  const matches = all
    .filter((it) => {
      const hay = `${safeLower(it.title)}\n${safeLower(it.routePath)}\n${safeLower(it.id)}`;
      return hay.includes(ql);
    })
    .map((it) => {
      // Rank: title matches first, then route matches, then shorter routes.
      const titlePos = safeLower(it.title).indexOf(ql);
      const routePos = safeLower(it.routePath).indexOf(ql);
      const score =
        (titlePos === -1 ? 50 : titlePos) +
        (routePos === -1 ? 80 : routePos + 10) +
        Math.min(200, it.routePath.length / 8);
      return { it, score };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, 20)
    .map(({ it }) => ({
      title: it.routePath === "/" ? "Home" : it.title || "Untitled",
      routePath: canonicalizePublicRoute(it.routePath),
      kind: it.kind || "page",
      breadcrumb: buildBreadcrumb(it.routePath, byRoute, byId) || (it.routePath === "/" ? "Home" : ""),
    }));

  return json({ items: matches });
}
