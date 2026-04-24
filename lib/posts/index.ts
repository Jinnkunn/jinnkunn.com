import "server-only";

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { parsePostFile } from "./meta";
import type { PostEntry } from "./types";

const POSTS_DIR_NAME = "posts";

function postsDir(): string {
  return path.join(process.cwd(), "content", POSTS_DIR_NAME);
}

async function listMdxFiles(): Promise<string[]> {
  try {
    const entries = await readdir(postsDir(), { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && /\.mdx?$/.test(e.name))
      .map((e) => e.name);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }
}

export async function getPostSlugs(
  opts?: { includeDrafts?: boolean },
): Promise<string[]> {
  const files = await listMdxFiles();
  const slugs: string[] = [];
  for (const file of files) {
    const slug = file.replace(/\.mdx?$/, "");
    if (!slug) continue;
    if (!opts?.includeDrafts) {
      const source = await readFile(path.join(postsDir(), file), "utf8");
      const { entry } = parsePostFile(slug, source);
      if (entry.draft) continue;
    }
    slugs.push(slug);
  }
  return slugs.sort();
}

export async function hasPost(slug: string): Promise<boolean> {
  const files = await listMdxFiles();
  return files.some((f) => f.replace(/\.mdx?$/, "") === slug);
}

export async function readPostSource(slug: string): Promise<{
  source: string;
  filename: string;
} | null> {
  const files = await listMdxFiles();
  const match = files.find((f) => f.replace(/\.mdx?$/, "") === slug);
  if (!match) return null;
  const filename = path.join(postsDir(), match);
  const source = await readFile(filename, "utf8");
  return { source, filename };
}

export async function getPostEntry(slug: string): Promise<PostEntry | null> {
  const file = await readPostSource(slug);
  if (!file) return null;
  const { entry } = parsePostFile(slug, file.source);
  return entry;
}

export async function getPostEntries(
  opts?: { includeDrafts?: boolean },
): Promise<PostEntry[]> {
  const files = await listMdxFiles();
  const out: PostEntry[] = [];
  for (const file of files) {
    const slug = file.replace(/\.mdx?$/, "");
    if (!slug) continue;
    const source = await readFile(path.join(postsDir(), file), "utf8");
    try {
      const { entry } = parsePostFile(slug, source);
      if (!opts?.includeDrafts && entry.draft) continue;
      out.push(entry);
    } catch (err) {
      // Skip unparsable posts but do not poison the index.
      console.warn(`[posts] skipping ${slug}: ${String(err)}`);
    }
  }
  return out.sort((a, b) => (a.dateIso < b.dateIso ? 1 : a.dateIso > b.dateIso ? -1 : 0));
}
