import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

function normalizeRoutePath(routePath: string): string {
  let p = (routePath ?? "").trim();
  // Drop any leading/trailing slashes so `path.join(root, p + ".html")` can't ignore root.
  p = p.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!p) return "index";
  return p;
}

function resolveRawHtmlFileInRoot(root: string, routePath: string): string {
  const rel = normalizeRoutePath(routePath);

  // Normalize and ensure the resolved path stays within `content/raw`.
  const file = path.normalize(path.join(root, `${rel}.html`));
  const rootNorm = path.normalize(root + path.sep);
  if (!file.startsWith(rootNorm)) {
    throw new Error(`Invalid route path: ${routePath}`);
  }
  return file;
}

function resolveRawHtmlFile(routePath: string): string {
  const legacyRoot = path.join(process.cwd(), "content", "raw");
  const generatedRoot = path.join(process.cwd(), "content", "generated", "raw");

  const candidates = [
    resolveRawHtmlFileInRoot(generatedRoot, routePath),
    resolveRawHtmlFileInRoot(legacyRoot, routePath),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  // Default to legacy path so the error message points at the well-known folder.
  return candidates[candidates.length - 1];
}

function rewriteRawHtml(html: string): string {
  // Use local copies for a few key assets so the clone is self-contained.
  const remoteProfilePublic =
    "https://images.spr.so/cdn-cgi/imagedelivery/j42No7y-dcokJuNgXeA0ig/d4473e16-cb09-4f59-8e01-9bed5a936048/web-image/public";
  const remoteProfileOptimized =
    "https://images.spr.so/cdn-cgi/imagedelivery/j42No7y-dcokJuNgXeA0ig/d4473e16-cb09-4f59-8e01-9bed5a936048/web-image/w=1920,quality=90,fit=scale-down";

  const remoteLogo =
    "https://assets.super.so/e331c927-5859-4092-b1ca-16eddc17b1bb/uploads/logo/712f74e3-00ca-453b-9511-39896485699f.png";

  const rewritten = html
    .replaceAll(remoteProfilePublic, "/assets/profile.png")
    .replaceAll(remoteProfileOptimized, "/assets/profile.png")
    .replaceAll(remoteLogo, "/assets/logo.png");

  // Improve LCP: the profile image is above-the-fold on `/` but is marked as lazy in the raw HTML.
  // This doesn't affect visuals, only loading priority.
  const lcpTweaked = rewritten.replace(/<img\b[^>]*>/gi, (tag) => {
    if (!tag.includes("/assets/profile.png")) return tag;
    let out = tag.replace(
      /\sloading=(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
      ""
    );
    out = out.replace(
      /\sfetchpriority=(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
      ""
    );
    if (out.endsWith("/>")) {
      out = out.slice(0, -2) + ' loading="eager" fetchpriority="high" />';
    } else if (out.endsWith(">")) {
      out = out.slice(0, -1) + ' loading="eager" fetchpriority="high">';
    }
    return out;
  });

  // Rewrite hard-coded absolute links back to local routes.
  const breadcrumbFixed = lcpTweaked.replace(
    /<div class="super-navbar__breadcrumbs"\s+style="position:absolute">/gi,
    '<div class="super-navbar__breadcrumbs">',
  );

  // Canonicalize blog URLs:
  // - Notion structure often nests posts under `/blog/list/<slug>` or `/list/<slug>`
  // - Public routes should always be `/blog/<slug>` (matches original site UX)
  const blogCanon = breadcrumbFixed
    .replaceAll('href="/blog/list/', 'href="/blog/')
    .replaceAll('href="/list/', 'href="/blog/')
    // A few Notion exports include absolute URLs without quoting.
    .replaceAll("href=/blog/list/", "href=/blog/")
    .replaceAll("href=/list/", "href=/blog/");

  return blogCanon
    .replaceAll("https://jinkunchen.com", "")
    .replaceAll("http://jinkunchen.com", "");
}

export async function loadRawMainHtml(slug: string): Promise<string> {
  const file = resolveRawHtmlFile(slug);
  const html = await readFile(file, "utf8");

  const m = html.match(/<main\b[\s\S]*?<\/main>/i);
  if (!m) {
    throw new Error(`Could not find <main> in ${file}`);
  }

  return rewriteRawHtml(m[0]);
}
