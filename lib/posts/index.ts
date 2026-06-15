import "server-only";

import { listPosts, readPost } from "./store";
import type { PostEntry } from "./types";

function postFilename(slug: string): string {
  return `content/posts/${slug}.mdx`;
}

export async function getPostSlugs(
  opts?: { includeDrafts?: boolean },
): Promise<string[]> {
  const posts = await listPosts(opts);
  return posts.map((post) => post.entry.slug).sort();
}

export async function hasPost(slug: string): Promise<boolean> {
  try {
    return Boolean(await readPost(slug));
  } catch {
    return false;
  }
}

export async function readPostSource(slug: string): Promise<{
  source: string;
  filename: string;
} | null> {
  try {
    const post = await readPost(slug);
    if (!post) return null;
    return { source: post.source, filename: postFilename(slug) };
  } catch {
    return null;
  }
}

export async function getPostEntry(slug: string): Promise<PostEntry | null> {
  try {
    return (await readPost(slug))?.entry ?? null;
  } catch {
    return null;
  }
}

export async function getPostEntries(
  opts?: { includeDrafts?: boolean },
): Promise<PostEntry[]> {
  const posts = await listPosts(opts);
  return posts.map((post) => post.entry);
}
