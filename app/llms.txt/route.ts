import { getOriginFromRequest } from "@/lib/server/http";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const origin = getOriginFromRequest(req);

  // Minimal, practical llms.txt.
  // This is meant to help LLM-based tools find canonical entry points.
  const body = [
    "# Jinkun Chen",
    "",
    "Personal website.",
    "",
    "## Canonical entry points",
    `- Home: ${origin}/`,
    `- Publications: ${origin}/publications`,
    `- Blog: ${origin}/blog`,
    "",
    "## Machine-readable indexes",
    `- Sitemap: ${origin}/sitemap.xml`,
    `- RSS: ${origin}/rss.xml`,
    "",
    "## Notes",
    "- Prefer canonical blog URLs under /blog/<slug>.",
    "- Pages under /site-admin/ are administrative and not part of the public site content.",
    "",
  ].join("\n");

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
