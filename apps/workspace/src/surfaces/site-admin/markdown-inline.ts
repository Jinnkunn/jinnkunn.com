// Inline markdown <-> TipTap conversion. Block-level structure (lists,
// headings, quotes) lives in the MdxBlock model; this module handles ONLY
// the inline marks inside a single block's `text` field — bold, italic,
// code, strike, links, icon-link presentation — plus hard-line-breaks (`\n`).
//
// Two functions:
//
// - inlineMarkdownToHtml: feed into TipTap as `content` so the contenteditable
//   shows formatted text (e.g. **foo** rendered as bold) instead of raw
//   markdown characters.
//
// - tiptapDocToMarkdown: walk a ProseMirror JSON doc back to markdown so we
//   can store the result on `block.text` and round-trip through the existing
//   serializer / file-on-disk format.
//
// The parser is intentionally narrow: it handles the cases users actually
// type (no escaped characters, no nested marks of the same type, no
// reference-style links). The Source mode is the escape hatch for power users.

import type { JSONContent } from "@tiptap/core";

const PLACEHOLDER_PREFIX = "%%MDXINLINE";
const PLACEHOLDER_SUFFIX = "%%";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(input: string): string {
  return input.replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function applyInlineMarks(input: string): string {
  let text = input;
  // Bold before italic so `**foo**` doesn't get half-eaten by the italic
  // regex. Strike before italic for the same reason (the `*` in `~~*x*~~`
  // should still be italic).
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_\n]+?)__/g, "<strong>$1</strong>");
  text = text.replace(/~~([^~\n]+?)~~/g, "<s>$1</s>");
  // Italic — single `*` / `_`, but not adjacent to word chars (so we don't
  // turn `foo_bar_baz` snake_case into italics). Markdown links are extracted
  // before this runs, so underscores inside hrefs/labels are protected.
  text = text.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>");
  text = text.replace(/(^|[^\w_])_([^_\n]+?)_(?!_)/g, "$1<em>$2</em>");
  return text;
}

// Whitelist of HTML tags we round-trip verbatim through the parser.
// Underline (no markdown syntax), inline color spans, and icon-link spans
// (custom marks) all land here. Each tag is extracted to a placeholder before
// escape so its `<`, `>`, `"` chars don't get HTML-escaped, and restored
// verbatim after the markdown-char pass so the inner content gets
// bold/italic/etc. treatment normally.
const PASSTHROUGH_TAG_RE = /<\/?(?:u|span)(?:\s+[^>]*)?>/gi;

/** Convert an inline-only markdown string into a single `<p>...</p>`
 * worth of HTML suitable for TipTap's `setContent`. Hardbreaks (`\n`)
 * become `<br>` tags so multi-line blocks (quote / callout / list items)
 * round-trip through one editor instance. */
export function inlineMarkdownToHtml(input: string): string {
  if (!input) return "<p></p>";

  // Step 1 — extract inline code spans into placeholders so their inner
  // markdown chars don't get re-interpreted as bold/italic.
  const codeSpans: string[] = [];
  let text = input.replace(/`([^`\n]+)`/g, (_match, inner: string) => {
    const idx = codeSpans.length;
    codeSpans.push(inner);
    return `${PLACEHOLDER_PREFIX}${idx}${PLACEHOLDER_SUFFIX}`;
  });

  // Step 2 — extract passthrough HTML tags (`<u>`, `</u>`, `<span ...>`,
  // `</span>`) BEFORE the escape pass so their `<` / `>` / `"` chars
  // stay untouched. The inner content between the tags is left in the
  // stream, so a `<span>**bold**</span>` still gets the `**` treatment
  // in step 4.
  const tagSlots: string[] = [];
  text = text.replace(PASSTHROUGH_TAG_RE, (match) => {
    const idx = tagSlots.length;
    tagSlots.push(match);
    return `${PLACEHOLDER_PREFIX}T${idx}${PLACEHOLDER_SUFFIX}`;
  });

  // Step 3 — extract markdown links before emphasis. Otherwise underscores in
  // hrefs such as `https://twitter.com/_jinnkunn` can be misread as italic
  // delimiters and corrupt the stored link.
  const linkSlots: { label: string; href: string }[] = [];
  text = text.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (_m, label: string, href: string) => {
    const idx = linkSlots.length;
    linkSlots.push({ label, href });
    return `${PLACEHOLDER_PREFIX}L${idx}${PLACEHOLDER_SUFFIX}`;
  });

  // Step 4 — HTML-escape what remains so user-typed `<` / `>` / `&` show
  // as text rather than parsing as tags inside contenteditable.
  text = escapeHtml(text);

  // Step 5 — apply inline marks to non-link text.
  text = applyInlineMarks(text);

  // Step 6 — restore links. Labels get the same inline mark pass, but hrefs
  // are never inspected for markdown characters.
  text = text.replace(
    new RegExp(`${PLACEHOLDER_PREFIX}L(\\d+)${PLACEHOLDER_SUFFIX}`, "g"),
    (_m, idx: string) => {
      const link = linkSlots[Number(idx)];
      if (!link) return "";
      const label = applyInlineMarks(escapeHtml(link.label));
      return `<a href="${escapeAttr(link.href)}">${label}</a>`;
    },
  );

  // Step 7 — restore passthrough HTML tags verbatim (they survived the
  // escape pass via placeholders).
  text = text.replace(
    new RegExp(`${PLACEHOLDER_PREFIX}T(\\d+)${PLACEHOLDER_SUFFIX}`, "g"),
    (_m, idx: string) => tagSlots[Number(idx)],
  );

  // Step 8 — restore code placeholders. Inner content is freshly escaped
  // since it was preserved as the raw user input.
  text = text.replace(
    new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, "g"),
    (_m, idx: string) => `<code>${escapeHtml(codeSpans[Number(idx)])}</code>`,
  );

  // Step 9 — convert real newlines to <br> so multi-line text round-trips.
  // The whole thing is wrapped in a single <p> so TipTap parses one paragraph
  // node containing inline content.
  text = text.replace(/\n/g, "<br>");

  return `<p>${text}</p>`;
}

/** Walk a TipTap doc and emit inline markdown matching the input the
 * inlineMarkdownToHtml parser would re-accept. Only the FIRST top-level
 * paragraph is used — TipTap auto-creates a single paragraph for our
 * inline-only schema, so there's never more than one. Hardbreaks become
 * `\n`; mark order is normalized to (link → bold/italic/strike → code)
 * which matches what the parser produces. */
export function tiptapDocToMarkdown(doc: JSONContent): string {
  const out: string[] = [];
  for (const block of doc.content ?? []) {
    if (block.type === "paragraph") {
      out.push(serializeInline(block.content ?? []));
    }
  }
  return out.join("\n");
}

function serializeInline(nodes: JSONContent[]): string {
  let buffer = "";
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.type === "text" && hasMark(node, "bold")) {
      const run: JSONContent[] = [];
      const originalRun: JSONContent[] = [];
      while (index < nodes.length) {
        const candidate = nodes[index];
        if (candidate.type !== "text" || !hasMark(candidate, "bold")) break;
        originalRun.push(candidate);
        run.push(withoutMark(candidate, "bold"));
        index += 1;
      }
      index -= 1;
      const shouldGroup = originalRun.length > 1 || originalRun.some((item) => hasMark(item, "link"));
      buffer += shouldGroup
        ? wrapMarkdownBoundary(serializeInlineUngrouped(run), "**")
        : serializeInlineUngrouped(originalRun);
      continue;
    }
    buffer += serializeInlineUngrouped([node]);
  }
  return buffer;
}

function hasMark(node: JSONContent, type: string): boolean {
  return (node.marks ?? []).some((mark) => mark.type === type);
}

function withoutMark(node: JSONContent, type: string): JSONContent {
  return {
    ...node,
    marks: (node.marks ?? []).filter((mark) => mark.type !== type),
  };
}

function splitEdgeWhitespace(text: string): {
  leading: string;
  body: string;
  trailing: string;
} {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  if (!match) return { leading: "", body: text, trailing: "" };
  return { leading: match[1], body: match[2], trailing: match[3] };
}

function wrapMarkdownBoundary(text: string, marker: string): string {
  const { leading, body, trailing } = splitEdgeWhitespace(text);
  if (!body) return text;
  return `${leading}${marker}${body}${marker}${trailing}`;
}

function serializeInlineUngrouped(nodes: JSONContent[]): string {
  let buffer = "";
  for (const node of nodes) {
    if (node.type === "hardBreak") {
      buffer += "\n";
      continue;
    }
    if (node.type !== "text") continue;
    const marks = node.marks ?? [];
    const has = (name: string) => marks.some((m) => m.type === name);
    const rawText = node.text ?? "";
    if (!rawText) continue;
    const { leading, body, trailing } = has("code")
      ? { leading: "", body: rawText, trailing: "" }
      : splitEdgeWhitespace(rawText);
    if (!body) {
      buffer += rawText;
      continue;
    }
    let text = body;
    // Apply marks in a stable order. Code is innermost (so `**`/`*` won't
    // appear inside a `code` mark and confuse the parser). Link wraps the
    // markdown-char marks as `[**bold**](url)`, then presentation-only span
    // marks can wrap the whole link without turning the href into raw HTML.
    if (has("code")) text = `\`${text}\``;
    if (has("bold")) text = `**${text}**`;
    if (has("italic")) text = `*${text}*`;
    if (has("strike")) text = `~~${text}~~`;
    // Underline has no markdown syntax — round-trip via raw HTML tags so
    // MDX renders it the same on the public site. Placed outside the
    // markdown-char marks to avoid interleaving `<u>` between, e.g., the
    // outer `**` of a bold mark.
    if (has("underline")) text = `<u>${text}</u>`;
    // Inline color span — Notion-style `data-color` (foreground) +
    // `data-bg` (highlight tint). Either attribute is independent; only
    // the ones present get serialized. Outside the `<u>` since the user
    // expects the color to apply to the underlined text below it.
    const colorMark = marks.find((m) => m.type === "inlineColor");
    if (colorMark && colorMark.attrs) {
      const c = typeof colorMark.attrs.color === "string" ? colorMark.attrs.color : "";
      const b = typeof colorMark.attrs.bg === "string" ? colorMark.attrs.bg : "";
      const attrs: string[] = [];
      if (c) attrs.push(`data-color="${c}"`);
      if (b) attrs.push(`data-bg="${b}"`);
      if (attrs.length > 0) {
        text = `<span ${attrs.join(" ")}>${text}</span>`;
      }
    }
    const link = marks.find((m) => m.type === "link");
    if (link && link.attrs && typeof link.attrs.href === "string") {
      text = `[${text}](${link.attrs.href})`;
    }
    const linkStyle = marks.find((m) => m.type === "inlineLinkStyle");
    if (linkStyle && linkStyle.attrs && linkStyle.attrs.style === "icon") {
      const icon =
        typeof linkStyle.attrs.icon === "string" ? linkStyle.attrs.icon.trim() : "";
      const iconAttr = icon ? ` data-link-icon="${escapeAttr(icon)}"` : "";
      text = `<span data-link-style="icon"${iconAttr}>${text}</span>`;
    }
    buffer += `${leading}${text}${trailing}`;
  }
  return buffer;
}
