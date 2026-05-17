import { createBlock, getBlockPlainText, normalizeDocument } from "./document.ts";
import { createCollapsedSelection } from "./selection.ts";
import type {
  EditorBlock,
  EditorBlockType,
  EditorDocument,
  EditorSelection,
  EditorTransaction,
  EditorTransactionKind,
} from "./types.ts";

type MutationResult = {
  document: EditorDocument;
  selection?: EditorSelection;
};

function cloneDocument(document: EditorDocument): EditorDocument {
  return structuredClone(document) as EditorDocument;
}

function transaction(
  kind: EditorTransactionKind,
  before: EditorDocument,
  result: MutationResult,
): EditorTransaction {
  return {
    id: `tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    before,
    after: normalizeDocument(result.document),
    selection: result.selection,
    createdAt: new Date().toISOString(),
  };
}

function updateTopLevel(
  document: EditorDocument,
  mutate: (blocks: EditorBlock[], next: EditorDocument) => EditorSelection | undefined,
): MutationResult {
  const next = cloneDocument(document);
  const selection = mutate(next.blocks, next);
  return { document: next, selection };
}

export function updateBlockText(
  document: EditorDocument,
  blockId: string,
  text: string,
  offset = text.length,
): EditorTransaction {
  return transaction(
    "update-text",
    document,
    updateTopLevel(document, (blocks) => {
      const block = blocks.find((item) => item.id === blockId);
      if (!block || block.type === "divider") return undefined;
      block.text = [{ text }];
      return createCollapsedSelection(blockId, offset);
    }),
  );
}

export function insertBlockAfter(
  document: EditorDocument,
  afterBlockId: string | null,
  block: EditorBlock = createBlock(),
): EditorTransaction {
  return transaction(
    "insert-block",
    document,
    updateTopLevel(document, (blocks) => {
      if (!afterBlockId) {
        blocks.unshift(block);
        return createCollapsedSelection(block.id, 0);
      }
      const index = blocks.findIndex((item) => item.id === afterBlockId);
      blocks.splice(index >= 0 ? index + 1 : blocks.length, 0, block);
      return createCollapsedSelection(block.id, 0);
    }),
  );
}

export function splitBlock(
  document: EditorDocument,
  blockId: string,
  offset: number,
): EditorTransaction {
  return transaction(
    "split-block",
    document,
    updateTopLevel(document, (blocks) => {
      const index = blocks.findIndex((item) => item.id === blockId);
      if (index < 0) return undefined;

      const block = blocks[index];
      const text = getBlockPlainText(block);
      const safeOffset = Math.max(0, Math.min(offset, text.length));
      block.text = [{ text: text.slice(0, safeOffset) }];
      const nextBlock = createBlock({
        type: block.type === "heading" ? "paragraph" : block.type,
        text: text.slice(safeOffset),
        checked: block.type === "todo" ? false : undefined,
      });
      blocks.splice(index + 1, 0, nextBlock);
      return createCollapsedSelection(nextBlock.id, 0);
    }),
  );
}

export function mergeWithPrevious(document: EditorDocument, blockId: string): EditorTransaction {
  return transaction(
    "merge-block",
    document,
    updateTopLevel(document, (blocks) => {
      const index = blocks.findIndex((item) => item.id === blockId);
      if (index <= 0) return undefined;
      const previous = blocks[index - 1];
      const current = blocks[index];
      if (previous.type === "divider") return undefined;
      const previousText = getBlockPlainText(previous);
      previous.text = [{ text: `${previousText}${getBlockPlainText(current)}` }];
      blocks.splice(index, 1);
      return createCollapsedSelection(previous.id, previousText.length);
    }),
  );
}

export function deleteBlock(document: EditorDocument, blockId: string): EditorTransaction {
  return transaction(
    "delete-block",
    document,
    updateTopLevel(document, (blocks) => {
      const index = blocks.findIndex((item) => item.id === blockId);
      if (index < 0 || blocks.length === 1) return undefined;
      const [removed] = blocks.splice(index, 1);
      const next = blocks[Math.min(index, blocks.length - 1)] || blocks[index - 1] || removed;
      return createCollapsedSelection(next.id, getBlockPlainText(next).length);
    }),
  );
}

export function moveBlock(document: EditorDocument, blockId: string, toIndex: number): EditorTransaction {
  return transaction(
    "move-block",
    document,
    updateTopLevel(document, (blocks) => {
      const fromIndex = blocks.findIndex((item) => item.id === blockId);
      if (fromIndex < 0) return undefined;
      const [block] = blocks.splice(fromIndex, 1);
      const safeIndex = Math.max(0, Math.min(toIndex, blocks.length));
      blocks.splice(safeIndex, 0, block);
      return createCollapsedSelection(blockId, getBlockPlainText(block).length);
    }),
  );
}

export function setBlockIndent(
  document: EditorDocument,
  blockId: string,
  indent: number,
  offset?: number,
): EditorTransaction {
  return transaction(
    "set-block-indent",
    document,
    updateTopLevel(document, (blocks) => {
      const block = blocks.find((item) => item.id === blockId);
      if (!block) return undefined;
      const nextIndent = Math.max(0, Math.min(6, Math.floor(indent)));
      block.indent = nextIndent > 0 ? nextIndent : undefined;
      return createCollapsedSelection(blockId, offset ?? getBlockPlainText(block).length);
    }),
  );
}

export function toggleTodo(document: EditorDocument, blockId: string): EditorTransaction {
  return transaction(
    "toggle-todo",
    document,
    updateTopLevel(document, (blocks) => {
      const block = blocks.find((item) => item.id === blockId);
      if (!block) return undefined;
      block.type = "todo";
      block.checked = !block.checked;
      return createCollapsedSelection(blockId, getBlockPlainText(block).length);
    }),
  );
}

export function setBlockType(
  document: EditorDocument,
  blockId: string,
  type: EditorBlockType,
  level?: 1 | 2 | 3,
  text?: string,
): EditorTransaction {
  return transaction(
    "set-block-type",
    document,
    updateTopLevel(document, (blocks) => {
      const block = blocks.find((item) => item.id === blockId);
      if (!block) return undefined;
      block.type = type;
      block.level = type === "heading" ? level || 1 : undefined;
      block.checked = type === "todo" ? Boolean(block.checked) : undefined;
      if (text !== undefined) block.text = [{ text }];
      if (type === "divider") block.text = [];
      return createCollapsedSelection(blockId, getBlockPlainText(block).length);
    }),
  );
}
