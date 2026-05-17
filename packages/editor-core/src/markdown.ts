import { createBlock, createDocument, getBlockPlainText } from "./document.ts";
import type { EditorBlock, EditorDocument } from "./types.ts";

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
    const text = getBlockPlainText(block);
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
        text: heading[2],
      });
    }
    if (/^---\s*$/.test(content)) return createBlock({ type: "divider", indent });
    const todo = /^\[(x|X| )\]\s+(.*)$/.exec(content);
    if (todo) return createBlock({ type: "todo", indent, checked: todo[1].toLowerCase() === "x", text: todo[2] });
    const quote = /^>\s?(.*)$/.exec(content);
    if (quote) return createBlock({ type: "quote", indent, text: quote[1] });
    const bullet = /^[-*]\s+(.*)$/.exec(content);
    if (bullet) return createBlock({ type: "bulleted-list", indent, text: bullet[1] });
    const numbered = /^\d+\.\s+(.*)$/.exec(content);
    if (numbered) return createBlock({ type: "numbered-list", indent, text: numbered[1] });
    return createBlock({ type: "paragraph", indent, text: content });
  });
  return createDocument({ title, blocks });
}
