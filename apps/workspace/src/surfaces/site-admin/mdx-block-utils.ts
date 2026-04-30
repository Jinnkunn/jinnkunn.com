import type { MdxBlock } from "./mdx-blocks";

export function isTextEditableBlock(block: MdxBlock): boolean {
  return (
    block.type === "paragraph" ||
    block.type === "heading" ||
    block.type === "quote" ||
    block.type === "list" ||
    block.type === "todo" ||
    block.type === "callout" ||
    block.type === "code" ||
    block.type === "raw" ||
    block.type === "toggle"
  );
}

export function isBlockVisuallyEmpty(block: MdxBlock): boolean {
  if (isTextEditableBlock(block)) return block.text.trim().length === 0;
  if (block.type === "image") return !block.url;
  if (block.type === "bookmark") return !block.url && !block.title;
  if (block.type === "embed") return !block.url;
  if (block.type === "file") return !block.url && !block.filename;
  if (block.type === "page-link") return !block.pageSlug;
  if (block.type === "table") {
    return !block.tableData?.rows.some((row) => row.some((cell) => cell.trim()));
  }
  if (block.type === "columns" || block.type === "column") {
    return !block.children?.some((child) => !isBlockVisuallyEmpty(child));
  }
  return false;
}
