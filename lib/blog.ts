import { getPostEntries } from "@/lib/posts/index";

export type BlogPostIndexItem = {
  kind: "list" | "page";
  slug: string;
  href: string;
  title: string;
  dateText: string | null;
  dateIso: string | null; // YYYY-MM-DD if parseable
  description?: string | null; // First substantive paragraph, trimmed ~200 chars
  wordCount?: number | null;
  readingMinutes?: number | null;
};

/** Sorted list of all published blog post slugs, read from
 * `content/posts/*.mdx`. Drafts are excluded in getPostEntries. */
export async function getBlogPostSlugs(): Promise<string[]> {
  const entries = await getPostEntries();
  return entries.map((e) => e.slug).sort();
}

/** Return all blog posts sorted newest-first. Single source of truth is
 * the MDX store under `content/posts/`. */
export async function getBlogIndex(): Promise<BlogPostIndexItem[]> {
  const entries = await getPostEntries();
  const items: BlogPostIndexItem[] = entries.map((post) => ({
    kind: "list",
    slug: post.slug,
    href: post.href,
    title: post.title,
    dateText: post.dateText,
    dateIso: post.dateIso,
    description: post.description,
    wordCount: post.wordCount,
    readingMinutes: post.readingMinutes,
  }));

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
