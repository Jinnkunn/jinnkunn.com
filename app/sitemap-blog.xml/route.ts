import { getOriginFromRequest } from "@/lib/server/http";
import { getSitemapSectionUrls } from "@/lib/server/sitemap-routes";
import { renderSitemapUrlsetXml, sitemapXmlResponse } from "@/lib/server/sitemap-xml";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const origin = getOriginFromRequest(req);
  const urls = getSitemapSectionUrls("blog");
  const xml = renderSitemapUrlsetXml(origin, urls);
  return sitemapXmlResponse(xml);
}
