function decodeEntities(s: string): string {
  return String(s ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&#x2F;", "/");
}

function stripTags(s: string): string {
  return String(s ?? "").replace(/<[^>]+>/g, "");
}

export function extractTitleFromMain(mainHtml: string, fallback = "Page"): string {
  const m = String(mainHtml || "").match(
    /<h1\b[^>]*class="notion-header__title"[^>]*>([\s\S]*?)<\/h1>/i,
  );
  const raw = m?.[1] ? decodeEntities(stripTags(m[1])).trim() : "";
  return raw || fallback;
}

export function extractDescriptionFromMain(mainHtml: string, maxLen = 180): string | null {
  const m = String(mainHtml || "").match(
    /<p\b[^>]*class="notion-text[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
  );
  const raw = m?.[1] ? decodeEntities(stripTags(m[1])).replace(/\s+/g, " ").trim() : "";
  if (!raw) return null;
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, Math.max(0, maxLen - 3)).trimEnd()}...`;
}
