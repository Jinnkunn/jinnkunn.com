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
  editableMarkRangeAtSelection,
  executeBlockCommand,
  executeTextMarkCommand,
  findEditorCommand,
  getBlockPlainText,
  insertBlockAfter,
  insertDocumentFragment,
  isSameBlockSelection,
  listBlockSpecs,
  listTextMarkSpecs,
  markRangeAtOffset,
  markRangesInBlock,
  marksAtOffset,
  markdownToDocument,
  mergeWithPrevious,
  moveBlock,
  redo,
  searchEditorCommandNames,
  selectedMarkAttrs,
  selectedRange,
  selectionFormattingSnapshot,
  selectionHasMark,
  selectionMarkState,
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
import {
  createCommandResultMessage,
  createMemoryEditorBridge,
  createReadyMessage,
  EDITOR_BRIDGE_COMMANDS,
  EDITOR_BRIDGE_PROTOCOL_VERSION,
  parseHostToEditorMessage,
} from "../../packages/editor-bridge/src/index.ts";
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

test("editor-core: selection ranges and mark state are computed in wasm", () => {
  let document = createDocument({
    blocks: [createBlock({ id: "a", text: "Hello world again" }), createBlock({ id: "b", text: "Other" })],
  });
  document = setTextMark(document, "a", 0, 5, "bold").after;
  document = setTextMark(document, "a", 6, 11, "link", { href: "/world" }).after;
  document = setTextMark(document, "a", 6, 11, "icon-link", { icon: "go" }).after;

  const reverseSelection = {
    anchor: { blockId: "a", offset: 11 },
    focus: { blockId: "a", offset: 6 },
  };
  assert.equal(isSameBlockSelection(reverseSelection), true);
  assert.equal(isSameBlockSelection({ ...reverseSelection, focus: { blockId: "b", offset: 0 } }), false);
  assert.deepEqual(selectedRange(reverseSelection), { blockId: "a", start: 6, end: 11 });

  const block = document.blocks[0];
  assert.deepEqual(markRangesInBlock(block, "link"), [
    { blockId: "a", start: 6, end: 11, attrs: { href: "/world" } },
  ]);
  assert.deepEqual(markRangeAtOffset(block, 8, "link"), { blockId: "a", start: 6, end: 11 });
  assert.deepEqual(editableMarkRangeAtSelection(block, createCollapsedSelection("a", 8)), { blockId: "a", start: 6, end: 11 });
  assert.equal(selectionHasMark(block, reverseSelection, "link"), true);
  assert.deepEqual(selectedMarkAttrs(block, reverseSelection, "link"), { href: "/world" });
  assert.deepEqual(marksAtOffset(block, 8), [
    { type: "link", attrs: { href: "/world" } },
    { type: "icon-link", attrs: { icon: "go" } },
  ]);
  assert.deepEqual(selectionMarkState(block, reverseSelection, "link"), {
    active: true,
    attrs: { href: "/world" },
    mixed: false,
  });
  assert.deepEqual(selectionMarkState(block, { anchor: { blockId: "a", offset: 0 }, focus: { blockId: "a", offset: 11 } }, "bold"), {
    active: false,
    attrs: null,
    mixed: true,
  });
  assert.deepEqual(selectionMarkState(block, createCollapsedSelection("a", 0), "highlight", [{ type: "highlight" }]), {
    active: true,
    attrs: null,
    mixed: false,
  });
  assert.deepEqual(selectionFormattingSnapshot(block, reverseSelection, ["link", "bold", "highlight"]), {
    link: { active: true, attrs: { href: "/world" }, mixed: false },
    bold: { active: false, attrs: null, mixed: false },
    highlight: { active: false, attrs: null, mixed: false },
  });
  assert.deepEqual(selectionFormattingSnapshot(block, createCollapsedSelection("a", 0), ["highlight", "bold"], [{ type: "highlight" }]), {
    highlight: { active: true, attrs: null, mixed: false },
    bold: { active: false, attrs: null, mixed: false },
  });

  let adjacentLinks = createDocument({
    blocks: [createBlock({ id: "links", text: "abcdef" })],
  });
  adjacentLinks = setTextMark(adjacentLinks, "links", 0, 3, "link", { href: "/a" }).after;
  adjacentLinks = setTextMark(adjacentLinks, "links", 3, 6, "link", { href: "/b" }).after;
  assert.deepEqual(
    selectionFormattingSnapshot(adjacentLinks.blocks[0], { anchor: { blockId: "links", offset: 0 }, focus: { blockId: "links", offset: 6 } }, ["link"]),
    {
      link: { active: true, attrs: null, mixed: true },
    },
  );
});

test("editor-core: command search ranking and aliases live in wasm", () => {
  const commands = listBlockSpecs();
  assert.equal(searchEditorCommandNames(commands, "h2")[0], "heading-2");
  assert.equal(searchEditorCommandNames(commands, "codeblock")[0], "code-block");
  assert.ok(searchEditorCommandNames(commands, "task").includes("todo"));
  assert.equal(findEditorCommand("h2")[0].name, "heading-2");
});

test("editor-core: executes block commands for slash and turn-into sources", () => {
  const heading2 = { name: "heading-2", blockType: "heading", level: 2 };
  const todo = { name: "todo", blockType: "todo" };
  const quote = { name: "quote", blockType: "quote" };
  const paragraph = { name: "paragraph", blockType: "paragraph" };

  let document = createDocument({
    blocks: [createBlock({ id: "a", text: "Hello /h2" })],
  });
  let tx = executeBlockCommand(document, "a", heading2, "slash", "h2");
  assert.equal(tx.kind, "set-block-type");
  assert.equal(tx.after.blocks[0].type, "heading");
  assert.equal(tx.after.blocks[0].level, 2);
  assert.equal(getBlockPlainText(tx.after.blocks[0]), "Hello ");
  assert.deepEqual(getSelectionFocus(tx.selection), { blockId: "a", offset: 6 });

  document = createDocument({
    blocks: [createBlock({ id: "empty", text: "/" })],
  });
  tx = executeBlockCommand(document, "empty", todo, "slash", "");
  assert.equal(tx.after.blocks[0].type, "todo");
  assert.equal(getBlockPlainText(tx.after.blocks[0]), "");
  assert.equal(tx.after.blocks[0].checked, false);

  document = createDocument({
    blocks: [createBlock({ id: "turn", text: "Keep me" })],
  });
  tx = executeBlockCommand(document, "turn", quote, "turn-into");
  assert.equal(tx.after.blocks[0].type, "quote");
  assert.equal(getBlockPlainText(tx.after.blocks[0]), "Keep me");

  document = createDocument({
    blocks: [createBlock({ id: "divider", type: "divider", text: "" })],
  });
  tx = executeBlockCommand(document, "divider", paragraph, "turn-into");
  assert.equal(tx.after.blocks[0].type, "paragraph");
  assert.equal(getBlockPlainText(tx.after.blocks[0]), "");

  document = createDocument({
    blocks: [createBlock({ id: "exists", text: "No change" })],
  });
  tx = executeBlockCommand(document, "missing", quote, "turn-into");
  assert.deepEqual(tx.after, document);
  assert.equal(tx.selection, undefined);
});

test("editor-core: executes text mark commands for stored marks and ranges", () => {
  let document = createDocument({
    blocks: [createBlock({ id: "a", text: "Hello world" })],
  });
  const collapsed = createCollapsedSelection("a", 5);
  let result = executeTextMarkCommand(document, collapsed, { command: "toggle", mark: "bold" });
  assert.equal(result.type, "stored-marks");
  assert.deepEqual(result.storedMarks, {
    blockId: "a",
    offset: 5,
    marks: [{ type: "bold" }],
  });

  result = executeTextMarkCommand(document, collapsed, {
    command: "toggle",
    mark: "bold",
    storedMarks: result.storedMarks.marks,
  });
  assert.equal(result.type, "stored-marks");
  assert.deepEqual(result.storedMarks.marks, []);

  result = executeTextMarkCommand(document, { anchor: { blockId: "a", offset: 6 }, focus: { blockId: "a", offset: 11 } }, {
    command: "toggle",
    mark: "bold",
  });
  assert.equal(result.type, "transaction");
  assert.equal(result.transaction.kind, "toggle-text-mark");
  assert.deepEqual(result.transaction.after.blocks[0].text, [
    { text: "Hello " },
    { text: "world", marks: [{ type: "bold" }] },
  ]);

  document = result.transaction.after;
  result = executeTextMarkCommand(document, { anchor: { blockId: "a", offset: 0 }, focus: { blockId: "a", offset: 5 } }, {
    attrs: { color: " gray " },
    command: "set",
    mark: "text-color",
  });
  assert.equal(result.type, "transaction");
  assert.equal(result.transaction.kind, "set-text-mark");
  assert.deepEqual(result.transaction.after.blocks[0].text[0], {
    text: "Hello",
    marks: [{ type: "text-color", attrs: { color: "gray" } }],
  });
});

test("editor-core: executes link and icon-link commands as one core operation", () => {
  let document = createDocument({
    blocks: [createBlock({ id: "a", text: "Yimen Chen lineage" })],
  });
  const nameSelection = { anchor: { blockId: "a", offset: 0 }, focus: { blockId: "a", offset: 10 } };
  let result = executeTextMarkCommand(document, nameSelection, {
    command: "apply-link",
    href: " /chen ",
    icon: "",
  });
  assert.equal(result.type, "transaction");
  assert.deepEqual(result.transaction.after.blocks[0].text[0], {
    text: "Yimen Chen",
    marks: [
      { type: "link", attrs: { href: "/chen" } },
      { type: "icon-link" },
    ],
  });

  document = result.transaction.after;
  result = executeTextMarkCommand(document, createCollapsedSelection("a", 2), {
    command: "apply-link",
    href: "/chen-updated",
    icon: "spark",
  });
  assert.equal(result.type, "transaction");
  assert.deepEqual(result.transaction.after.blocks[0].text[0].marks, [
    { type: "link", attrs: { href: "/chen-updated" } },
    { type: "icon-link", attrs: { icon: "spark" } },
  ]);

  document = result.transaction.after;
  result = executeTextMarkCommand(document, createCollapsedSelection("a", 2), {
    command: "apply-link",
    href: "/chen-updated",
    icon: null,
  });
  assert.equal(result.type, "transaction");
  assert.deepEqual(result.transaction.after.blocks[0].text[0].marks, [
    { type: "link", attrs: { href: "/chen-updated" } },
  ]);

  document = result.transaction.after;
  result = executeTextMarkCommand(document, createCollapsedSelection("a", 2), {
    command: "apply-link",
    href: "",
    icon: null,
  });
  assert.equal(result.type, "transaction");
  assert.deepEqual(result.transaction.after.blocks[0].text, [
    { text: "Yimen Chen lineage" },
  ]);

  result = executeTextMarkCommand(document, createCollapsedSelection("a", 17), {
    command: "apply-link",
    href: "/outside",
    icon: null,
  });
  assert.deepEqual(result, { type: "noop" });
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

test("editor-bridge: parses protocol v1 host messages and ignores unsafe input", () => {
  const document = createDocument({ title: "Bridge", blocks: [createBlock({ id: "a", text: "Loaded" })] });
  const loadMessage = {
    type: "host:load-document",
    protocolVersion: EDITOR_BRIDGE_PROTOCOL_VERSION,
    requestId: "load-1",
    document,
  };
  assert.deepEqual(parseHostToEditorMessage(loadMessage), loadMessage);
  assert.equal(parseHostToEditorMessage({ ...loadMessage, protocolVersion: 2 }), null);
  assert.equal(parseHostToEditorMessage({ ...loadMessage, requestId: "" }), null);
  assert.equal(parseHostToEditorMessage({ ...loadMessage, document: { version: 1, title: "Bad" } }), null);
  assert.equal(parseHostToEditorMessage({ type: "host:run-command", protocolVersion: 1, command: "get-document" }), null);
  assert.deepEqual(parseHostToEditorMessage({ type: "host:mark-saved", protocolVersion: 1, requestId: "saved-1" }), {
    type: "host:mark-saved",
    protocolVersion: 1,
    requestId: "saved-1",
    document: undefined,
  });
  assert.equal(parseHostToEditorMessage({ type: "host:mark-saved", protocolVersion: 1, requestId: "saved-1", document: { version: 1 } }), null);
  assert.equal(parseHostToEditorMessage({ type: "host:unknown", protocolVersion: 1 }), null);
});

test("editor-bridge: memory bridge captures host messages and dispatches valid client messages", () => {
  const bridge = createMemoryEditorBridge();
  let received = "";
  bridge.adapter.subscribe((message) => {
    received = message.type;
  });
  bridge.adapter.postMessage(createReadyMessage());
  bridge.adapter.postMessage(createCommandResultMessage("cmd-1", "get-document", { ok: false, error: { code: "NOPE", message: "Nope" } }));
  assert.equal(bridge.sendToEditor({ type: "host:set-read-only", protocolVersion: 1, readOnly: true }), true);
  assert.equal(bridge.sendToEditor({ type: "host:set-read-only", readOnly: false }), false);
  assert.equal(bridge.hostMessages.length, 2);
  assert.equal(bridge.hostMessages[0].protocolVersion, 1);
  assert.deepEqual(bridge.hostMessages[0].capabilities, EDITOR_BRIDGE_COMMANDS);
  assert.ok(bridge.hostMessages[0].capabilities.includes("get-dirty-state"));
  assert.ok(bridge.hostMessages[0].capabilities.includes("request-save"));
  assert.equal(bridge.hostMessages[1].ok, false);
  assert.equal(received, "host:set-read-only");
});
