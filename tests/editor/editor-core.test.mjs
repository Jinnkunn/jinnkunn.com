import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  setBlockIndent,
  setBlockType,
  splitBlock,
  toggleTodo,
  toggleTextMark,
  undo,
  updateBlockText,
  getSelectionFocus,
  initializeEditorCore,
  isSelectionCollapsed,
  selectionAtBlockEnd,
} from "../../packages/editor-core/src/index.ts";
import { createMemoryEditorBridge } from "../../packages/editor-bridge/src/index.ts";

await initializeEditorCore(
  await readFile(new URL("../../packages/editor-core/pkg/jinnkunn_editor_core_bg.wasm", import.meta.url)),
);

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

test("editor-core: block indent is clamped and survives markdown roundtrip", () => {
  let document = createDocument({
    blocks: [createBlock({ id: "a", text: "Nested" })],
  });
  document = setBlockIndent(document, "a", 2, 3).after;
  assert.equal(document.blocks[0].indent, 2);
  assert.deepEqual(getSelectionFocus(setBlockIndent(document, "a", 9, 1).selection), { blockId: "a", offset: 1 });
  document = setBlockType(document, "a", "bulleted-list").after;

  const markdown = documentToMarkdown(document);
  assert.equal(markdown, "    - Nested");

  const imported = markdownToDocument(markdown, "Imported");
  assert.equal(imported.blocks[0].indent, 2);
  assert.equal(imported.blocks[0].type, "bulleted-list");
});

test("editor-core: text marks split, merge, toggle, and roundtrip through markdown", () => {
  let document = createDocument({
    blocks: [createBlock({ id: "a", text: "Hello world" })],
  });

  const boldTx = toggleTextMark(document, "a", 6, 11, "bold");
  document = boldTx.after;
  assert.deepEqual(document.blocks[0].text, [
    { text: "Hello " },
    { text: "world", marks: ["bold"] },
  ]);
  assert.deepEqual(boldTx.selection, {
    anchor: { blockId: "a", offset: 6 },
    focus: { blockId: "a", offset: 11 },
  });

  document = toggleTextMark(document, "a", 0, 5, "italic").after;
  assert.equal(documentToMarkdown(document), "*Hello* **world**");

  document = toggleTextMark(document, "a", 6, 11, "bold").after;
  assert.deepEqual(document.blocks[0].text, [
    { text: "Hello", marks: ["italic"] },
    { text: " world" },
  ]);

  const imported = markdownToDocument("*Hello* **world**", "Inline");
  assert.deepEqual(imported.blocks[0].text, [
    { text: "Hello", marks: ["italic"] },
    { text: " " },
    { text: "world", marks: ["bold"] },
  ]);
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
