import { canonicalizePublicRoute } from "./strategy.ts";

export function canonicalizeBlogHrefsInHtml(html: string): string {
  const s = String(html || "");
  if (!s.includes("/blog/list") && !s.includes("href=/list") && !s.includes('href="/list')) return s;

  return s.replace(
    /\bhref=(["']?)(\/(?:blog\/list|list)(?:\/[^"' \t\r\n>]+)?)\1/gi,
    (_m, q, href) => {
      const canon = canonicalizePublicRoute(href);
      if (!q) return `href=${canon}`;
      return `href=${q}${canon}${q}`;
    },
  );
}
