import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { loadRawMainHtml } from "@/lib/load-raw-main";
import { blogSourceRouteForPublicPath } from "@/lib/routes/strategy.mjs";

export type BlogPostIndexItem = {
  kind: "list" | "page";
  slug: string;
  href: string;
  title: string;
  dateText: string | null;
  dateIso: string | null; // YYYY-MM-DD if parseable
};

function decodeEntities(s: string): string {
  return s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&#x2F;", "/");
}

function toIsoDate(dateText: string): string | null {
  const t = Date.parse(dateText);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function parseBlogMetaFromMain(mainHtml: string): {
  title: string;
  dateText: string | null;
  dateIso: string | null;
} {
  const title =
    decodeEntities(
      mainHtml.match(/class="notion-header__title">([\s\S]*?)<\/h1>/i)?.[1] ??
        ""
    )
      .replace(/<[^>]+>/g, "")
      .trim() || "Blog Post";

  const dateText =
    decodeEntities(
      mainHtml.match(/<span class="date">([^<]+)<\/span>/i)?.[1] ?? ""
    )
      .replace(/<[^>]+>/g, "")
      .trim() || null;

  const dateIso = dateText ? toIsoDate(dateText) : null;
  return { title, dateText, dateIso };
}

function parseRssItemPaths(rss: string): string[] {
  const items = Array.from(rss.matchAll(/<item>[\s\S]*?<\/item>/g)).map((m) => m[0]);
  const out: string[] = [];

  for (const item of items) {
    const link = item.match(/<link>([^<]+)<\/link>/)?.[1]?.trim();
    if (!link) continue;
    try {
      const u = new URL(link);
      // Only keep path; the runtime will serve locally.
      out.push(u.pathname);
    } catch {
      // ignore
    }
  }

  return Array.from(new Set(out));
}

async function tryReadLocalBlogRss(): Promise<string | null> {
  const p = path.join(process.cwd(), "public", "blog.rss");
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}

export async function getBlogPostSlugs(): Promise<string[]> {
  const dirs = [
    path.join(process.cwd(), "content", "generated", "raw", "blog", "list"),
    path.join(process.cwd(), "content", "raw", "blog", "list"),
  ];

  const out = new Set<string>();
  for (const dir of dirs) {
    try {
      const files = await readdir(dir);
      for (const f of files) {
        if (!f.endsWith(".html")) continue;
        const slug = f.slice(0, -".html".length);
        if (slug) out.add(slug);
      }
    } catch {
      // dir doesn't exist; skip
    }
  }

  return Array.from(out).sort();
}

export async function getBlogIndex(): Promise<BlogPostIndexItem[]> {
  const rss = await tryReadLocalBlogRss();
  const candidates = rss ? parseRssItemPaths(rss) : null;

  const items: BlogPostIndexItem[] = [];

  // Prefer the locally-synced HTML files (authoritative after Notion sync).
  // RSS is treated as a fallback for older builds that might not have files present.
  const slugs = await getBlogPostSlugs();
  const paths =
    slugs.length > 0
      ? slugs.map((s) => `/blog/${s}`)
      : candidates ?? [];

  for (const pathname of paths) {
    // Canonical blog post route: /blog/<slug>
    if (pathname.startsWith("/blog/") && !pathname.startsWith("/blog/list/")) {
      const src = blogSourceRouteForPublicPath(pathname);
      const slug = pathname.split("/").filter(Boolean)[1] || "";
      if (!slug || !src) continue;
      let main: string;
      try {
        // Source of truth stays under `blog/list/` (Notion structure); route is prettier.
        main = await loadRawMainHtml(src.replace(/^\/+/, ""));
      } catch {
        continue;
      }
      const meta = parseBlogMetaFromMain(main);
      items.push({
        kind: "list",
        slug,
        href: `/blog/${slug}`,
        title: meta.title,
        dateText: meta.dateText,
        dateIso: meta.dateIso,
      });
      continue;
    }

    const slug = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!slug) continue;

    try {
      const main = await loadRawMainHtml(slug);
      const meta = parseBlogMetaFromMain(main);
      items.push({
        kind: "page",
        slug,
        href: `/${slug}`,
        title: meta.title,
        dateText: meta.dateText,
        dateIso: meta.dateIso,
      });
    } catch {
      // If a page isn't a "blog-like" Notion page, skip it (prevents polluting /blog).
      continue;
    }
  }

  // Sort by date desc (unknown dates last), then by slug.
  items.sort((a, b) => {
    if (a.dateIso && b.dateIso) return a.dateIso < b.dateIso ? 1 : a.dateIso > b.dateIso ? -1 : 0;
    if (a.dateIso && !b.dateIso) return -1;
    if (!a.dateIso && b.dateIso) return 1;
    return a.href.localeCompare(b.href);
  });

  return items;
}

export async function getAdjacentBlogPosts(href: string): Promise<{
  prev: BlogPostIndexItem | null;
  next: BlogPostIndexItem | null;
}> {
  const idx = await getBlogIndex();
  const i = idx.findIndex((it) => it.href === href);
  if (i === -1) return { prev: null, next: null };
  // Newest first: "prev" means newer, "next" means older.
  return {
    prev: i > 0 ? idx[i - 1] : null,
    next: i < idx.length - 1 ? idx[i + 1] : null,
  };
}

export function extractArticleInnerFromMain(mainHtml: string): string {
  const m = mainHtml.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (!m) throw new Error("Could not find <article> in blog post");
  return m[1] ?? "";
}

type Heading = { id: string; level: 2 | 3; text: string };

export function extractHeadingsFromHtml(html: string): Heading[] {
  const out: Heading[] = [];
  const re = /<h([23])\b[^>]*\bid="(block-[^"]+)"[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const level = Number(m[1]) === 3 ? 3 : 2;
    const id = m[2];
    const raw = m[3] ?? "";
    const text = decodeEntities(raw.replace(/<[^>]+>/g, "")).trim();
    if (!text) continue;
    out.push({ id, level: level as 2 | 3, text });
  }
  return out;
}

export function splitBlogArticleInner(articleInner: string): {
  propertiesHtml: string;
  bodyHtml: string;
} {
  const propsClassIdx = articleInner.indexOf('class="notion-page__properties"');
  if (propsClassIdx === -1) {
    return { propertiesHtml: "", bodyHtml: articleInner };
  }

  const propsStart = articleInner.lastIndexOf("<div", propsClassIdx);
  if (propsStart === -1) {
    return { propertiesHtml: "", bodyHtml: articleInner };
  }

  // Find the first TOC `<ul ... notion-table-of-contents ...>` after properties.
  const tocClassIdx = articleInner.indexOf("notion-table-of-contents", propsStart);
  if (tocClassIdx === -1) {
    return { propertiesHtml: articleInner.slice(propsStart), bodyHtml: "" };
  }

  const ulStart = articleInner.lastIndexOf("<ul", tocClassIdx);
  const ulEnd = articleInner.indexOf("</ul>", tocClassIdx);
  if (ulStart === -1 || ulEnd === -1) {
    return { propertiesHtml: articleInner, bodyHtml: "" };
  }

  const propertiesHtml = articleInner.slice(propsStart, ulStart);
  const bodyHtml = articleInner.slice(ulEnd + "</ul>".length);
  return { propertiesHtml, bodyHtml };
}
