import { canonicalizePublicRoute } from "./strategy.mjs";

/**
 * Canonicalize internal blog hrefs inside raw HTML:
 * - /blog/list/<slug> -> /blog/<slug>
 * - /blog/list -> /blog
 * - /list/<slug> -> /blog/<slug>
 * - /list -> /blog
 *
 * This is a conservative string rewrite (not a DOM parser) designed for the
 * synced Notion/Super-ish HTML that we render as-is.
 *
 * @param {string} html
 * @returns {string}
 */
export function canonicalizeBlogHrefsInHtml(html) {
  const s = String(html || "");
  if (!s.includes("/blog/list") && !s.includes("href=/list") && !s.includes('href="/list')) return s;

  // Matches:
  // href="/blog/list/slug"
  // href='/blog/list/slug'
  // href=/blog/list/slug
  // href="/list/slug"
  // href=/list/slug
  // and also the index forms: href="/blog/list" or href="/list"
  return s.replace(
    /\bhref=(["']?)(\/(?:blog\/list|list)(?:\/[^"' \t\r\n>]+)?)\1/gi,
    (_m, q, href) => {
      const canon = canonicalizePublicRoute(href);
      if (!q) return `href=${canon}`;
      return `href=${q}${canon}${q}`;
    },
  );
}

