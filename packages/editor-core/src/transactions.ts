import { createBlock, getBlockPlainText, normalizeDocument } from "./document.ts";
import { createCollapsedSelection } from "./selection.ts";
import type {
  EditorBlock,
  EditorBlockType,
  EditorDocument,
  EditorSelection,
  EditorTextMark,
  EditorTextSpan,
  EditorTransaction,
  EditorTransactionKind,
} from "./types.ts";

const TEXT_MARK_ORDER: EditorTextMark[] = ["bold", "italic", "code", "underline"];

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

function normalizeMarks(marks: EditorTextMark[] | undefined): EditorTextMark[] | undefined {
  const next = TEXT_MARK_ORDER.filter((mark) => marks?.includes(mark));
  return next.length > 0 ? next : undefined;
}

function marksEqual(left: EditorTextMark[] | undefined, right: EditorTextMark[] | undefined): boolean {
  const normalizedLeft = normalizeMarks(left) || [];
  const normalizedRight = normalizeMarks(right) || [];
  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((mark, index) => mark === normalizedRight[index]);
}

function textSpan(text: string, marks: EditorTextMark[] | undefined): EditorTextSpan {
  const normalizedMarks = normalizeMarks(marks);
  return normalizedMarks ? { text, marks: normalizedMarks } : { text };
}

function mergeTextSpans(spans: EditorTextSpan[]): EditorTextSpan[] {
  const merged: EditorTextSpan[] = [];
  for (const span of spans) {
    if (span.text.length === 0) continue;
    const next = textSpan(span.text, span.marks);
    const previous = merged.at(-1);
    if (previous && marksEqual(previous.marks, next.marks)) {
      previous.text += next.text;
    } else {
      merged.push(next);
    }
  }
  return merged.length > 0 ? merged : [{ text: "" }];
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

export function toggleTextMark(
  document: EditorDocument,
  blockId: string,
  startOffset: number,
  endOffset: number,
  mark: EditorTextMark,
): EditorTransaction {
  return transaction(
    "toggle-text-mark",
    document,
    updateTopLevel(document, (blocks) => {
      const block = blocks.find((item) => item.id === blockId);
      if (!block || block.type === "divider") return undefined;

      const textLength = getBlockPlainText(block).length;
      const start = Math.max(0, Math.min(Math.min(startOffset, endOffset), textLength));
      const end = Math.max(0, Math.min(Math.max(startOffset, endOffset), textLength));
      if (start === end) return createCollapsedSelection(blockId, start);

      let cursor = 0;
      let everySelectedSpanHasMark = true;
      for (const span of block.text) {
        const spanStart = cursor;
        const spanEnd = cursor + span.text.length;
        cursor = spanEnd;
        if (spanEnd <= start || spanStart >= end) continue;
        if (!span.marks?.includes(mark)) everySelectedSpanHasMark = false;
      }

      cursor = 0;
      const nextSpans: EditorTextSpan[] = [];
      for (const span of block.text) {
        const spanStart = cursor;
        const spanEnd = cursor + span.text.length;
        cursor = spanEnd;

        if (spanEnd <= start || spanStart >= end) {
          nextSpans.push(span);
          continue;
        }

        const selectionStart = Math.max(start, spanStart) - spanStart;
        const selectionEnd = Math.min(end, spanEnd) - spanStart;
        const before = span.text.slice(0, selectionStart);
        const selected = span.text.slice(selectionStart, selectionEnd);
        const after = span.text.slice(selectionEnd);
        const selectedMarks = new Set(span.marks || []);
        if (everySelectedSpanHasMark) selectedMarks.delete(mark);
        else selectedMarks.add(mark);

        if (before) nextSpans.push(textSpan(before, span.marks));
        if (selected) nextSpans.push(textSpan(selected, [...selectedMarks]));
        if (after) nextSpans.push(textSpan(after, span.marks));
      }

      block.text = mergeTextSpans(nextSpans);
      return {
        anchor: { blockId, offset: startOffset },
        focus: { blockId, offset: endOffset },
      };
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
