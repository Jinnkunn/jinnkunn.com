import { getBlogIndex } from "@/lib/blog";

export const runtime = "nodejs";

function getOriginFromRequest(req: Request): string {
  const url = new URL(req.url);
  const proto =
    req.headers.get("x-forwarded-proto") ||
    url.protocol.replace(":", "") ||
    "https";
  const host =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    url.host ||
    "localhost";
  return `${proto}://${host}`;
}

function escapeXml(s: string): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function toRfc2822(dateIso: string | null): string | null {
  if (!dateIso) return null;
  const t = Date.parse(dateIso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toUTCString();
}

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
      const guid = link;
      return (
        `    <item>\n` +
        `      <title>${escapeXml(it.title)}</title>\n` +
        `      <link>${escapeXml(link)}</link>\n` +
        `      <guid isPermaLink="true">${escapeXml(guid)}</guid>\n` +
        (pubDate ? `      <pubDate>${escapeXml(pubDate)}</pubDate>\n` : "") +
        `    </item>`
      );
    })
    .join("\n");

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0">\n` +
    `  <channel>\n` +
    `    <title>${escapeXml(channelTitle)}</title>\n` +
    `    <link>${escapeXml(channelLink)}</link>\n` +
    `    <description>${escapeXml(channelDescription)}</description>\n` +
    `${rssItems}\n` +
    `  </channel>\n` +
    `</rss>\n`;

  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}

