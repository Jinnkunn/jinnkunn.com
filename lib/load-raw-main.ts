import { readFile } from "node:fs/promises";
import path from "node:path";

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
  return rewritten.replace(/<img\b[^>]*>/gi, (tag) => {
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
}

export async function loadRawMainHtml(slug: string): Promise<string> {
  const file = path.join(process.cwd(), "content", "raw", `${slug}.html`);
  const html = await readFile(file, "utf8");

  const m = html.match(/<main\b[\s\S]*?<\/main>/i);
  if (!m) {
    throw new Error(`Could not find <main> in ${file}`);
  }

  return rewriteRawHtml(m[0]);
}
