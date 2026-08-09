import { legacyFeedRedirect } from "@/lib/server/rss";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return legacyFeedRedirect(req);
}
