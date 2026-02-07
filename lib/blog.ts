import { readdir } from "node:fs/promises";
import path from "node:path";

import { loadRawMainHtml } from "@/lib/load-raw-main";

export type BlogPostIndexItem = {
  slug: string;
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

export async function getBlogPostSlugs(): Promise<string[]> {
  const dir = path.join(process.cwd(), "content", "raw", "blog", "list");
  const files = await readdir(dir);
  return files
    .filter((f) => f.endsWith(".html"))
    .map((f) => f.slice(0, -".html".length))
    .sort();
}

export async function getBlogIndex(): Promise<BlogPostIndexItem[]> {
  const slugs = await getBlogPostSlugs();
  const items: BlogPostIndexItem[] = [];

  for (const slug of slugs) {
    const main = await loadRawMainHtml(`blog/list/${slug}`);
    const meta = parseBlogMetaFromMain(main);
    items.push({ slug, title: meta.title, dateText: meta.dateText, dateIso: meta.dateIso });
  }

  // Sort by date desc (unknown dates last), then by slug.
  items.sort((a, b) => {
    if (a.dateIso && b.dateIso) return a.dateIso < b.dateIso ? 1 : a.dateIso > b.dateIso ? -1 : 0;
    if (a.dateIso && !b.dateIso) return -1;
    if (!a.dateIso && b.dateIso) return 1;
    return a.slug.localeCompare(b.slug);
  });

  return items;
}

export async function getAdjacentBlogPosts(slug: string): Promise<{
  prev: BlogPostIndexItem | null;
  next: BlogPostIndexItem | null;
}> {
  const idx = await getBlogIndex();
  const i = idx.findIndex((it) => it.slug === slug);
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
