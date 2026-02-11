import "server-only";

import { readFile } from "node:fs/promises";
import { resolveRawHtmlFile } from "./server/content-files";
import { canonicalizeBlogHrefsInHtml } from "@/lib/routes/html-rewrite.mjs";

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
    if (out.endsWith("/>")) {
      out = out.slice(0, -2) + ' loading="eager" fetchpriority="high" />';
    } else if (out.endsWith(">")) {
      out = out.slice(0, -1) + ' loading="eager" fetchpriority="high">';
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

  let out = blogCanon;

  // Publications hygiene:
  // Notion sometimes emits empty "highlighted" spans (only whitespace/newlines),
  // which render as stray colored pills or extra blank lines in the expanded details.
  if (out.includes("page__publications")) {
    out = out
      // Remove empty highlighted background spans (often created by Notion around newlines),
      // which otherwise render as stray colored "chips" (e.g. a blank pink block before `conference`).
      .replace(
        /<span class="highlighted-background bg-(?:red|purple|orange|yellow|default)">(?:(?:\s|&nbsp;|<br\s*\/?>)*|<strong>(?:\s|&nbsp;|<br\s*\/?>)*<\/strong>)*<\/span>/gi,
        "",
      )
      // Remove empty colored chips, e.g. <span class="highlighted-background bg-red"><strong>\n</strong></span>
      .replace(
        /<span class="highlighted-background bg-(?:red|purple|orange|yellow|default)">\s*<strong>[\s\r\n]*<\/strong>\s*<\/span>/gi,
        "",
      )
      // Remove empty color spans that only carry whitespace/newlines (causes blank lines under pre-wrap).
      .replace(
        /<span class="highlighted-color color-(?:gray|default|red|purple|orange|yellow)">[\s\r\n]*<\/span>/gi,
        "",
      )
      // After stripping empty spans, Notion can leave behind empty <em></em> wrappers.
      .replace(/<em>\s*<\/em>/gi, "")
      // Ensure a consistent visual gap between author line and venue/link line.
      // This is rendered via `white-space: pre-wrap` in Super/Notion markup.
      //
      // Case A: newline sits after the closing span.
      // Only apply when the newline is *not* already inside the span content.
      // Otherwise we risk producing two blank lines (3 consecutive newlines).
      .replace(
        /(?<![\r\n])<\/span>\r?\n((?:\s*<em>\s*<\/em>\s*)*<em><span class="highlighted-color)/g,
        "</span>\n\n$1",
      )
      // Case B: newline sits *inside* the span just before </span>.
      // Prefer inserting the extra blank line *between* elements to match other entries.
      // Note: there's already one `\n` *before* `</span>` in this case. Inserting `\n\n`
      // after `</span>` would yield 3 consecutive newlines (2 blank lines). We only need
      // one extra newline here to create a single blank line.
      .replace(
        /\n<\/span>((?:[ \t]*<em>[ \t]*<\/em>[ \t]*)*[ \t]*<em><span class="highlighted-color)/g,
        "\n</span>\n$1",
      );

      // Publications: keep label + ":" together so it doesn't wrap to the next line.
      // Notion exports the colon as `<strong>: </strong>` *after* the <em> wrapper.
      // We pull it into the same <em> so wrapping can't split `conference` and `:`.
      out = out.replace(
        /<em>([\s\S]*?<code class="code">[\s\S]*?)<\/em><strong>:\s*<\/strong>/gi,
        `<em>$1<span class="pub-tag-colon">: </span></em>`,
      );

    // Some exports keep the colon outside of <strong>, but with a literal newline
    // between the label and the colon. Since Notion uses `white-space: pre-wrap`,
    // that newline becomes a hard line break. Collapse it back to a space.
    out = out.replace(
      /<\/em>\s*\r?\n\s*(?=(?:<span[^>]*>\s*:|:\s))/gi,
      "</em> ",
    );

    // If a <br><br> lands immediately after `tag:`, it incorrectly pushes the
    // venue text to the next line. Keep it inline.
    out = out.replace(
      /(<span class="pub-tag-colon">:\s*<\/span><\/em>)\s*(?:<br\s*\/?>\s*){1,2}(?=<span)/gi,
      "$1 ",
    );

    // Publications: enforce the original layout inside expanded details:
    // Authors line
    // (blank line)
    // tag: venue/link line
    //
    // Our CSS keeps `white-space: normal`, so we use real <br> tags.
    //
    // Important: only do this when the export already contains a *real* separator
    // (whitespace/newline or <br>) between the two <em> blocks.
    // Otherwise we can accidentally split inline segments within the same line
    // (e.g. an empty highlight span followed by the real "conference" span).
    out = out.replace(
      /<\/em>(?:\s*<br\s*\/?>\s*|\s+)+<em><span class="highlighted-color/gi,
      "</em><br><br><em><span class=\"highlighted-color",
    );

    // Some exports place the tag line immediately after a closing span + newline.
    // Convert that newline gap into <br><br> so the layout matches the original site.
    out = out.replace(
      /<\/span>\r?\n{1,2}((?:\s*<em>\s*<\/em>\s*)*<em><span class="highlighted-color)/g,
      "</span><br><br>$1",
    );

    // Final clamp: ensure the "authors line" and the following "tag/venue line" have
    // exactly one blank line between them (2 consecutive newlines), not 0 and not 2+.
    out = out.replace(
      /<\/span>\r?\n{3,}((?:\s*<em>\s*<\/em>\s*)*<em><span class="highlighted-color)/g,
      "</span>\n\n$1",
    );

    // Publications: the toggle *summary* line can contain multiple labels
    // (conference / journal / arXiv.org). The layout normalization above injects
    // `<br><br>` between adjacent `<em>` blocks, which is correct for expanded
    // details, but wrong for summary labels (it stacks pills).
    // Collapse those breaks back to inline spacing within summaries only.
    out = out.replace(
      /(<div class="notion-toggle__summary">[\s\S]*?<span class="notion-semantic-string">)([\s\S]*?)(<\/span><\/div><div class="notion-toggle__content">)/gi,
      (_m, pre, inner, post) => {
        const fixed = String(inner)
          // Notion sometimes inserts empty <strong> wrappers that only contain a newline.
          // They render as hard line breaks under `pre-wrap`, causing labels to "stack".
          .replace(/<strong>[\s\r\n]*<\/strong>/gi, " ")
          .replace(/<\/em>(?:\s*<br\s*\/?>\s*){1,2}<em>/gi, "</em> <em>")
          .replace(/<br\s*\/?>/gi, " ")
          // Notion exports sometimes include literal newlines between adjacent <em> labels.
          // We only want a single inline space between labels in the *summary* line.
          .replace(/<\/em>\s+<em>/g, "</em> <em>");
        return `${pre}${fixed}${post}`;
      },
    );
  }

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
