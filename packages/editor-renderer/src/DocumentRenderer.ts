import { Fragment, createElement, type ReactNode } from "react";
import type { EditorBlock, EditorDocument, EditorTextMark, EditorTextSpan } from "../../editor-core/src/index.ts";

export type EditorDocumentRendererProps = {
  className?: string;
  document: EditorDocument;
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

function plainText(block: Pick<EditorBlock, "text">): string {
  return block.text.map((span) => span.text).join("");
}

function blockAttr(block: EditorBlock, key: string): string {
  const value = block.attrs?.[key];
  return typeof value === "string" ? value : "";
}

function markOfType(marks: EditorTextMark[] | undefined, type: EditorTextMark["type"]): EditorTextMark | null {
  return marks?.find((mark) => mark.type === type) ?? null;
}

function renderInline(span: EditorTextSpan, index: number, linkTarget?: EditorDocumentRendererProps["linkTarget"]): ReactNode {
  let node: ReactNode = span.text;
  for (const markType of MARK_RENDER_ORDER) {
    const mark = markOfType(span.marks, markType);
    if (!mark) continue;
    if (markType === "code") node = createElement("code", { key: `${index}-code` }, node);
    else if (markType === "bold") node = createElement("strong", { key: `${index}-bold` }, node);
    else if (markType === "italic") node = createElement("em", { key: `${index}-italic` }, node);
    else if (markType === "underline") node = createElement("u", { key: `${index}-underline` }, node);
    else if (markType === "strikethrough") node = createElement("s", { key: `${index}-strike` }, node);
    else if (markType === "highlight") node = createElement("mark", { key: `${index}-mark` }, node);
    else if (markType === "link" && mark.attrs?.href) {
      node = createElement("a", { href: mark.attrs.href, key: `${index}-link`, rel: "noreferrer", target: linkTarget }, node);
    } else if (markType === "icon-link") {
      node = createElement(
        "span",
        { "data-link-icon": mark.attrs?.icon, "data-link-style": "icon", key: `${index}-icon-link` },
        node,
      );
    } else if (markType === "text-color" && mark.attrs?.color) {
      node = createElement("span", { "data-color": mark.attrs.color, key: `${index}-text-color` }, node);
    } else if (markType === "background-color" && mark.attrs?.color) {
      node = createElement("span", { "data-bg": mark.attrs.color, key: `${index}-background-color` }, node);
    }
  }
  return node;
}

function renderInlineContent(block: EditorBlock, linkTarget?: EditorDocumentRendererProps["linkTarget"]): ReactNode {
  return createElement(
    Fragment,
    null,
    block.text.map((span, index) => renderInline(span, index, linkTarget)),
  );
}

function renderBlock(block: EditorBlock, linkTarget?: EditorDocumentRendererProps["linkTarget"]): ReactNode {
  const className = `jer-block jer-block--${block.type}`;
  const inline = renderInlineContent(block, linkTarget);
  if (block.type === "heading") {
    return createElement(`h${block.level ?? 1}`, { className, key: block.id }, inline);
  }
  if (block.type === "quote") return createElement("blockquote", { className, key: block.id }, inline);
  if (block.type === "divider") return createElement("hr", { className, key: block.id });
  if (block.type === "todo") {
    return createElement(
      "div",
      { className, "data-checked": block.checked ? "true" : "false", key: block.id },
      createElement("input", { checked: Boolean(block.checked), disabled: true, readOnly: true, type: "checkbox" }),
      " ",
      createElement("span", null, inline),
    );
  }
  if (block.type === "bulleted-list") {
    return createElement("ul", { className, key: block.id }, createElement("li", null, inline));
  }
  if (block.type === "numbered-list") {
    return createElement("ol", { className, key: block.id }, createElement("li", null, inline));
  }
  if (block.type === "code-block" || block.type === "raw") {
    return createElement("pre", { className, key: block.id }, createElement("code", null, plainText(block)));
  }
  if (block.type === "callout") return createElement("aside", { className, key: block.id }, inline);
  if (block.type === "image") {
    const url = blockAttr(block, "url");
    const alt = blockAttr(block, "alt") || plainText(block);
    return createElement(
      "figure",
      { className, key: block.id },
      url ? createElement("img", { alt, src: url }) : null,
      plainText(block) ? createElement("figcaption", null, inline) : null,
    );
  }
  if (block.type === "bookmark" || block.type === "embed" || block.type === "file" || block.type === "page-link") {
    const href = blockAttr(block, block.type === "page-link" ? "href" : "url");
    return createElement("a", { className, href, key: block.id }, inline);
  }
  return createElement("p", { className, key: block.id }, inline);
}

export function EditorDocumentRenderer({ className, document, linkTarget }: EditorDocumentRendererProps) {
  return createElement(
    "article",
    { className: ["jer-document", className].filter(Boolean).join(" ") },
    document.blocks.map((block) => renderBlock(block, linkTarget)),
  );
}
