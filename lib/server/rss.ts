import "server-only";

import { escapeXml, getOriginFromRequest } from "@/lib/server/http";

export type RssItem = {
  title: string;
  link: string;
  guid?: string;
  pubDate?: string | null; // RFC2822 preferred
  description?: string | null;
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
  /** Absolute URL this document is served from. Emitted as
   * `atom:link rel="self"`, which validators require and which lets
   * aggregators re-resolve a subscription after a move. */
  selfLink?: string | null;
  /** RSS `<language>` (RFC 5646). Feed readers use it for hyphenation
   * and for grouping/translating items. */
  language?: string | null;
  items: RssItem[];
}): string {
  const rssItems = opts.items
    .map((it) => {
      const guid = it.guid || it.link;
      const description = String(it.description ?? "").trim();
      return (
        `    <item>\n` +
        `      <title>${escapeXml(it.title)}</title>\n` +
        `      <link>${escapeXml(it.link)}</link>\n` +
        `      <guid isPermaLink="true">${escapeXml(guid)}</guid>\n` +
        (it.pubDate ? `      <pubDate>${escapeXml(it.pubDate)}</pubDate>\n` : "") +
        (description ? `      <description>${escapeXml(description)}</description>\n` : "") +
        `    </item>`
      );
    })
    .join("\n");

  const language = String(opts.language ?? "").trim();
  const selfLink = String(opts.selfLink ?? "").trim();

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n` +
    `  <channel>\n` +
    `    <title>${escapeXml(opts.channelTitle)}</title>\n` +
    `    <link>${escapeXml(opts.channelLink)}</link>\n` +
    `    <description>${escapeXml(opts.channelDescription)}</description>\n` +
    (language ? `    <language>${escapeXml(language)}</language>\n` : "") +
    (selfLink
      ? `    <atom:link href="${escapeXml(selfLink)}" rel="self" type="application/rss+xml"/>\n`
      : "") +
    `${rssItems}\n` +
    `  </channel>\n` +
    `</rss>\n`
  );
}

/** The one live feed. `/blog/rss.xml` renders the same document, but this
 * is the URL we advertise (llms.txt, autodiscovery, the blog index link). */
export const CANONICAL_FEED_PATH = "/rss.xml";

/** `/blog.rss` and `/blog.atom` were static files written by the retired
 * Super export and went stale in Feb 2026. They still have subscribers,
 * so the paths keep resolving — as a 301 onto the live feed. 301 rather
 * than 308 because feed aggregators treat it as "move the subscription",
 * and these endpoints are GET-only so nothing depends on method rewrite
 * semantics. */
export function legacyFeedRedirect(req: Request): Response {
  const target = new URL(CANONICAL_FEED_PATH, getOriginFromRequest(req)).toString();
  return new Response(null, {
    status: 301,
    headers: {
      location: target,
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
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
