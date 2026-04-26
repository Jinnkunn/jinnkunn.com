import "server-only";

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { parsePageFile } from "./meta";
import type { PageEntry } from "./types";

const PAGES_DIR_NAME = "pages";

function pagesDir(): string {
  return path.join(process.cwd(), "content", PAGES_DIR_NAME);
}

// Returns paths relative to the pages directory (e.g. "bio.mdx" or
// "docs/intro.mdx"). Recursive so hierarchical page slugs are picked up.
async function listMdxFiles(): Promise<string[]> {
  const root = pagesDir();
  const out: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      throw err;
    }
    for (const name of names) {
      const fullPath = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      let entryStat;
      try {
        entryStat = await stat(fullPath);
      } catch {
        continue;
      }
      if (entryStat.isDirectory()) {
        await walk(fullPath, rel);
      } else if (entryStat.isFile() && /\.mdx?$/.test(name)) {
        out.push(rel);
      }
    }
  }
  await walk(root, "");
  return out;
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
  // Slug may include "/" — the on-disk path mirrors it directly. Try the
  // .mdx then .md variants; readdir ordering wouldn't tell us anyway.
  for (const ext of [".mdx", ".md"]) {
    const filename = path.join(pagesDir(), `${slug}${ext}`);
    try {
      const fileStat = await stat(filename);
      if (!fileStat.isFile()) continue;
      const source = await readFile(filename, "utf8");
      return { source, filename };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      throw err;
    }
  }
  return null;
}

export async function getPageEntry(slug: string): Promise<PageEntry | null> {
  const file = await readPageSource(slug);
  if (!file) return null;
  const { entry } = parsePageFile(slug, file.source);
  return entry;
}
