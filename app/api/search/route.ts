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

  // Prefer the richer, content-based index if present; otherwise fall back.
  if (index.length) {
    const matches = index
      .filter((it) => {
        const hay = `${safeLower(it.title)}\n${safeLower(it.routePath)}\n${safeLower(it.text)}`;
        return hay.includes(ql);
      })
      .map((it) => {
        const titlePos = safeLower(it.title).indexOf(ql);
        const routePos = safeLower(it.routePath).indexOf(ql);
        const textPos = safeLower(it.text).indexOf(ql);
        // Rank: title > route > content. Earlier match positions are better.
        const score =
          (titlePos === -1 ? 5000 : titlePos) +
          (routePos === -1 ? 8000 : routePos + 50) +
          (textPos === -1 ? 12000 : textPos + 200) +
          Math.min(300, it.routePath.length * 2);
        return { it, score };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, 20)
      .map(({ it }) => ({
        title: it.routePath === "/" ? "Home" : it.title || "Untitled",
        routePath: it.routePath,
        kind: it.kind || "page",
        snippet: buildSnippet(it.text || "", ql),
      }));

    return json({ items: matches });
  }

  const all = readManifest().filter((it) => !isIgnoredPath(it.routePath));

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
      routePath: it.routePath,
      kind: it.kind || "page",
    }));

  return json({ items: matches });
}
