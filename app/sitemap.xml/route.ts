import fs from "node:fs";
import path from "node:path";

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

function normalizeRoutePath(routePath: string): string {
  let p = (routePath ?? "").trim();
  if (!p) return "/";
  if (!p.startsWith("/")) p = `/${p}`;
  if (p !== "/") p = p.replace(/\/+$/, "");
  return p;
}

function listHtmlFilesRec(rootDir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [rootDir];

  while (stack.length) {
    const dir = stack.pop()!;
    let ents: fs.Dirent[] = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of ents) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (ent.isFile() && ent.name.endsWith(".html")) out.push(abs);
    }
  }

  // Deterministic output so the sitemap is stable across environments.
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function collectRoutesFromRawRoots(): string[] {
  const roots = [
    path.join(process.cwd(), "content", "generated", "raw"),
    path.join(process.cwd(), "content", "raw"),
  ];

  const out = new Set<string>();
  for (const root of roots) {
    try {
      const files = listHtmlFilesRec(root);
      for (const abs of files) {
        const rel = path.relative(root, abs).replace(/\\/g, "/");
        if (!rel.endsWith(".html")) continue;
        const noExt = rel.slice(0, -".html".length);
        const route = noExt === "index" ? "/" : `/${noExt}`;
        out.add(normalizeRoutePath(route));
      }
    } catch {
      continue;
    }
  }

  // Canonicalize: blog posts live at /blog/<slug>, but source files may be under
  // /blog/list/<slug> or /list/<slug> depending on Notion structure.
  const canon = new Set<string>();
  for (const r of out) {
    if (r === "/blog/list") continue;
    if (r === "/list") continue;
    if (r.startsWith("/blog/list/")) {
      canon.add(normalizeRoutePath(`/blog/${r.replace(/^\/blog\/list\//, "")}`));
      continue;
    }
    if (r.startsWith("/list/")) {
      canon.add(normalizeRoutePath(`/blog/${r.replace(/^\/list\//, "")}`));
      continue;
    }
    canon.add(r);
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
