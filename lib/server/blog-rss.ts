import { getBlogIndex } from "@/lib/blog";
import { buildRssXml, getOriginFromRequest, rssResponse, toRfc2822 } from "@/lib/server/rss";

export async function renderBlogRss(req: Request): Promise<Response> {
  const origin = getOriginFromRequest(req);
  const items = await getBlogIndex();

  const rssItems = items
    .filter((it) => it.kind === "list")
    .slice(0, 50)
    .map((it) => {
      const link = `${origin}${it.href}`;
      const pubDate = toRfc2822(it.dateIso || it.dateText);
      return { title: it.title, link, guid: link, pubDate };
    });

  const xml = buildRssXml({
    channelTitle: "Blog",
    channelLink: `${origin}/blog`,
    channelDescription: "Jinkun's Blog",
    items: rssItems,
  });

  return rssResponse(xml);
}
