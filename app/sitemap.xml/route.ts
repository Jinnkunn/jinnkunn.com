import { escapeXml, getOriginFromRequest } from "@/lib/server/http";
import { getHierarchicalSitemapRoutePaths } from "@/lib/server/sitemap-routes";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const origin = getOriginFromRequest(req);
  const routes = getHierarchicalSitemapRoutePaths();

  const urls = routes
    .map((routePath) => {
      const loc = `${origin}${routePath}`;
      return `  <url>\n    <loc>${escapeXml(loc)}</loc>\n  </url>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${urls}\n` +
    `</urlset>\n`;

  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
