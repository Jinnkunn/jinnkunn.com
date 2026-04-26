// High-level posts CRUD that wraps the generic content store.
// All paths live under `posts/` inside the content root.

import "server-only";

import {
  ContentStoreConflictError,
  ContentStoreNotFoundError,
  type ContentStore,
  type ContentVersion,
} from "@/lib/server/content-store";
import { getContentStore } from "@/lib/server/content-store-resolver";
import { appendRedirect } from "@/lib/redirects";
import { parsePostFile } from "./meta";
import { assertValidSlug } from "./slug";
import type { PostEntry } from "./types";

const POSTS_DIR = "posts";

function postRelPath(slug: string): string {
  return `${POSTS_DIR}/${slug}.mdx`;
}

export type PostListItem = {
  entry: PostEntry;
  version: ContentVersion;
};

export type PostDetail = PostListItem & {
  source: string;
};

async function getStore(): Promise<ContentStore> {
  return getContentStore();
}

export { ContentStoreConflictError, ContentStoreNotFoundError };

export async function listPosts(opts?: {
  includeDrafts?: boolean;
}): Promise<PostListItem[]> {
  const store = await getStore();
  const files = await store.listFiles(POSTS_DIR);
  const out: PostListItem[] = [];
  for (const file of files) {
    if (!file.name.endsWith(".mdx") && !file.name.endsWith(".md")) continue;
    const slug = file.name.replace(/\.mdx?$/, "");
    if (!slug) continue;
    const fetched = await store.readFile(file.relPath);
    if (!fetched) continue;
    try {
      const { entry } = parsePostFile(slug, fetched.content);
      if (!opts?.includeDrafts && entry.draft) continue;
      out.push({ entry, version: fetched.sha });
    } catch {
      // Skip unparsable posts but do not fail the whole list.
      continue;
    }
  }
  out.sort((a, b) =>
    a.entry.dateIso < b.entry.dateIso ? 1 : a.entry.dateIso > b.entry.dateIso ? -1 : 0,
  );
  return out;
}

export async function readPost(slug: string): Promise<PostDetail | null> {
  assertValidSlug(slug);
  const store = await getStore();
  const file = await store.readFile(postRelPath(slug));
  if (!file) return null;
  const { entry } = parsePostFile(slug, file.content);
  return { entry, version: file.sha, source: file.content };
}

export async function createPost(
  slug: string,
  source: string,
): Promise<PostDetail> {
  assertValidSlug(slug);
  // Validate frontmatter + body before touching the store.
  parsePostFile(slug, source);
  const store = await getStore();
  // `ifMatch: null` enforces "must not already exist".
  const { sha } = await store.writeFile(postRelPath(slug), source, { ifMatch: null });
  const { entry } = parsePostFile(slug, source);
  return { entry, version: sha, source };
}

export async function updatePost(
  slug: string,
  source: string,
  ifMatch: ContentVersion,
): Promise<PostDetail> {
  assertValidSlug(slug);
  parsePostFile(slug, source);
  const store = await getStore();
  const { sha } = await store.writeFile(postRelPath(slug), source, { ifMatch });
  const { entry } = parsePostFile(slug, source);
  return { entry, version: sha, source };
}

export async function deletePost(
  slug: string,
  ifMatch: ContentVersion,
): Promise<void> {
  assertValidSlug(slug);
  const store = await getStore();
  await store.deleteFile(postRelPath(slug), { ifMatch });
}

/** Rename a post to a new (still-flat) slug. Mirrors lib/pages/store's
 * movePage: read source → write at new slug (must be vacant) → delete
 * the old. Writes a redirect entry on success so /blog/<oldSlug> keeps
 * resolving via next.config.mjs.redirects(). Posts are flat by design,
 * so this is a pure rename with no reparent semantics. */
export async function movePost(
  fromSlug: string,
  toSlug: string,
  ifMatch: ContentVersion,
): Promise<PostDetail> {
  assertValidSlug(fromSlug);
  assertValidSlug(toSlug);
  if (fromSlug === toSlug) {
    throw new Error("source and target slug are identical");
  }
  const store = await getStore();
  const existing = await store.readFile(postRelPath(fromSlug));
  if (!existing) {
    throw new ContentStoreNotFoundError(`post not found: ${fromSlug}`);
  }
  if (existing.sha !== ifMatch) {
    throw new ContentStoreConflictError({
      expected: ifMatch,
      actual: existing.sha,
    });
  }
  const targetExisting = await store.readFile(postRelPath(toSlug));
  if (targetExisting) {
    throw new Error(`post already exists at ${toSlug}`);
  }
  const { sha } = await store.writeFile(postRelPath(toSlug), existing.content, {
    ifMatch: null,
  });
  await store.deleteFile(postRelPath(fromSlug), { ifMatch: existing.sha });
  try {
    await appendRedirect("posts", fromSlug, toSlug);
  } catch {
    // see movePage — losing the redirect is recoverable later
  }
  const { entry } = parsePostFile(toSlug, existing.content);
  return { entry, version: sha, source: existing.content };
}
