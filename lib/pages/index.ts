import "server-only";

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { parsePageFile } from "./meta";
import type { PageEntry } from "./types";

const PAGES_DIR_NAME = "pages";

function pagesDir(): string {
  return path.join(process.cwd(), "content", PAGES_DIR_NAME);
}

async function listMdxFiles(): Promise<string[]> {
  try {
    const entries = await readdir(pagesDir(), { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && /\.mdx?$/.test(e.name))
      .map((e) => e.name);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }
}

export async function getPageSlugs(
  opts?: { includeDrafts?: boolean },
): Promise<string[]> {
  const files = await listMdxFiles();
  const slugs: string[] = [];
  for (const file of files) {
    const slug = file.replace(/\.mdx?$/, "");
    if (!slug) continue;
    if (!opts?.includeDrafts) {
      const source = await readFile(path.join(pagesDir(), file), "utf8");
      const { entry } = parsePageFile(slug, source);
      if (entry.draft) continue;
    }
    slugs.push(slug);
  }
  return slugs.sort();
}

export async function readPageSource(slug: string): Promise<{
  source: string;
  filename: string;
} | null> {
  const files = await listMdxFiles();
  const match = files.find((f) => f.replace(/\.mdx?$/, "") === slug);
  if (!match) return null;
  const filename = path.join(pagesDir(), match);
  const source = await readFile(filename, "utf8");
  return { source, filename };
}

export async function getPageEntry(slug: string): Promise<PageEntry | null> {
  const file = await readPageSource(slug);
  if (!file) return null;
  const { entry } = parsePageFile(slug, file.source);
  return entry;
}
