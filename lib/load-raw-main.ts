import "server-only";

import { readFile } from "node:fs/promises";
import { resolveRawHtmlFile } from "./server/content-files";
import { canonicalizeBlogHrefsInHtml } from "@/lib/routes/html-rewrite";
import { rewritePublicationsHtml } from "@/lib/publications/rewrite";

function rewriteRawHtml(html: string): string {
  // Use local copies for a few key assets so the clone is self-contained.
  const remoteProfilePublic =
    "https://images.spr.so/cdn-cgi/imagedelivery/j42No7y-dcokJuNgXeA0ig/d4473e16-cb09-4f59-8e01-9bed5a936048/web-image/public";
  const remoteProfileOptimized =
    "https://images.spr.so/cdn-cgi/imagedelivery/j42No7y-dcokJuNgXeA0ig/d4473e16-cb09-4f59-8e01-9bed5a936048/web-image/w=1920,quality=90,fit=scale-down";
  // Newer profile asset host (used by our current content).
  const remoteProfileCdn = "https://cdn.jinkunchen.com/web_image/web-image.png";

  const remoteLogo =
    "https://assets.super.so/e331c927-5859-4092-b1ca-16eddc17b1bb/uploads/logo/712f74e3-00ca-453b-9511-39896485699f.png";

  const rewritten = html
    .replaceAll(remoteProfilePublic, "/assets/profile.png")
    .replaceAll(remoteProfileOptimized, "/assets/profile.png")
    .replaceAll(remoteProfileCdn, "/assets/profile.png")
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
    out = out.replace(/\sonerror=(?:"[^"]*"|'[^']*'|[^\s>]+)/i, "");
    const fallback = "this.onerror=null;this.src='https://cdn.jinkunchen.com/web_image/web-image.png'";
    if (out.endsWith("/>")) {
      out =
        out.slice(0, -2) +
        ` loading="eager" fetchpriority="high" onerror="${fallback}" />`;
    } else if (out.endsWith(">")) {
      out =
        out.slice(0, -1) +
        ` loading="eager" fetchpriority="high" onerror="${fallback}">`;
    }
    return out;
  });

  // Home profile photo should not open the lightbox: strip the wrapper attributes
  // that our client behavior uses to enable zoom.
  const noProfileLightbox = lcpTweaked
    .replace(
      /\sdata-full-size="https:\/\/cdn\.jinkunchen\.com\/web_image\/web-image\.png"/gi,
      "",
    )
    .replace(
      /\sdata-lightbox-src="https:\/\/cdn\.jinkunchen\.com\/web_image\/web-image\.png"/gi,
      "",
    )
    .replace(
      /\sdata-full-size="https:\/\/images\.spr\.so\/cdn-cgi\/imagedelivery\/j42No7y-dcokJuNgXeA0ig\/d4473e16-cb09-4f59-8e01-9bed5a936048\/web-image\/[^"]+"/gi,
      "",
    )
    .replace(
      /\sdata-lightbox-src="https:\/\/images\.spr\.so\/cdn-cgi\/imagedelivery\/j42No7y-dcokJuNgXeA0ig\/d4473e16-cb09-4f59-8e01-9bed5a936048\/web-image\/[^"]+"/gi,
      "",
    );

  // Rewrite hard-coded absolute links back to local routes.
  const breadcrumbFixed = noProfileLightbox.replace(
    /<div class="super-navbar__breadcrumbs"\s+style="position:absolute">/gi,
    '<div class="super-navbar__breadcrumbs">',
  );

  // Canonicalize blog URLs:
  // - Notion structure often nests posts under `/blog/list/<slug>` or `/list/<slug>`
  // - Public routes should always be `/blog/<slug>` (matches original site UX)
  const blogCanon = canonicalizeBlogHrefsInHtml(breadcrumbFixed);

  const out = rewritePublicationsHtml(blogCanon);

  return out
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
