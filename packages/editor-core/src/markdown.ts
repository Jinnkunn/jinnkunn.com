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
      text: "",
    });
  }
  if (text === "> ") return createBlock({ id: block.id, type: "quote", text: "" });
  if (text === "- " || text === "* ") {
    return createBlock({ id: block.id, type: "bulleted-list", text: "" });
  }
  if (text === "1. ") return createBlock({ id: block.id, type: "numbered-list", text: "" });
  if (text === "[] " || text === "[ ] ") return createBlock({ id: block.id, type: "todo", text: "" });
  if (text === "---") return createBlock({ id: block.id, type: "divider", text: "" });
  return block;
}

export function documentToMarkdown(document: EditorDocument): string {
  const lines = document.blocks.map((block) => {
    const text = getBlockPlainText(block);
    switch (block.type) {
      case "heading":
        return `${"#".repeat(block.level || 1)} ${text}`;
      case "quote":
        return `> ${text}`;
      case "divider":
        return "---";
      case "todo":
        return `${block.checked ? "[x]" : "[ ]"} ${text}`;
      case "bulleted-list":
        return `- ${text}`;
      case "numbered-list":
        return `1. ${text}`;
      case "paragraph":
      default:
        return text;
    }
  });
  return lines.join("\n");
}

export function markdownToDocument(markdown: string, title = "Imported document"): EditorDocument {
  const blocks = markdown.split(/\r?\n/).map((line) => {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      return createBlock({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2],
      });
    }
    if (/^\s*---\s*$/.test(line)) return createBlock({ type: "divider" });
    const todo = /^\[(x|X| )\]\s+(.*)$/.exec(line);
    if (todo) return createBlock({ type: "todo", checked: todo[1].toLowerCase() === "x", text: todo[2] });
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) return createBlock({ type: "quote", text: quote[1] });
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) return createBlock({ type: "bulleted-list", text: bullet[1] });
    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    if (numbered) return createBlock({ type: "numbered-list", text: numbered[1] });
    return createBlock({ type: "paragraph", text: line });
  });
  return createDocument({ title, blocks });
}
