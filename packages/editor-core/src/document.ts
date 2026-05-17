import { createEditorId } from "./ids.ts";
import type { EditorBlock, EditorBlockType, EditorDocument, EditorTextSpan } from "./types.ts";

function cloneText(text: EditorTextSpan[] | undefined): EditorTextSpan[] {
  const source = Array.isArray(text) ? text : [];
  return source.map((span) => ({
    text: String(span.text || ""),
    marks: Array.isArray(span.marks) ? [...span.marks] : undefined,
  }));
}

export function getBlockPlainText(block: Pick<EditorBlock, "text">): string {
  return block.text.map((span) => span.text).join("");
}

export function createBlock(input: {
  id?: string;
  type?: EditorBlockType;
  text?: string | EditorTextSpan[];
  level?: 1 | 2 | 3;
  checked?: boolean;
  children?: EditorBlock[];
} = {}): EditorBlock {
  const type = input.type || "paragraph";
  const text = typeof input.text === "string" ? [{ text: input.text }] : cloneText(input.text);
  return {
    id: input.id || createEditorId(),
    type,
    text,
    level: type === "heading" ? input.level || 1 : undefined,
    checked: type === "todo" ? Boolean(input.checked) : undefined,
    children: input.children?.map((child) => normalizeBlock(child)),
  };
}

export function createDocument(input: Partial<EditorDocument> = {}): EditorDocument {
  return normalizeDocument({
    version: 1,
    title: typeof input.title === "string" ? input.title : "Untitled",
    blocks: Array.isArray(input.blocks) && input.blocks.length > 0 ? input.blocks : [createBlock()],
  });
}

export function normalizeBlock(block: EditorBlock): EditorBlock {
  const normalized = createBlock({
    id: block.id || createEditorId(),
    type: block.type || "paragraph",
    text: block.text,
    level: block.level,
    checked: block.checked,
    children: block.children,
  });

  if (normalized.type !== "heading") normalized.level = undefined;
  if (normalized.type !== "todo") normalized.checked = undefined;
  if (normalized.type === "divider") normalized.text = [];
  return normalized;
}

export function normalizeDocument(document: EditorDocument): EditorDocument {
  const blocks = document.blocks.map((block) => normalizeBlock(block));
  return {
    version: 1,
    title: String(document.title || "Untitled"),
    blocks: blocks.length > 0 ? blocks : [createBlock()],
  };
}

export function flattenBlocks(blocks: EditorBlock[]): EditorBlock[] {
  return blocks.flatMap((block) => [block, ...flattenBlocks(block.children || [])]);
}

export function findBlock(document: EditorDocument, id: string): EditorBlock | null {
  return flattenBlocks(document.blocks).find((block) => block.id === id) || null;
}
