import { getOriginFromRequest } from "@/lib/server/http";
import { getSitemapSectionDocs } from "@/lib/server/sitemap-routes";
import { renderSitemapIndexXml, sitemapXmlResponse } from "@/lib/server/sitemap-xml";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const origin = getOriginFromRequest(req);
  const docs = getSitemapSectionDocs();
  const xml = renderSitemapIndexXml(
    origin,
    docs.map((doc) => ({ path: doc.path })),
  );
  return sitemapXmlResponse(xml);
}
