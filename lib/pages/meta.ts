// Pure frontmatter parsing for MDX pages. No IO, no path aliases.

import matter from "gray-matter";

import type { PageEntry, PageFrontmatter } from "./types";

const WORDS_PER_MINUTE = 220;
const DESC_MIN_LEN = 60;
const DESC_MAX_LEN = 200;

function toIsoDate(value: string): string | null {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

function countWordsInMdxBody(body: string): number {
  const text = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/[#>*_~`|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return 0;
  return text.split(/\s+/).length;
}

function extractDescriptionFromBody(body: string, explicit?: string): string | null {
  if (explicit && explicit.trim()) return explicit.trim();
  const lines = body.split(/\n+/);
  for (const line of lines) {
    const raw = line
      .replace(/^\s*[>#*_-]\s*/, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (raw.length < DESC_MIN_LEN) continue;
    if (raw.length <= DESC_MAX_LEN) return raw;
    const slice = raw.slice(0, DESC_MAX_LEN);
    const lastSpace = slice.lastIndexOf(" ");
    const trimmed = (lastSpace > DESC_MIN_LEN ? slice.slice(0, lastSpace) : slice).replace(
      /[,;:\s]+$/,
      "",
    );
    return `${trimmed}…`;
  }
  return null;
}

function validateFrontmatter(data: Record<string, unknown>): PageFrontmatter {
  const title = typeof data.title === "string" ? data.title.trim() : "";
  if (!title) throw new Error("page: frontmatter.title is required");
  let updated: string | undefined;
  const rawUpdated = data.updated;
  if (typeof rawUpdated === "string" && rawUpdated.trim()) {
    const iso = toIsoDate(rawUpdated);
    if (!iso) throw new Error(`page: frontmatter.updated is unparsable (${title}): ${rawUpdated}`);
    updated = iso;
  } else if (rawUpdated instanceof Date) {
    updated = rawUpdated.toISOString().slice(0, 10);
  }
  return {
    title,
    description: typeof data.description === "string" ? data.description : undefined,
    draft: Boolean(data.draft),
    updated,
  };
}

export function parsePageFile(
  slug: string,
  source: string,
): { frontmatter: PageFrontmatter; body: string; entry: PageEntry } {
  const parsed = matter(source);
  const frontmatter = validateFrontmatter(parsed.data as Record<string, unknown>);
  const body = String(parsed.content || "");
  const wordCount = countWordsInMdxBody(body);
  const readingMinutes = wordCount > 0 ? Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE)) : 0;
  const description = extractDescriptionFromBody(body, frontmatter.description);
  const entry: PageEntry = {
    slug,
    href: `/pages/${slug}`,
    title: frontmatter.title,
    description,
    updatedIso: frontmatter.updated ?? null,
    draft: Boolean(frontmatter.draft),
    wordCount,
    readingMinutes,
  };
  return { frontmatter, body, entry };
}
