import { getPostEntries } from "@/lib/posts/index";
import { adjacentBlogDocuments, compareBlogDocuments } from "./posts/navigation";

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

  items.sort(compareBlogDocuments);

  return items;
}

export async function getAdjacentBlogPosts(href: string): Promise<{
  prev: BlogPostIndexItem | null;
  next: BlogPostIndexItem | null;
}> {
  const idx = await getBlogIndex();
  return adjacentBlogDocuments(idx, href);
}
