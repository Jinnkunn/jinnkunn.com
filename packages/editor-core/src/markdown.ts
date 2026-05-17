import { createBlock, createDocument, getBlockPlainText } from "./document.ts";
import type { EditorBlock, EditorDocument, EditorTextMark, EditorTextSpan } from "./types.ts";

function applyInlineMarkdown(text: string, marks: EditorTextMark[] | undefined): string {
  let next = text;
  if (marks?.includes("code")) next = `\`${next}\``;
  if (marks?.includes("bold") && marks.includes("italic")) next = `***${next}***`;
  else if (marks?.includes("bold")) next = `**${next}**`;
  else if (marks?.includes("italic")) next = `*${next}*`;
  if (marks?.includes("underline")) next = `<u>${next}</u>`;
  return next;
}

function textSpansToMarkdown(spans: EditorTextSpan[]): string {
  return spans.map((span) => applyInlineMarkdown(span.text, span.marks)).join("");
}

function appendSpan(spans: EditorTextSpan[], text: string, marks?: EditorTextMark[]) {
  if (!text) return;
  const previous = spans.at(-1);
  const sortedMarks = marks?.length ? [...marks].sort() : undefined;
  if (previous && JSON.stringify(previous.marks || []) === JSON.stringify(sortedMarks || [])) {
    previous.text += text;
    return;
  }
  spans.push(sortedMarks ? { text, marks: sortedMarks } : { text });
}

function markdownInlineToTextSpans(input: string): EditorTextSpan[] {
  const spans: EditorTextSpan[] = [];
  let index = 0;

  while (index < input.length) {
    const rest = input.slice(index);
    const strongItalicEnd = rest.startsWith("***") ? input.indexOf("***", index + 3) : -1;
    if (strongItalicEnd > index) {
      appendSpan(spans, input.slice(index + 3, strongItalicEnd), ["bold", "italic"]);
      index = strongItalicEnd + 3;
      continue;
    }

    const strongEnd = rest.startsWith("**") ? input.indexOf("**", index + 2) : -1;
    if (strongEnd > index) {
      appendSpan(spans, input.slice(index + 2, strongEnd), ["bold"]);
      index = strongEnd + 2;
      continue;
    }

    const italicEnd = rest.startsWith("*") ? input.indexOf("*", index + 1) : -1;
    if (italicEnd > index) {
      appendSpan(spans, input.slice(index + 1, italicEnd), ["italic"]);
      index = italicEnd + 1;
      continue;
    }

    const codeEnd = rest.startsWith("`") ? input.indexOf("`", index + 1) : -1;
    if (codeEnd > index) {
      appendSpan(spans, input.slice(index + 1, codeEnd), ["code"]);
      index = codeEnd + 1;
      continue;
    }

    const nextMarker = input.slice(index + 1).search(/[*`]/);
    const end = nextMarker >= 0 ? index + 1 + nextMarker : input.length;
    appendSpan(spans, input.slice(index, end));
    index = end;
  }

  return spans.length > 0 ? spans : [{ text: "" }];
}

export function applyMarkdownShortcut(block: EditorBlock): EditorBlock {
  const text = getBlockPlainText(block);
  const heading = /^(#{1,3})\s$/.exec(text);
  if (heading) {
    return createBlock({
      id: block.id,
      type: "heading",
      level: heading[1].length as 1 | 2 | 3,
      indent: block.indent,
      text: "",
    });
  }
  if (text === "> ") return createBlock({ id: block.id, type: "quote", indent: block.indent, text: "" });
  if (text === "- " || text === "* ") {
    return createBlock({ id: block.id, type: "bulleted-list", indent: block.indent, text: "" });
  }
  if (text === "1. ") return createBlock({ id: block.id, type: "numbered-list", indent: block.indent, text: "" });
  if (text === "[] " || text === "[ ] ") return createBlock({ id: block.id, type: "todo", indent: block.indent, text: "" });
  if (text === "---") return createBlock({ id: block.id, type: "divider", indent: block.indent, text: "" });
  return block;
}

export function documentToMarkdown(document: EditorDocument): string {
  const lines = document.blocks.map((block) => {
    const text = textSpansToMarkdown(block.text);
    const prefix = "  ".repeat(block.indent || 0);
    switch (block.type) {
      case "heading":
        return `${prefix}${"#".repeat(block.level || 1)} ${text}`;
      case "quote":
        return `${prefix}> ${text}`;
      case "divider":
        return `${prefix}---`;
      case "todo":
        return `${prefix}${block.checked ? "[x]" : "[ ]"} ${text}`;
      case "bulleted-list":
        return `${prefix}- ${text}`;
      case "numbered-list":
        return `${prefix}1. ${text}`;
      case "paragraph":
      default:
        return `${prefix}${text}`;
    }
  });
  return lines.join("\n");
}

export function markdownToDocument(markdown: string, title = "Imported document"): EditorDocument {
  const blocks = markdown.split(/\r?\n/).map((line) => {
    const leadingSpaces = /^ */.exec(line)?.[0].length || 0;
    const indent = Math.floor(leadingSpaces / 2);
    const content = line.trimStart();
    const heading = /^(#{1,3})\s+(.*)$/.exec(content);
    if (heading) {
      return createBlock({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        indent,
        text: markdownInlineToTextSpans(heading[2]),
      });
    }
    if (/^---\s*$/.test(content)) return createBlock({ type: "divider", indent });
    const todo = /^\[(x|X| )\]\s+(.*)$/.exec(content);
    if (todo) {
      return createBlock({
        type: "todo",
        indent,
        checked: todo[1].toLowerCase() === "x",
        text: markdownInlineToTextSpans(todo[2]),
      });
    }
    const quote = /^>\s?(.*)$/.exec(content);
    if (quote) return createBlock({ type: "quote", indent, text: markdownInlineToTextSpans(quote[1]) });
    const bullet = /^[-*]\s+(.*)$/.exec(content);
    if (bullet) return createBlock({ type: "bulleted-list", indent, text: markdownInlineToTextSpans(bullet[1]) });
    const numbered = /^\d+\.\s+(.*)$/.exec(content);
    if (numbered) return createBlock({ type: "numbered-list", indent, text: markdownInlineToTextSpans(numbered[1]) });
    return createBlock({ type: "paragraph", indent, text: markdownInlineToTextSpans(content) });
  });
  return createDocument({ title, blocks });
}
