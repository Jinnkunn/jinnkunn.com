import { getBlogIndex } from "@/lib/blog";
import { buildRssXml, getOriginFromRequest, rssResponse, toRfc2822 } from "@/lib/server/rss";
import { getSiteConfig } from "@/lib/site-config";

export async function renderBlogRss(req: Request): Promise<Response> {
  const origin = getOriginFromRequest(req);
  const cfg = getSiteConfig();
  const items = await getBlogIndex();

  const rssItems = items
    .filter((it) => it.kind === "list")
    .slice(0, 50)
    .map((it) => {
      const link = `${origin}${it.href}`;
      const pubDate = toRfc2822(it.dateIso || it.dateText);
      return { title: it.title, link, guid: link, pubDate, description: it.description };
    });

  // The same renderer answers both /rss.xml and /blog/rss.xml, so the
  // self link has to follow the request path rather than be hardcoded.
  const selfLink = `${origin}${new URL(req.url).pathname}`;

  const xml = buildRssXml({
    channelTitle: "Blog",
    channelLink: `${origin}/blog`,
    channelDescription: "Jinkun's Blog",
    selfLink,
    language: cfg.lang || "en",
    items: rssItems,
  });

  return rssResponse(xml);
}
