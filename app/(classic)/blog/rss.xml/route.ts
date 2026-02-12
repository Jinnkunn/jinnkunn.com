import { renderBlogRss } from "@/lib/server/blog-rss";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return renderBlogRss(req);
}
