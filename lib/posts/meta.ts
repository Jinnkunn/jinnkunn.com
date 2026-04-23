// Pure frontmatter parsing for MDX posts. No IO, no path aliases, so it can
// be unit-tested directly via `node --test`.

import matter from "gray-matter";

import type { PostEntry, PostFrontmatter } from "./types";

const WORDS_PER_MINUTE = 220;
const DESC_MIN_LEN = 60;
const DESC_MAX_LEN = 200;

function toIsoDate(value: string): string | null {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDisplayDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function countWordsInMdxBody(body: string): number {
  const text = body
    // Drop fenced code blocks entirely; they distort reading speed.
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    // Drop inline code.
    .replace(/`[^`]*`/g, " ")
    // Drop JSX-ish tags.
    .replace(/<[^>]+>/g, " ")
    // Drop markdown link syntax but keep the visible label.
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    // Strip markdown markers.
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

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) out.push(item.trim());
  }
  return out;
}

function validateFrontmatter(data: Record<string, unknown>): PostFrontmatter {
  const title = typeof data.title === "string" ? data.title.trim() : "";
  if (!title) throw new Error("post: frontmatter.title is required");
  const dateRaw = data.date;
  const dateStr =
    typeof dateRaw === "string"
      ? dateRaw
      : dateRaw instanceof Date
        ? dateRaw.toISOString()
        : "";
  if (!dateStr) throw new Error(`post: frontmatter.date is required (${title})`);
  const iso = toIsoDate(dateStr);
  if (!iso) throw new Error(`post: frontmatter.date is unparsable (${title}): ${dateStr}`);
  return {
    title,
    date: iso,
    description: typeof data.description === "string" ? data.description : undefined,
    draft: Boolean(data.draft),
    tags: coerceStringArray(data.tags),
    cover: typeof data.cover === "string" ? data.cover : undefined,
    ogImage: typeof data.ogImage === "string" ? data.ogImage : undefined,
  };
}

export function parsePostFile(
  slug: string,
  source: string,
): { frontmatter: PostFrontmatter; body: string; entry: PostEntry } {
  const parsed = matter(source);
  const frontmatter = validateFrontmatter(parsed.data as Record<string, unknown>);
  const body = String(parsed.content || "");
  const wordCount = countWordsInMdxBody(body);
  const readingMinutes = wordCount > 0 ? Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE)) : 0;
  const description = extractDescriptionFromBody(body, frontmatter.description);
  const entry: PostEntry = {
    slug,
    href: `/blog/${slug}`,
    title: frontmatter.title,
    dateIso: frontmatter.date,
    dateText: formatDisplayDate(frontmatter.date),
    description,
    draft: Boolean(frontmatter.draft),
    tags: frontmatter.tags ?? [],
    wordCount,
    readingMinutes,
  };
  return { frontmatter, body, entry };
}
