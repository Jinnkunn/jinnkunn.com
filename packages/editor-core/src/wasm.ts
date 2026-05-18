import init, { editor_core_call, type InitInput } from "../pkg/jinnkunn_editor_core.js";
import type {
  EditorBlock,
  EditorCommandSearchInput,
  EditorBlockSpec,
  EditorBlockType,
  EditorCommand,
  EditorCursorPosition,
  EditorDocument,
  EditorMarkRange,
  EditorSelection,
  EditorSelectionFormattingSnapshot,
  EditorSelectionMarkState,
  EditorTextRange,
  EditorTextMarkAttrs,
  EditorTextMark,
  EditorTextMarkType,
  EditorTextMarkSpec,
  EditorTextSpan,
  EditorTransaction,
} from "./types.ts";

export type EditorBlockInput = Omit<Partial<EditorBlock>, "text"> & {
  text?: string | EditorTextSpan[];
};

export type EditorHistory = {
  document: EditorDocument;
  undoStack: EditorTransaction[];
  redoStack: EditorTransaction[];
};

let initPromise: Promise<void> | null = null;
let ready = false;

export function initializeEditorCore(source?: InitInput | Promise<InitInput>): Promise<void> {
  const module_or_path = source ?? new URL("../pkg/jinnkunn_editor_core_bg.wasm", import.meta.url);
  initPromise ??= init({ module_or_path }).then(() => {
    ready = true;
  });
  return initPromise;
}

export function isEditorCoreReady(): boolean {
  return ready;
}

function assertReady() {
  if (!ready) {
    throw new Error("editor-core WASM is not initialized. Call initializeEditorCore() before using editor-core.");
  }
}

function callEditorCore<T>(method: string, payload: unknown): T {
  assertReady();
  return JSON.parse(editor_core_call(method, JSON.stringify(payload))) as T;
}

function pair<A, B>(first: A, second: B): { 0: A; 1: B } {
  return { 0: first, 1: second };
}

export function createBlock(input: EditorBlockInput = {}): EditorBlock {
  return callEditorCore("createBlock", input);
}

export function createDocument(input: Partial<EditorDocument> = {}): EditorDocument {
  return callEditorCore("createDocument", input);
}

export function getBlockPlainText(block: Pick<EditorBlock, "text">): string {
  return callEditorCore("getBlockPlainText", block);
}

export function createCollapsedSelection(blockId: string, offset = 0): EditorSelection {
  return callEditorCore("createCollapsedSelection", { blockId, offset });
}

export function getSelectionFocus(selection: EditorSelection): EditorCursorPosition {
  return callEditorCore("getSelectionFocus", selection);
}

export function isSelectionCollapsed(selection: EditorSelection): boolean {
  return callEditorCore("isSelectionCollapsed", selection);
}

export function isSameBlockSelection(selection: EditorSelection | null): selection is EditorSelection {
  return Boolean(selection && callEditorCore("isSameBlockSelection", selection));
}

export function isCollapsedSelection(selection: EditorSelection | null): selection is EditorSelection {
  return Boolean(selection && isSelectionCollapsed(selection));
}

export function selectedRange(selection: EditorSelection): EditorTextRange {
  return callEditorCore("selectedRange", selection);
}

export function markRangesInBlock(block: EditorBlock, mark: EditorTextMarkType): EditorMarkRange[] {
  return callEditorCore("markRangesInBlock", { block, mark });
}

export function markRangeAtOffset(block: EditorBlock, offset: number, mark: EditorTextMarkType): EditorTextRange | null {
  return callEditorCore("markRangeAtOffset", { block, offset, mark });
}

export function editableMarkRangeAtSelection(block: EditorBlock, selection: EditorSelection): EditorTextRange | null {
  return callEditorCore("editableMarkRangeAtSelection", { block, selection });
}

export function selectionHasMark(block: EditorBlock, selection: EditorSelection, mark: EditorTextMarkType): boolean {
  return callEditorCore("selectionHasMark", { block, selection, mark });
}

export function selectedMarkAttrs(
  block: EditorBlock,
  selection: EditorSelection,
  mark: EditorTextMarkType,
): EditorTextMarkAttrs | null {
  return callEditorCore("selectedMarkAttrs", { block, selection, mark });
}

export function marksAtOffset(block: EditorBlock, offset: number): EditorTextMark[] {
  return callEditorCore("marksAtOffset", { block, offset });
}

export function selectionMarkState(
  block: EditorBlock,
  selection: EditorSelection,
  mark: EditorTextMarkType,
  storedMarks: EditorTextMark[] | null = null,
): EditorSelectionMarkState {
  return callEditorCore("selectionMarkState", { block, selection, mark, storedMarks });
}

export function selectionFormattingSnapshot(
  block: EditorBlock,
  selection: EditorSelection,
  marks: EditorTextMarkType[],
  storedMarks: EditorTextMark[] | null = null,
): EditorSelectionFormattingSnapshot {
  const items = callEditorCore<Array<{ mark: EditorTextMarkType; state: EditorSelectionMarkState }>>(
    "selectionFormattingSnapshot",
    { block, selection, marks, storedMarks },
  );
  const snapshot: EditorSelectionFormattingSnapshot = {};
  for (const item of items) snapshot[item.mark] = item.state;
  return snapshot;
}

export function clampSelection(document: EditorDocument, selection: EditorSelection): EditorSelection {
  return callEditorCore("clampSelection", pair(document, selection));
}

export function selectionAtBlockStart(blockId: string): EditorSelection {
  return createCollapsedSelection(blockId, 0);
}

export function selectionAtBlockEnd(document: EditorDocument, blockId: string): EditorSelection {
  return callEditorCore("selectionAtBlockEnd", pair(document, blockId));
}

export function createEditorHistory(document: EditorDocument): EditorHistory {
  return callEditorCore("createEditorHistory", document);
}

export function applyTransaction(history: EditorHistory, transaction: EditorTransaction): EditorHistory {
  return callEditorCore("applyTransaction", pair(history, transaction));
}

export function undo(history: EditorHistory): EditorHistory {
  return callEditorCore("undo", history);
}

export function redo(history: EditorHistory): EditorHistory {
  return callEditorCore("redo", history);
}

export function findEditorCommand(query: string): EditorCommand[] {
  return callEditorCore("findEditorCommand", query);
}

export function searchEditorCommandNames(commands: EditorCommandSearchInput[], query: string): string[] {
  return callEditorCore("searchEditorCommandNames", { commands, query });
}

export function listBlockSpecs(): EditorBlockSpec[] {
  return callEditorCore("listBlockSpecs", null);
}

export function listTextMarkSpecs(): EditorTextMarkSpec[] {
  return callEditorCore("listTextMarkSpecs", null);
}

export function applyMarkdownShortcut(block: EditorBlock): EditorBlock {
  return callEditorCore("applyMarkdownShortcut", block);
}

export function documentToMarkdown(document: EditorDocument): string {
  return callEditorCore("documentToMarkdown", document);
}

export function markdownToDocument(markdown: string, title = "Imported document"): EditorDocument {
  return callEditorCore("markdownToDocument", { markdown, title });
}

export function updateBlockText(
  document: EditorDocument,
  blockId: string,
  text: string,
  offset = text.length,
): EditorTransaction {
  return callEditorCore("updateBlockText", { document, blockId, text, offset });
}

export function updateBlockTextWithMarkdownShortcut(
  document: EditorDocument,
  blockId: string,
  text: string,
  offset = text.length,
): EditorTransaction {
  return callEditorCore("updateBlockTextWithMarkdownShortcut", { document, blockId, text, offset });
}

export function toggleTextMark(
  document: EditorDocument,
  blockId: string,
  startOffset: number,
  endOffset: number,
  mark: EditorTextMarkType,
): EditorTransaction {
  return callEditorCore("toggleTextMark", { document, blockId, startOffset, endOffset, mark });
}

export function setTextMark(
  document: EditorDocument,
  blockId: string,
  startOffset: number,
  endOffset: number,
  mark: EditorTextMarkType,
  attrs: EditorTextMarkAttrs = {},
): EditorTransaction {
  return callEditorCore("setTextMark", { document, blockId, startOffset, endOffset, mark, attrs });
}

export function unsetTextMark(
  document: EditorDocument,
  blockId: string,
  startOffset: number,
  endOffset: number,
  mark: EditorTextMarkType,
): EditorTransaction {
  return callEditorCore("unsetTextMark", { document, blockId, startOffset, endOffset, mark });
}

export function insertBlockAfter(
  document: EditorDocument,
  afterBlockId: string | null,
  block: EditorBlock = createBlock(),
): EditorTransaction {
  return callEditorCore("insertBlockAfter", { document, afterBlockId, block });
}

export function insertDocumentFragment(
  document: EditorDocument,
  blockId: string,
  startOffset: number,
  endOffset: number,
  fragment: EditorDocument,
): EditorTransaction {
  return callEditorCore("insertDocumentFragment", { document, blockId, startOffset, endOffset, fragment });
}

export function splitBlock(document: EditorDocument, blockId: string, offset: number): EditorTransaction {
  return callEditorCore("splitBlock", { document, blockId, offset });
}

export function mergeWithPrevious(document: EditorDocument, blockId: string): EditorTransaction {
  return callEditorCore("mergeWithPrevious", pair(document, blockId));
}

export function deleteBlock(document: EditorDocument, blockId: string): EditorTransaction {
  return callEditorCore("deleteBlock", pair(document, blockId));
}

export function moveBlock(document: EditorDocument, blockId: string, toIndex: number): EditorTransaction {
  return callEditorCore("moveBlock", { document, blockId, toIndex });
}

export function setBlockIndent(
  document: EditorDocument,
  blockId: string,
  indent: number,
  offset?: number,
): EditorTransaction {
  return callEditorCore("setBlockIndent", { document, blockId, indent, offset });
}

export function toggleTodo(document: EditorDocument, blockId: string): EditorTransaction {
  return callEditorCore("toggleTodo", pair(document, blockId));
}

export function setBlockType(
  document: EditorDocument,
  blockId: string,
  blockType: EditorBlockType,
  level?: 1 | 2 | 3,
  text?: string,
): EditorTransaction {
  return callEditorCore("setBlockType", { document, blockId, blockType, level, text });
}

export function setBlockAttrs(
  document: EditorDocument,
  blockId: string,
  attrs: Record<string, unknown>,
  offset?: number,
): EditorTransaction {
  return callEditorCore("setBlockAttrs", { document, blockId, attrs, offset });
}
