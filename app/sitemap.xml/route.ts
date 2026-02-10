import { escapeXml, getOriginFromRequest } from "@/lib/server/http";
import { canonicalizePublicRoute } from "@/lib/routes/strategy.mjs";
import { listRawHtmlRelPaths } from "@/lib/server/content-files";

export const runtime = "nodejs";

function normalizeRoutePath(routePath: string): string {
  // Keep it local to sitemap generation: avoid importing helpers that might
  // change semantics for filesystem-derived routes (e.g. "index").
  let p = (routePath ?? "").trim();
  if (!p) return "/";
  if (!p.startsWith("/")) p = `/${p}`;
  if (p !== "/") p = p.replace(/\/+$/, "");
  return p;
}

function collectRoutesFromRawRoots(): string[] {
  const rels = listRawHtmlRelPaths();
  const out = new Set<string>();
  for (const rel of rels) {
    const route = rel === "index" ? "/" : `/${rel}`;
    out.add(normalizeRoutePath(route));
  }

  // Canonicalize: blog posts live at /blog/<slug>, but source files may be under
  // /blog/list/<slug> or /list/<slug>.
  const canon = new Set<string>();
  for (const r of out) {
    const c = canonicalizePublicRoute(r);
    if (c === "/blog/list" || c === "/list") continue;
    canon.add(normalizeRoutePath(c));
  }

  // Include canonical /blog even if source content lives under /blog/list.
  canon.add("/blog");

  // Keep sitemap clean: exclude internal-only endpoints.
  const excluded = ["/auth"];

  return Array.from(canon)
    .filter((r) => !excluded.includes(r))
    .sort((a, b) => a.localeCompare(b));
}

export async function GET(req: Request) {
  const origin = getOriginFromRequest(req);
  const routes = collectRoutesFromRawRoots();

  const urls = routes
    .map((routePath) => {
      const loc = `${origin}${routePath}`;
      return `  <url>\n    <loc>${escapeXml(loc)}</loc>\n  </url>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${urls}\n` +
    `</urlset>\n`;

  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
