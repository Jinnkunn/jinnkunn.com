import { getBlogIndex } from "@/lib/blog";
import { buildRssXml, getOriginFromRequest, rssResponse, toRfc2822 } from "@/lib/server/rss";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const origin = getOriginFromRequest(req);
  const items = await getBlogIndex();

  const channelTitle = "Blog";
  const channelLink = `${origin}/blog`;
  const channelDescription = "Jinkun's Blog";

  const rssItems = items
    .filter((it) => it.kind === "list")
    .slice(0, 50)
    .map((it) => {
      const link = `${origin}${it.href}`;
      const pubDate = toRfc2822(it.dateIso || it.dateText);
      return { title: it.title, link, guid: link, pubDate };
    })
    ;

  const xml = buildRssXml({
    channelTitle,
    channelLink,
    channelDescription,
    items: rssItems,
  });

  return rssResponse(xml);
}
