import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMarkdownShortcut,
  applyTransaction,
  clampSelection,
  createBlock,
  createCollapsedSelection,
  createDocument,
  createEditorHistory,
  documentToMarkdown,
  insertBlockAfter,
  markdownToDocument,
  mergeWithPrevious,
  moveBlock,
  redo,
  setBlockType,
  splitBlock,
  toggleTodo,
  undo,
  updateBlockText,
  getSelectionFocus,
  isSelectionCollapsed,
  selectionAtBlockEnd,
} from "../../packages/editor-core/src/index.ts";
import { createMemoryEditorBridge } from "../../packages/editor-bridge/src/index.ts";

test("editor-core: creates a normalized document with at least one block", () => {
  const document = createDocument({ title: "Demo", blocks: [] });
  assert.equal(document.version, 1);
  assert.equal(document.title, "Demo");
  assert.equal(document.blocks.length, 1);
  assert.equal(document.blocks[0].type, "paragraph");
});

test("editor-core: text, split, merge, move, and undo/redo transactions", () => {
  const document = createDocument({
    blocks: [createBlock({ id: "a", text: "Hello world" })],
  });
  let history = createEditorHistory(document);

  history = applyTransaction(history, updateBlockText(history.document, "a", "Hello editor"));
  assert.equal(history.document.blocks[0].text[0].text, "Hello editor");
  assert.deepEqual(getSelectionFocus(history.undoStack.at(-1).selection), { blockId: "a", offset: 12 });

  history = applyTransaction(history, splitBlock(history.document, "a", 6));
  assert.equal(history.document.blocks.length, 2);
  assert.equal(history.document.blocks[0].text[0].text, "Hello ");
  assert.equal(history.document.blocks[1].text[0].text, "editor");

  const secondId = history.document.blocks[1].id;
  history = applyTransaction(history, mergeWithPrevious(history.document, secondId));
  assert.equal(history.document.blocks.length, 1);
  assert.equal(history.document.blocks[0].text[0].text, "Hello editor");

  history = applyTransaction(history, insertBlockAfter(history.document, "a", createBlock({ id: "b", text: "Second" })));
  history = applyTransaction(history, moveBlock(history.document, "b", 0));
  assert.equal(history.document.blocks[0].id, "b");

  history = undo(history);
  assert.equal(history.document.blocks[1].id, "b");
  history = redo(history);
  assert.equal(history.document.blocks[0].id, "b");
});

test("editor-core: selection helpers clamp cursor state to document bounds", () => {
  const document = createDocument({
    blocks: [createBlock({ id: "a", text: "Hello" }), createBlock({ id: "b", text: "World" })],
  });
  const selection = createCollapsedSelection("a", 100);
  const clamped = clampSelection(document, selection);
  assert.equal(isSelectionCollapsed(clamped), true);
  assert.deepEqual(getSelectionFocus(clamped), { blockId: "a", offset: 5 });
  assert.deepEqual(getSelectionFocus(selectionAtBlockEnd(document, "b")), { blockId: "b", offset: 5 });
});

test("editor-core: block type commands and markdown conversion", () => {
  let document = createDocument({
    title: "Markdown",
    blocks: [createBlock({ id: "a", text: "Ship it" })],
  });
  document = setBlockType(document, "a", "todo").after;
  document = toggleTodo(document, "a").after;
  assert.equal(document.blocks[0].checked, true);
  assert.match(documentToMarkdown(document), /\[x\] Ship it/);

  const imported = markdownToDocument("# Title\n> Quote\n---\n- Item", "Imported");
  assert.deepEqual(
    imported.blocks.map((block) => block.type),
    ["heading", "quote", "divider", "bulleted-list"],
  );
});

test("editor-core: markdown shortcuts produce block type changes", () => {
  assert.equal(applyMarkdownShortcut(createBlock({ text: "# " })).type, "heading");
  assert.equal(applyMarkdownShortcut(createBlock({ text: "> " })).type, "quote");
  assert.equal(applyMarkdownShortcut(createBlock({ text: "[] " })).type, "todo");
  assert.equal(applyMarkdownShortcut(createBlock({ text: "---" })).type, "divider");
});

test("editor-bridge: memory bridge captures host messages and dispatches client messages", () => {
  const bridge = createMemoryEditorBridge();
  let received = "";
  bridge.adapter.subscribe((message) => {
    received = message.type;
  });
  bridge.adapter.postMessage({ type: "editor:ready" });
  bridge.sendToEditor({ type: "host:set-read-only", readOnly: true });
  assert.equal(bridge.hostMessages.length, 1);
  assert.equal(received, "host:set-read-only");
});
