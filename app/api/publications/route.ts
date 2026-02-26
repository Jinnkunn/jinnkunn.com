import { loadRawMainHtml } from "@/lib/load-raw-main";
import { extractPublicationStructuredEntries } from "@/lib/seo/publications-items";
import { noStoreData, withNoStoreApi } from "@/lib/server/api-response";

export const runtime = "nodejs";

export async function GET() {
  return withNoStoreApi(async () => {
    const html = await loadRawMainHtml("publications");
    const items = extractPublicationStructuredEntries(html);
    return noStoreData({
      count: items.length,
      items,
    });
  });
}
