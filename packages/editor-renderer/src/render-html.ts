import type { EditorBlock, EditorDocument, EditorTextMark, EditorTextSpan } from "../../editor-core/src/index.ts";

export type EditorHtmlRendererOptions = {
  className?: string;
  linkTarget?: "_blank" | "_self" | "_parent" | "_top";
};

const MARK_RENDER_ORDER: EditorTextMark["type"][] = [
  "code",
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "highlight",
  "link",
  "icon-link",
  "text-color",
  "background-color",
];

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function attr(name: string, value: string | undefined | null): string {
  if (!value) return "";
  return ` ${name}="${escapeHtml(value)}"`;
}

function plainText(block: Pick<EditorBlock, "text">): string {
  return block.text.map((span) => span.text).join("");
}

function markOfType(marks: EditorTextMark[] | undefined, type: EditorTextMark["type"]): EditorTextMark | null {
  return marks?.find((mark) => mark.type === type) ?? null;
}

function renderSpan(span: EditorTextSpan, options: EditorHtmlRendererOptions): string {
  let html = escapeHtml(span.text);
  for (const markType of MARK_RENDER_ORDER) {
    const mark = markOfType(span.marks, markType);
    if (!mark) continue;
    if (markType === "code") html = `<code>${html}</code>`;
    else if (markType === "bold") html = `<strong>${html}</strong>`;
    else if (markType === "italic") html = `<em>${html}</em>`;
    else if (markType === "underline") html = `<u>${html}</u>`;
    else if (markType === "strikethrough") html = `<s>${html}</s>`;
    else if (markType === "highlight") html = `<mark>${html}</mark>`;
    else if (markType === "link" && mark.attrs?.href) {
      html = `<a href="${escapeHtml(mark.attrs.href)}"${attr("target", options.linkTarget)} rel="noreferrer">${html}</a>`;
    } else if (markType === "icon-link") {
      html = `<span data-link-style="icon"${attr("data-link-icon", mark.attrs?.icon)}>${html}</span>`;
    } else if (markType === "text-color" && mark.attrs?.color) {
      html = `<span data-color="${escapeHtml(mark.attrs.color)}">${html}</span>`;
    } else if (markType === "background-color" && mark.attrs?.color) {
      html = `<span data-bg="${escapeHtml(mark.attrs.color)}">${html}</span>`;
    }
  }
  return html;
}

function renderInline(block: Pick<EditorBlock, "text">, options: EditorHtmlRendererOptions): string {
  return block.text.map((span) => renderSpan(span, options)).join("");
}

function blockAttr(block: EditorBlock, key: string): string {
  const value = block.attrs?.[key];
  return typeof value === "string" ? value : "";
}

function renderBlock(block: EditorBlock, options: EditorHtmlRendererOptions): string {
  const className = `jer-block jer-block--${block.type}`;
  const inline = renderInline(block, options);

  if (block.type === "heading") {
    const level = block.level ?? 1;
    return `<h${level} class="${className}">${inline}</h${level}>`;
  }
  if (block.type === "quote") return `<blockquote class="${className}">${inline}</blockquote>`;
  if (block.type === "divider") return `<hr class="${className}" />`;
  if (block.type === "todo") {
    return `<div class="${className}" data-checked="${block.checked ? "true" : "false"}"><input type="checkbox" disabled${block.checked ? " checked" : ""} /> <span>${inline}</span></div>`;
  }
  if (block.type === "bulleted-list") return `<ul class="${className}"><li>${inline}</li></ul>`;
  if (block.type === "numbered-list") return `<ol class="${className}"><li>${inline}</li></ol>`;
  if (block.type === "code-block") return `<pre class="${className}"><code>${escapeHtml(plainText(block))}</code></pre>`;
  if (block.type === "callout") return `<aside class="${className}">${inline}</aside>`;
  if (block.type === "image") {
    const url = blockAttr(block, "url");
    const alt = blockAttr(block, "alt") || plainText(block);
    const caption = inline ? `<figcaption>${inline}</figcaption>` : "";
    return `<figure class="${className}">${url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" />` : ""}${caption}</figure>`;
  }
  if (block.type === "bookmark" || block.type === "embed" || block.type === "file" || block.type === "page-link") {
    const href = blockAttr(block, block.type === "page-link" ? "href" : "url");
    const label = inline || escapeHtml(href || block.type);
    return `<a class="${className}" href="${escapeHtml(href)}">${label}</a>`;
  }
  if (block.type === "raw") return `<pre class="${className}"><code>${escapeHtml(plainText(block))}</code></pre>`;
  return `<p class="${className}">${inline}</p>`;
}

export function renderDocumentToHtml(document: EditorDocument, options: EditorHtmlRendererOptions = {}): string {
  const className = ["jer-document", options.className].filter(Boolean).join(" ");
  return `<article class="${escapeHtml(className)}">${document.blocks.map((block) => renderBlock(block, options)).join("")}</article>`;
}
