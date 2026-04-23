// High-level pages CRUD over the generic ContentStore.

import {
  ContentStoreConflictError,
  ContentStoreNotFoundError,
  type ContentStore,
  type ContentVersion,
} from "@/lib/server/content-store";
import { getContentStore } from "@/lib/server/content-store-resolver";
import { parsePageFile } from "./meta";
import { assertValidSlug } from "@/lib/posts/slug"; // pages reuse the same slug rules
import type { PageEntry } from "./types";

const PAGES_DIR = "pages";

function pageRelPath(slug: string): string {
  return `${PAGES_DIR}/${slug}.mdx`;
}

export type PageListItem = {
  entry: PageEntry;
  version: ContentVersion;
};

export type PageDetail = PageListItem & {
  source: string;
};

async function getStore(): Promise<ContentStore> {
  return getContentStore();
}

export { ContentStoreConflictError, ContentStoreNotFoundError };

export async function listPages(opts?: {
  includeDrafts?: boolean;
}): Promise<PageListItem[]> {
  const store = await getStore();
  const files = await store.listFiles(PAGES_DIR);
  const out: PageListItem[] = [];
  for (const file of files) {
    if (!file.name.endsWith(".mdx") && !file.name.endsWith(".md")) continue;
    const slug = file.name.replace(/\.mdx?$/, "");
    if (!slug) continue;
    const fetched = await store.readFile(file.relPath);
    if (!fetched) continue;
    try {
      const { entry } = parsePageFile(slug, fetched.content);
      if (!opts?.includeDrafts && entry.draft) continue;
      out.push({ entry, version: fetched.sha });
    } catch {
      continue;
    }
  }
  out.sort((a, b) => a.entry.title.localeCompare(b.entry.title));
  return out;
}

export async function readPage(slug: string): Promise<PageDetail | null> {
  assertValidSlug(slug);
  const store = await getStore();
  const file = await store.readFile(pageRelPath(slug));
  if (!file) return null;
  const { entry } = parsePageFile(slug, file.content);
  return { entry, version: file.sha, source: file.content };
}

export async function createPage(
  slug: string,
  source: string,
): Promise<PageDetail> {
  assertValidSlug(slug);
  parsePageFile(slug, source);
  const store = await getStore();
  const { sha } = await store.writeFile(pageRelPath(slug), source, { ifMatch: null });
  const { entry } = parsePageFile(slug, source);
  return { entry, version: sha, source };
}

export async function updatePage(
  slug: string,
  source: string,
  ifMatch: ContentVersion,
): Promise<PageDetail> {
  assertValidSlug(slug);
  parsePageFile(slug, source);
  const store = await getStore();
  const { sha } = await store.writeFile(pageRelPath(slug), source, { ifMatch });
  const { entry } = parsePageFile(slug, source);
  return { entry, version: sha, source };
}

export async function deletePage(
  slug: string,
  ifMatch: ContentVersion,
): Promise<void> {
  assertValidSlug(slug);
  const store = await getStore();
  await store.deleteFile(pageRelPath(slug), { ifMatch });
}
