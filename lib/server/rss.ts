import "server-only";

import { escapeXml, getOriginFromRequest } from "@/lib/server/http";

export type RssItem = {
  title: string;
  link: string;
  guid?: string;
  pubDate?: string | null; // RFC2822 preferred
};

export { getOriginFromRequest, escapeXml };

export function toRfc2822(dateIso: string | null): string | null {
  if (!dateIso) return null;
  const t = Date.parse(dateIso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toUTCString();
}

export function buildRssXml(opts: {
  channelTitle: string;
  channelLink: string;
  channelDescription: string;
  items: RssItem[];
}): string {
  const rssItems = opts.items
    .map((it) => {
      const guid = it.guid || it.link;
      return (
        `    <item>\n` +
        `      <title>${escapeXml(it.title)}</title>\n` +
        `      <link>${escapeXml(it.link)}</link>\n` +
        `      <guid isPermaLink="true">${escapeXml(guid)}</guid>\n` +
        (it.pubDate ? `      <pubDate>${escapeXml(it.pubDate)}</pubDate>\n` : "") +
        `    </item>`
      );
    })
    .join("\n");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0">\n` +
    `  <channel>\n` +
    `    <title>${escapeXml(opts.channelTitle)}</title>\n` +
    `    <link>${escapeXml(opts.channelLink)}</link>\n` +
    `    <description>${escapeXml(opts.channelDescription)}</description>\n` +
    `${rssItems}\n` +
    `  </channel>\n` +
    `</rss>\n`
  );
}

export function rssResponse(xml: string): Response {
  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
