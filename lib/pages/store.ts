// High-level pages CRUD over the generic ContentStore.

import {
  ContentStoreConflictError,
  ContentStoreNotFoundError,
  type ContentStore,
  type ContentVersion,
} from "@/lib/server/content-store";
import { getContentStore } from "@/lib/server/content-store-resolver";
import { appendRedirect } from "@/lib/redirects";
import { parsePageFile } from "./meta";
import { assertValidPageSlug } from "./slug";
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
  // Recursive so hierarchical slugs (e.g. "docs/api/auth") show up. Each
  // file's relPath is `pages/<slug>.mdx`; strip the directory prefix and
  // extension to get the slug as the rest of the system sees it.
  const files = await store.listFiles(PAGES_DIR, { recursive: true });
  const out: PageListItem[] = [];
  for (const file of files) {
    if (!file.name.endsWith(".mdx") && !file.name.endsWith(".md")) continue;
    const rel = file.relPath.replace(/^pages\//, "");
    const slug = rel.replace(/\.mdx?$/, "");
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
  assertValidPageSlug(slug);
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
  assertValidPageSlug(slug);
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
  assertValidPageSlug(slug);
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
  assertValidPageSlug(slug);
  const store = await getStore();
  await store.deleteFile(pageRelPath(slug), { ifMatch });
}

/** Move a page to a new slug. Used by the sidebar's drag-reparent flow.
 *
 * Implementation: read the source at the old slug → write it at the new
 * slug (with `ifMatch: null` to require the target be vacant) → delete
 * the old file. Not atomic across the two writes; if the delete fails
 * after the write succeeded, the page exists at both locations until
 * the user retries. This is a deliberate trade-off — keeping the source
 * document available is more valuable than perfect atomicity for an
 * admin-initiated rename. */
export async function movePage(
  fromSlug: string,
  toSlug: string,
  ifMatch: ContentVersion,
): Promise<PageDetail> {
  assertValidPageSlug(fromSlug);
  assertValidPageSlug(toSlug);
  if (fromSlug === toSlug) {
    throw new Error("source and target slug are identical");
  }
  const store = await getStore();
  const existing = await store.readFile(pageRelPath(fromSlug));
  if (!existing) {
    throw new ContentStoreNotFoundError(`page not found: ${fromSlug}`);
  }
  if (existing.sha !== ifMatch) {
    throw new ContentStoreConflictError({
      expected: ifMatch,
      actual: existing.sha,
    });
  }
  // The slug is not stored in the source file's frontmatter (parsePageFile
  // takes the slug as an argument), so we don't need to rewrite the source.
  const targetExisting = await store.readFile(pageRelPath(toSlug));
  if (targetExisting) {
    throw new Error(`page already exists at ${toSlug}`);
  }
  const { sha } = await store.writeFile(pageRelPath(toSlug), existing.content, {
    ifMatch: null,
  });
  await store.deleteFile(pageRelPath(fromSlug), { ifMatch: existing.sha });
  // Persist the rename in the redirects manifest so old URLs keep
  // resolving (next.config.mjs reads this at build time and emits 308s).
  // Failures here don't undo the move — the page already lives at the
  // new slug; we just lose the redirect, which is recoverable later.
  try {
    await appendRedirect("pages", fromSlug, toSlug);
  } catch {
    // ignore — see comment above
  }
  const { entry } = parsePageFile(toSlug, existing.content);
  return { entry, version: sha, source: existing.content };
}
