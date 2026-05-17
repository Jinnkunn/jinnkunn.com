import { findBlock, getBlockPlainText } from "./document.ts";
import type { EditorCursorPosition, EditorDocument, EditorSelection } from "./types.ts";

export function createCursor(blockId: string, offset = 0): EditorCursorPosition {
  return { blockId, offset: Math.max(0, offset) };
}

export function createCollapsedSelection(blockId: string, offset = 0): EditorSelection {
  const cursor = createCursor(blockId, offset);
  return { anchor: cursor, focus: cursor };
}

export function getSelectionFocus(selection: EditorSelection): EditorCursorPosition {
  return selection.focus;
}

export function isSelectionCollapsed(selection: EditorSelection): boolean {
  return selection.anchor.blockId === selection.focus.blockId && selection.anchor.offset === selection.focus.offset;
}

export function clampCursor(document: EditorDocument, cursor: EditorCursorPosition): EditorCursorPosition {
  const block = findBlock(document, cursor.blockId) || document.blocks[0];
  if (!block) return cursor;
  const maxOffset = getBlockPlainText(block).length;
  return {
    blockId: block.id,
    offset: Math.max(0, Math.min(cursor.offset, maxOffset)),
  };
}

export function clampSelection(document: EditorDocument, selection: EditorSelection): EditorSelection {
  return {
    anchor: clampCursor(document, selection.anchor),
    focus: clampCursor(document, selection.focus),
  };
}

export function selectionAtBlockStart(blockId: string): EditorSelection {
  return createCollapsedSelection(blockId, 0);
}

export function selectionAtBlockEnd(document: EditorDocument, blockId: string): EditorSelection {
  const block = findBlock(document, blockId);
  return createCollapsedSelection(blockId, block ? getBlockPlainText(block).length : 0);
}

export function getBlockIndexForCursor(document: EditorDocument, cursor: EditorCursorPosition): number {
  return document.blocks.findIndex((block) => block.id === cursor.blockId);
}

export function getPreviousTextCursor(
  document: EditorDocument,
  cursor: EditorCursorPosition,
): EditorCursorPosition | null {
  const index = getBlockIndexForCursor(document, cursor);
  if (index <= 0) return null;
  const previous = document.blocks[index - 1];
  return createCursor(previous.id, getBlockPlainText(previous).length);
}

export function getNextTextCursor(
  document: EditorDocument,
  cursor: EditorCursorPosition,
): EditorCursorPosition | null {
  const index = getBlockIndexForCursor(document, cursor);
  if (index < 0 || index >= document.blocks.length - 1) return null;
  return createCursor(document.blocks[index + 1].id, 0);
}

