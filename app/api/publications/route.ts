import publicationsData from "@/content/publications.json";
import { noStoreData, withNoStoreApi } from "@/lib/server/api-response";
import type {
  PublicationEntryDTO,
  SiteAdminPublicationsData,
} from "@/lib/site-admin/api-types";

export const runtime = "nodejs";

export async function GET() {
  return withNoStoreApi(async () => {
    const data = publicationsData as SiteAdminPublicationsData;
    const items: PublicationEntryDTO[] = Array.isArray(data.entries)
      ? data.entries
      : [];
    return noStoreData({
      count: items.length,
      items,
    });
  });
}
