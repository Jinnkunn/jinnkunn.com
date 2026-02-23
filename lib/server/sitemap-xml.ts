import "server-only";

import { escapeXml } from "@/lib/server/http";

type UrlsetEntry = {
  routePath: string;
  lastmod?: string | null;
};

type IndexEntry = {
  path: string;
  lastmod?: string | null;
};

function toLastmodTag(lastmod: string | null | undefined): string {
  if (!lastmod) return "";
  return `\n    <lastmod>${escapeXml(lastmod)}</lastmod>`;
}

export function renderSitemapUrlsetXml(origin: string, entries: UrlsetEntry[]): string {
  const urls = entries
    .map((entry) => {
      const loc = `${origin}${entry.routePath}`;
      return `  <url>\n    <loc>${escapeXml(loc)}</loc>${toLastmodTag(entry.lastmod)}\n  </url>`;
    })
    .join("\n");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${urls}\n` +
    `</urlset>\n`
  );
}

export function renderSitemapIndexXml(origin: string, entries: IndexEntry[]): string {
  const maps = entries
    .map((entry) => {
      const loc = `${origin}${entry.path}`;
      return `  <sitemap>\n    <loc>${escapeXml(loc)}</loc>${toLastmodTag(entry.lastmod)}\n  </sitemap>`;
    })
    .join("\n");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${maps}\n` +
    `</sitemapindex>\n`
  );
}

export function sitemapXmlResponse(xml: string): Response {
  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
