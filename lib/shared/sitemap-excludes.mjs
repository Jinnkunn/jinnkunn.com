import { compactId, normalizeRoutePath } from "./route-utils.mjs";

function splitStringEntries(raw) {
  return String(raw || "")
    .split(/[\n,]/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Normalize one sitemap exclude token.
 * Supported:
 * - route paths ("/blog", "blog/list")
 * - Notion page ids or page URLs containing a page id
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeSitemapExcludeEntry(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const maybeId = compactId(s);
  if (s.startsWith("/")) {
    const bare = s.replace(/^\/+/, "");
    if (maybeId && /^[0-9a-f-]{32,36}$/i.test(bare)) return maybeId;
    const route = normalizeRoutePath(s);
    if (route) return route;
    return maybeId || "";
  }
  if (maybeId) return maybeId;
  const route = normalizeRoutePath(s);
  if (route) return route;
  const id = compactId(s);
  if (id) return id;
  return "";
}

/**
 * Parse sitemap excludes from admin text or JSON list.
 * Returns deduped normalized entries (route paths and/or compact ids).
 *
 * @param {unknown} input
 * @returns {string[]}
 */
export function parseSitemapExcludeEntries(input) {
  const chunks = Array.isArray(input) ? input : [input];
  const out = [];
  const seen = new Set();

  for (const chunk of chunks) {
    const parts = Array.isArray(chunk) ? chunk : splitStringEntries(chunk);
    for (const part of parts) {
      const normalized = normalizeSitemapExcludeEntry(part);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
  }

  return out;
}
