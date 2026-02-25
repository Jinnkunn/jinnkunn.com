/**
 * Publication-page specific HTML cleanup.
 *
 * This runs on raw synced HTML and only targets `/publications` pages.
 * Goal:
 * - strip empty Notion color wrappers that render as stray chips
 * - normalize label separators (`conference:`, `journal:`) to stable markup
 * - keep one intentional blank line before the first detail label row
 */
export function rewritePublicationsHtml(input: string): string {
  let out = String(input || "");
  if (!out.includes("page__publications")) return out;

  out = out
    // Remove empty highlighted background spans that appear as stray chips.
    .replace(
      /<span class="highlighted-background bg-(?:red|purple|orange|yellow|default)">(?:(?:\s|&nbsp;|<br\s*\/?>)*|<strong>(?:\s|&nbsp;|<br\s*\/?>)*<\/strong>)*<\/span>/gi,
      "\n",
    )
    // Remove empty colored wrappers containing only whitespace/newlines.
    .replace(
      /<span class="highlighted-color color-(?:gray|default|red|purple|orange|yellow)">[\s\r\n]*<\/span>/gi,
      "",
    )
    // After cleanup, Notion may leave empty emphasis tags.
    .replace(/<em>\s*<\/em>/gi, "")
    // Keep inline spacing between adjacent summary labels.
    .replace(
      /<\/em>\s*(?=<em><span class="highlighted-color color-(?:red|purple|orange))/gi,
      "</em> ",
    )
    // Normalize tag separators to a single stable form.
    .replace(
      /(<em>\s*<span class="highlighted-color color-(?:red|purple|orange)">[\s\S]*?<code class="code">[\s\S]*?<\/code>[\s\S]*?<\/span>\s*<\/span>\s*<\/em>)\s*(?:<span class="highlighted-color color-default"><span class="highlighted-background bg-default">:\s*<\/span><\/span>|<strong>\s*:\s*<\/strong>|:\s*)/gi,
      '$1<span class="pub-tag-colon"><strong>: </strong></span>',
    )
    // Keep label + colon together when wrapping.
    .replace(
      /(<em>\s*<span class="highlighted-color color-(?:red|purple|orange)">[\s\S]*?<code class="code">[\s\S]*?<\/code>[\s\S]*?<\/span>\s*<\/span>\s*<\/em>)\s*<span class="pub-tag-colon"><strong>:\s*<\/strong><\/span>/gi,
      '<span class="pub-tag-prefix">$1<span class="pub-tag-colon"><strong>: </strong></span></span>',
    )
    // Keep exactly one blank line between author list and the first detail tag.
    // This avoids per-entry drift caused by different leftover newline artifacts.
    .replace(
      /(<blockquote[^>]*class="notion-quote"[^>]*>\s*<span class="notion-semantic-string">[\s\S]*?)(<em>\s*<span class="highlighted-color color-(?:red|purple|orange)">[\s\S]*?<code class="code">[\s\S]*?<\/code>[\s\S]*?<\/span>\s*<\/span>\s*<\/em>\s*<span class="pub-tag-(?:prefix|colon)">[\s\S]*?<\/span>)/gi,
      (m, pre, firstTagLine) => {
        const normalizedPre = String(pre).replace(/(?:\s|&nbsp;|<br\s*\/?>)*$/gi, "");
        return `${normalizedPre}<br><br>${firstTagLine}`;
      },
    )
    // Preserve each publication metadata label row as its own visual line.
    .replace(
      /(<blockquote[^>]*class="notion-quote"[^>]*>[\s\S]*?<\/blockquote>)/gi,
      (block) => String(block).replace(/\n+\s*(<span class="pub-tag-prefix">)/gi, "<br>$1"),
    )
    // Condense accidental extra blank lines.
    .replace(/(?:<br\s*\/?>\s*){3,}/gi, "<br><br>");

  return out;
}
