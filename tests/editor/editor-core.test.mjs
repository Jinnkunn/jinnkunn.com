import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applyMarkdownShortcut,
  applyTransaction,
  clampSelection,
  createBlock,
  createDefaultEditorExtensionManifest,
  createCollapsedSelection,
  createDocument,
  createEditorHistory,
  documentToMarkdown,
  getBlockPlainText,
  insertBlockAfter,
  insertDocumentFragment,
  listBlockSpecs,
  listTextMarkSpecs,
  markdownToDocument,
  mergeWithPrevious,
  moveBlock,
  redo,
  setBlockAttrs,
  setBlockIndent,
  setBlockType,
  setTextMark,
  splitBlock,
  toggleTodo,
  toggleTextMark,
  undo,
  updateBlockText,
  updateBlockTextWithMarkdownShortcut,
  getSelectionFocus,
  initializeEditorCore,
  isSelectionCollapsed,
  mergeEditorExtensionManifests,
  selectionAtBlockEnd,
} from "../../packages/editor-core/src/index.ts";
import { createMemoryEditorBridge } from "../../packages/editor-bridge/src/index.ts";
import { renderDocumentToHtml } from "../../packages/editor-renderer/src/index.ts";

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

  const imported = markdownToDocument("# Title\n> Quote\n> [!note] Note\n```\nlet ok = true;\n```\n---\n- Item", "Imported");
  assert.deepEqual(
    imported.blocks.map((block) => block.type),
    ["heading", "quote", "callout", "code-block", "divider", "bulleted-list"],
  );
  assert.equal(imported.blocks[3].text[0].text, "let ok = true;");
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
    { text: "world", marks: [{ type: "bold" }] },
  ]);
  assert.deepEqual(boldTx.selection, {
    anchor: { blockId: "a", offset: 6 },
    focus: { blockId: "a", offset: 11 },
  });

  document = toggleTextMark(document, "a", 0, 5, "italic").after;
  assert.equal(documentToMarkdown(document), "*Hello* **world**");

  document = toggleTextMark(document, "a", 6, 11, "bold").after;
  assert.deepEqual(document.blocks[0].text, [
    { text: "Hello", marks: [{ type: "italic" }] },
    { text: " world" },
  ]);

  const imported = markdownToDocument("*Hello* **world**", "Inline");
  assert.deepEqual(imported.blocks[0].text, [
    { text: "Hello", marks: [{ type: "italic" }] },
    { text: " " },
    { text: "world", marks: [{ type: "bold" }] },
  ]);
});

test("editor-core: update text preserves marks around local edits", () => {
  let document = createDocument({
    blocks: [createBlock({ id: "a", text: "Hello world" })],
  });
  document = toggleTextMark(document, "a", 6, 11, "bold").after;

  document = updateBlockText(document, "a", "Hello woXrld", 9).after;
  assert.deepEqual(document.blocks[0].text, [
    { text: "Hello " },
    { text: "woXrld", marks: [{ type: "bold" }] },
  ]);

  document = updateBlockText(document, "a", "Hello world", 8).after;
  assert.deepEqual(document.blocks[0].text, [
    { text: "Hello " },
    { text: "world", marks: [{ type: "bold" }] },
  ]);

  document = setTextMark(document, "a", 6, 11, "link", { href: "/world" }).after;
  document = updateBlockText(document, "a", "Hello worldly", 13).after;
  assert.deepEqual(document.blocks[0].text, [
    { text: "Hello " },
    {
      text: "worldly",
      marks: [
        { type: "bold" },
        { type: "link", attrs: { href: "/world" } },
      ],
    },
  ]);
});

test("editor-core: extended block and mark specs are available from wasm", () => {
  assert.ok(listBlockSpecs().some((spec) => spec.blockType === "code-block" && spec.markdownShortcut === "```"));
  assert.ok(listBlockSpecs().some((spec) => spec.blockType === "callout" && spec.placeholder === "Callout"));
  assert.ok(listBlockSpecs().some((spec) => spec.blockType === "image" && spec.name === "image"));
  assert.ok(listBlockSpecs().some((spec) => spec.blockType === "bookmark" && spec.name === "bookmark"));
  assert.ok(listTextMarkSpecs().some((spec) => spec.mark === "strikethrough" && spec.shortcut === "mod+shift+x"));
  assert.ok(listTextMarkSpecs().some((spec) => spec.mark === "highlight" && spec.tag === "mark"));
  assert.ok(listTextMarkSpecs().some((spec) => spec.mark === "icon-link" && spec.kind === "icon-link"));
  assert.ok(listTextMarkSpecs().some((spec) => spec.mark === "background-color" && spec.values.includes("yellow")));
});

test("editor-core: extension manifest describes block and mark attrs", () => {
  const manifest = createDefaultEditorExtensionManifest();
  const image = manifest.blocks.find((spec) => spec.name === "image");
  const link = manifest.textMarks.find((spec) => spec.mark === "link");
  assert.equal(image?.renderKind, "structured");
  assert.equal(image?.group, "media");
  assert.ok(image?.attrsSchema?.some((attr) => attr.name === "url" && attr.valueType === "url"));
  assert.equal(link?.toolbar, true);
  assert.ok(link?.attrsSchema?.some((attr) => attr.name === "href" && attr.required));

  const merged = mergeEditorExtensionManifests([
    manifest,
    {
      id: "test",
      label: "Test",
      version: "0.0.1",
      blocks: [
        {
          ...image,
          label: "Image Override",
        },
      ],
      textMarks: [],
    },
  ]);
  assert.equal(merged.blocks.find((spec) => spec.name === "image")?.label, "Image Override");
});

test("editor-core: extended text marks and block markdown roundtrip", () => {
  let document = createDocument({
    blocks: [createBlock({ id: "a", text: "Alpha Beta Gamma" })],
  });
  document = toggleTextMark(document, "a", 0, 5, "highlight").after;
  document = toggleTextMark(document, "a", 6, 10, "strikethrough").after;
  assert.equal(documentToMarkdown(document), "==Alpha== ~~Beta~~ Gamma");

  document = setBlockType(document, "a", "callout").after;
  assert.equal(documentToMarkdown(document), "> [!note] ==Alpha== ~~Beta~~ Gamma");

  const imported = markdownToDocument("==Alpha== ~~Beta~~ Gamma", "Inline");
  assert.deepEqual(imported.blocks[0].text, [
    { text: "Alpha", marks: [{ type: "highlight" }] },
    { text: " " },
    { text: "Beta", marks: [{ type: "strikethrough" }] },
    { text: " Gamma" },
  ]);

  const code = markdownToDocument("```\none\ntwo\n```", "Code");
  assert.equal(code.blocks[0].type, "code-block");
  assert.equal(code.blocks[0].text[0].text, "one\ntwo");
});

test("editor-core: attributed inline marks serialize links, icon links, and colors", () => {
  let document = createDocument({
    blocks: [createBlock({ id: "a", text: "Dalhousie Yiling gray" })],
  });
  document = setTextMark(document, "a", 0, 9, "link", { href: "https://www.dal.ca/" }).after;
  document = setTextMark(document, "a", 0, 9, "icon-link", {}).after;
  document = setTextMark(document, "a", 10, 16, "background-color", { color: "yellow" }).after;
  document = setTextMark(document, "a", 17, 21, "text-color", { color: "gray" }).after;

  assert.equal(
    documentToMarkdown(document),
    '<span data-link-style="icon">[Dalhousie](https://www.dal.ca/)</span> <span data-bg="yellow">Yiling</span> <span data-color="gray">gray</span>',
  );

  const imported = markdownToDocument(
    '<span data-link-style="icon">[Blog](/blog)</span> <span data-color="gray">muted</span>',
    "Inline",
  );
  assert.deepEqual(imported.blocks[0].text, [
    {
      text: "Blog",
      marks: [
        { type: "link", attrs: { href: "/blog" } },
        { type: "icon-link" },
      ],
    },
    { text: " " },
    { text: "muted", marks: [{ type: "text-color", attrs: { color: "gray" } }] },
  ]);
});

test("editor-core: markdown shortcuts produce block type changes", () => {
  assert.equal(applyMarkdownShortcut(createBlock({ text: "# " })).type, "heading");
  assert.equal(applyMarkdownShortcut(createBlock({ text: "> " })).type, "quote");
  assert.equal(applyMarkdownShortcut(createBlock({ text: "[] " })).type, "todo");
  assert.equal(applyMarkdownShortcut(createBlock({ text: "---" })).type, "divider");
  assert.equal(applyMarkdownShortcut(createBlock({ text: "```" })).type, "code-block");
  assert.equal(applyMarkdownShortcut(createBlock({ text: "! " })).type, "callout");

  const document = createDocument({ blocks: [createBlock({ id: "a", text: "" })] });
  const tx = updateBlockTextWithMarkdownShortcut(document, "a", "## ", 3);
  assert.equal(tx.kind, "markdown-shortcut");
  assert.equal(tx.before.blocks[0].type, "paragraph");
  assert.equal(tx.after.blocks[0].type, "heading");
  assert.equal(tx.after.blocks[0].level, 2);
  assert.equal(getBlockPlainText(tx.after.blocks[0]), "");
  assert.deepEqual(getSelectionFocus(tx.selection), { blockId: "a", offset: 0 });
});

test("editor-core: inserts markdown document fragments as one transaction", () => {
  let document = createDocument({
    blocks: [createBlock({ id: "a", text: "Hello world" })],
  });
  const inlineFragment = markdownToDocument("**bold**", "Clipboard");
  let tx = insertDocumentFragment(document, "a", 6, 6, inlineFragment);
  document = tx.after;
  assert.equal(tx.kind, "insert-fragment");
  assert.deepEqual(document.blocks[0].text, [
    { text: "Hello " },
    { text: "bold", marks: [{ type: "bold" }] },
    { text: "world" },
  ]);
  assert.deepEqual(getSelectionFocus(tx.selection), { blockId: "a", offset: 10 });

  const fullBlock = createDocument({
    blocks: [createBlock({ id: "empty", text: "" })],
  });
  tx = insertDocumentFragment(fullBlock, "empty", 0, 0, markdownToDocument("# Title\n- Item", "Clipboard"));
  assert.equal(tx.after.blocks.length, 2);
  assert.equal(tx.after.blocks[0].id, "empty");
  assert.equal(tx.after.blocks[0].type, "heading");
  assert.equal(tx.after.blocks[1].type, "bulleted-list");
  assert.deepEqual(getSelectionFocus(tx.selection), { blockId: tx.after.blocks[1].id, offset: 4 });
});

test("editor-core: structured block attrs support media-like blocks", () => {
  let document = createDocument({
    blocks: [createBlock({ id: "img", type: "image", text: "Diagram" })],
  });
  document = setBlockAttrs(document, "img", { url: "https://example.com/diagram.png", alt: "Diagram" }).after;
  assert.equal(document.blocks[0].attrs.url, "https://example.com/diagram.png");
  assert.equal(documentToMarkdown(document), "![Diagram](https://example.com/diagram.png)");

  const imported = markdownToDocument("![Alt](https://example.com/a.png)\n<Embed url=\"https://example.com/embed\" />", "Media");
  assert.equal(imported.blocks[0].type, "image");
  assert.equal(imported.blocks[0].attrs.url, "https://example.com/a.png");
  assert.equal(imported.blocks[1].type, "embed");
});

test("editor-renderer: renders read-only html for rich marks and structured blocks", () => {
  let document = createDocument({
    blocks: [
      createBlock({ id: "q", type: "quote", text: "Context" }),
      createBlock({ id: "p", text: "Yimen Chen" }),
      createBlock({ id: "img", type: "image", text: "River view" }),
    ],
  });
  document = setTextMark(document, "p", 0, 10, "link", { href: "/chen" }).after;
  document = setTextMark(document, "p", 0, 10, "icon-link", {}).after;
  document = setBlockAttrs(document, "img", { url: "https://example.com/yiling.jpg", alt: "Yiling" }).after;

  const html = renderDocumentToHtml(document);
  assert.match(html, /<blockquote class="jer-block jer-block--quote">Context<\/blockquote>/);
  assert.match(html, /data-link-style="icon"/);
  assert.match(html, /<a href="\/chen" rel="noreferrer">Yimen Chen<\/a>/);
  assert.match(html, /<img src="https:\/\/example.com\/yiling.jpg" alt="Yiling" \/>/);
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
