import { noStoreData, withNoStoreApi } from "@/lib/server/api-response";
import { loadPublishedSource } from "@/lib/server/active-publication";
import { parsePublicationsEntries } from "@/lib/components/parse";

export const runtime = "nodejs";

export async function GET() {
  return withNoStoreApi(async () => {
    const { source } = await loadPublishedSource("components/publications.mdx");
    const items = parsePublicationsEntries(source || "");
    return noStoreData({ count: items.length, items });
  });
}
