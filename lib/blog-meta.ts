// Pure HTML → metadata extraction for blog posts.
// Kept dependency-free (no path aliases, no IO) so tests can import it via the
// node test runner without bundler or tsconfig-paths support.

export type BlogPostMeta = {
  title: string;
  dateText: string | null;
  dateIso: string | null;
  description: string | null;
  wordCount: number;
  readingMinutes: number;
};

const DESC_MIN_LEN = 60;
const DESC_MAX_LEN = 200;
const WORDS_PER_MINUTE = 220;

function decodeEntities(s: string): string {
  return s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&#x2F;", "/");
}

function toIsoDate(dateText: string): string | null {
  const t = Date.parse(dateText);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function extractDescriptionFromArticle(articleHtml: string): string | null {
  const paraMatches = articleHtml.matchAll(
    /<p\b[^>]*class="[^"]*notion-text[^"]*"[^>]*>([\s\S]*?)<\/p>/gi,
  );
  for (const m of paraMatches) {
    const raw = decodeEntities(m[1] ?? "")
      .replace(/<[^>]+>/g, " ")
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

function countWordsInArticle(articleHtml: string): number {
  if (!articleHtml) return 0;
  const text = decodeEntities(articleHtml)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return 0;
  return text.split(/\s+/).length;
}

export function parseBlogMetaFromMain(mainHtml: string): BlogPostMeta {
  const title =
    decodeEntities(
      mainHtml.match(/class="notion-header__title">([\s\S]*?)<\/h1>/i)?.[1] ?? "",
    )
      .replace(/<[^>]+>/g, "")
      .trim() || "Blog Post";

  const dateText =
    decodeEntities(
      mainHtml.match(/<span class="date">([^<]+)<\/span>/i)?.[1] ?? "",
    )
      .replace(/<[^>]+>/g, "")
      .trim() || null;

  const dateIso = dateText ? toIsoDate(dateText) : null;

  const articleInner = mainHtml.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? "";
  const description = extractDescriptionFromArticle(articleInner);
  const wordCount = countWordsInArticle(articleInner);
  const readingMinutes =
    wordCount > 0 ? Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE)) : 0;

  return { title, dateText, dateIso, description, wordCount, readingMinutes };
}
