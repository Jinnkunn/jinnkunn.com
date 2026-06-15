import "server-only";

import { listPages, readPage } from "./store";
import type { PageEntry } from "./types";

function pageFilename(slug: string): string {
  return `content/pages/${slug}.mdx`;
}

export async function getPageSlugs(
  opts?: { includeDrafts?: boolean },
): Promise<string[]> {
  const pages = await listPages(opts);
  return pages.map((page) => page.entry.slug).sort();
}

export async function readPageSource(slug: string): Promise<{
  source: string;
  filename: string;
} | null> {
  try {
    const page = await readPage(slug);
    if (!page) return null;
    return { source: page.source, filename: pageFilename(slug) };
  } catch {
    return null;
  }
}

export async function getPageEntry(slug: string): Promise<PageEntry | null> {
  try {
    return (await readPage(slug))?.entry ?? null;
  } catch {
    return null;
  }
}
