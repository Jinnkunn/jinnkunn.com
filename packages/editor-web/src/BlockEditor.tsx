import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  applyTransaction,
  clampSelection,
  createBlock,
  createCollapsedSelection,
  createDocument,
  createDefaultEditorExtensionManifest,
  createEditorHistory,
  documentToMarkdown,
  deleteBlock,
  getSelectionFocus,
  getBlockPlainText,
  insertBlockAfter,
  insertDocumentFragment,
  markdownToDocument,
  mergeEditorExtensionManifests,
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
  unsetTextMark,
  undo,
  updateBlockText,
  updateBlockTextWithMarkdownShortcut,
  type EditorBlock,
  type EditorBlockExtensionSpec,
  type EditorDocument,
  type EditorExtensionManifest,
  type EditorHistory,
  type EditorSelection,
  type EditorTextMark,
  type EditorTextMarkAttrs,
  type EditorTextMarkType,
  type EditorTextMarkExtensionSpec,
  type EditorTextSpan,
  type EditorTransaction,
} from "../../editor-core/src/index.ts";
import { clipboardDataToMarkdown } from "./clipboard.ts";

export type BlockEditorProps = {
  extensionManifests?: EditorExtensionManifest[];
  initialDocument?: EditorDocument;
  readOnly?: boolean;
  onChange?: (document: EditorDocument, transaction?: EditorTransaction) => void;
};

export type BlockEditorHandle = {
  exportMarkdown(): string;
  focus(): void;
  getDocument(): EditorDocument;
  redo(): EditorDocument;
  undo(): EditorDocument;
};

type SlashState = {
  blockId: string;
  query: string;
  activeIndex: number;
};

type BubblePosition = {
  blockId: string;
  left: number;
  placement: "bottom" | "top";
  top: number;
};

type TextRange = {
  blockId: string;
  end: number;
  start: number;
};

type BlockTypeMenuState = {
  blockId: string;
};

type LinkPopoverState = TextRange & {
  href: string;
  icon: string | null;
  left: number;
  top: number;
};

type DragState = {
  blockId: string;
  overBlockId: string | null;
  placement: "before" | "after";
};

type SlashSection = {
  group: string;
  items: EditorBlockExtensionSpec[];
};

type SelectionMarkState = {
  active: boolean;
  attrs: EditorTextMarkAttrs | null;
  mixed: boolean;
};

type StoredMarksState = {
  blockId: string;
  offset: number;
  marks: EditorTextMark[];
};

type CommitOptions = {
  mergeTyping?: boolean;
  preserveStoredMarks?: boolean;
};

type TypingMergeState = {
  blockId: string;
  transactionId: string;
  updatedAt: number;
};

const STRUCTURED_BLOCK_TYPES = new Set<EditorBlock["type"]>([
  "image",
  "bookmark",
  "embed",
  "file",
  "page-link",
]);

const INLINE_TURN_INTO_BLOCK_TYPES = new Set<EditorBlock["type"]>([
  "paragraph",
  "heading",
  "quote",
  "todo",
  "bulleted-list",
  "numbered-list",
  "code-block",
  "callout",
  "toggle",
  "raw",
]);

const TYPING_MERGE_WINDOW_MS = 1300;
const TOOLBAR_EDGE_MARGIN = 12;
const TOOLBAR_ESTIMATED_WIDTH = 560;
const TOOLBAR_ESTIMATED_HEIGHT = 40;

const TOGGLE_MARK_LABELS: Record<string, string> = {
  bold: "B",
  italic: "I",
  underline: "U",
  code: "<>",
  strikethrough: "S",
  highlight: "H",
};

const EXIT_TO_PARAGRAPH_ON_ENTER = new Set<EditorBlock["type"]>(["heading", "quote", "callout", "toggle"]);

const GROUP_LABELS: Record<EditorBlockExtensionSpec["group"], string> = {
  advanced: "Advanced",
  basic: "Basic",
  embed: "Embed",
  format: "Format",
  media: "Media",
  navigation: "Navigation",
};

const GROUP_ORDER: Record<string, number> = {
  Recent: 0,
  Basic: 1,
  Format: 2,
  Media: 3,
  Embed: 4,
  Navigation: 5,
  Advanced: 6,
};

function blockPlaceholder(block: EditorBlock, blockSpecs: EditorBlockExtensionSpec[], isFocused: boolean): string {
  if (!isFocused) return "";
  if (block.type === "paragraph") return "Type '/' for commands";
  const spec = blockSpecs.find((candidate) => {
    if (candidate.blockType !== block.type) return false;
    if (candidate.blockType !== "heading") return true;
    return candidate.level === (block.level || 1);
  });
  return spec?.placeholder || "";
}

function blockClassName(block: EditorBlock): string {
  return ["je-block", `je-block--${block.type}`, block.checked ? "is-checked" : ""]
    .filter(Boolean)
    .join(" ");
}

function blockTextLength(block: EditorBlock): number {
  return getBlockPlainText(block).length;
}

function isSelectionAtStart(selection: EditorSelection | null, block: EditorBlock): boolean {
  return isSameBlockSelection(selection) && selection.anchor.offset === 0 && selection.focus.offset === 0;
}

function isSelectionAtEnd(selection: EditorSelection | null, block: EditorBlock): boolean {
  const length = blockTextLength(block);
  return isSameBlockSelection(selection) && selection.anchor.offset === length && selection.focus.offset === length;
}

function readNodeOffset(element: HTMLElement, node: Node | null, offset: number): number {
  if (!node || !element.contains(node)) return element.textContent?.length || 0;
  const before = document.createRange();
  before.selectNodeContents(element);
  before.setEnd(node, offset);
  return before.toString().length;
}

function readTextSelection(element: HTMLElement, blockId: string): EditorSelection {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return createCollapsedSelection(blockId, element.textContent?.length || 0);
  }
  return {
    anchor: {
      blockId,
      offset: readNodeOffset(element, selection.anchorNode, selection.anchorOffset),
    },
    focus: {
      blockId,
      offset: readNodeOffset(element, selection.focusNode, selection.focusOffset),
    },
  };
}

function readTextOffset(element: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return element.textContent?.length || 0;
  return readNodeOffset(element, selection.focusNode, selection.focusOffset);
}

function isPointInsideTextContent(element: HTMLElement, clientX: number, clientY: number): boolean {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;

  while (node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width === 0 || rect.height === 0) continue;
      if (clientX >= rect.left - 2 && clientX <= rect.right + 2 && clientY >= rect.top - 2 && clientY <= rect.bottom + 2) {
        return true;
      }
    }
    node = walker.nextNode() as Text | null;
  }

  return false;
}

function readElementTextRange(root: HTMLElement, element: HTMLElement): TextRange | null {
  if (!root.contains(element)) return null;
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEndBefore(element);
  const start = before.toString().length;
  return {
    blockId: "",
    end: start + (element.textContent?.length || 0),
    start,
  };
}

function readSelectionBubblePosition(element: HTMLElement, blockId: string, allowCollapsed = false): BubblePosition | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  if (selection.isCollapsed && !allowCollapsed) return null;
  if (!element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) return null;

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  const fallback = range.getClientRects()[0];
  const elementBox = element.getBoundingClientRect();
  const box = rect.width > 0 || rect.height > 0 ? rect : fallback ?? elementBox;
  if (!box) return null;
  const toolbarWidth = Math.min(TOOLBAR_ESTIMATED_WIDTH, Math.max(0, window.innerWidth - TOOLBAR_EDGE_MARGIN * 2));
  const halfWidth = toolbarWidth / 2;
  const preferredLeft = selection.isCollapsed ? box.left : box.left + box.width / 2;
  const minLeft = TOOLBAR_EDGE_MARGIN + halfWidth;
  const maxLeft = Math.max(minLeft, window.innerWidth - TOOLBAR_EDGE_MARGIN - halfWidth);
  const hasRoomAbove = box.top - TOOLBAR_ESTIMATED_HEIGHT - TOOLBAR_EDGE_MARGIN > 0;
  const placement = hasRoomAbove ? "top" : "bottom";

  return {
    blockId,
    left: Math.min(Math.max(preferredLeft, minLeft), maxLeft),
    placement,
    top: placement === "top" ? box.top : box.bottom,
  };
}

function textPointAtOffset(element: HTMLElement, offset: number): { node: Text; offset: number } {
  const text = element.textContent || "";
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  let cursor = 0;

  while (node) {
    const nextCursor = cursor + node.data.length;
    if (safeOffset <= nextCursor) {
      return { node, offset: safeOffset - cursor };
    }
    cursor = nextCursor;
    node = walker.nextNode() as Text | null;
  }

  return {
    node: element.appendChild(document.createTextNode("")),
    offset: 0,
  };
}

function setTextSelection(element: HTMLElement, nextSelection: EditorSelection) {
  element.focus();
  const anchor = textPointAtOffset(element, nextSelection.anchor.offset);
  const focus = textPointAtOffset(element, nextSelection.focus.offset);
  const range = document.createRange();
  range.setStart(anchor.node, anchor.offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  selection?.extend?.(focus.node, focus.offset);
}

function markOfType(marks: EditorTextMark[] | undefined, type: EditorTextMarkType): EditorTextMark | null {
  return marks?.find((mark) => mark.type === type) ?? null;
}

function markAttrs(marks: EditorTextMark[] | undefined, type: EditorTextMarkType): EditorTextMarkAttrs | null {
  return markOfType(marks, type)?.attrs ?? null;
}

function hasMarkType(marks: EditorTextMark[] | undefined, type: EditorTextMarkType): boolean {
  return Boolean(markOfType(marks, type));
}

function applyMarksToNode(text: string, marks: EditorTextMark[] | undefined): Node {
  let node: Node = document.createTextNode(text);
  if (hasMarkType(marks, "code")) {
    const code = document.createElement("code");
    code.append(node);
    node = code;
  }
  if (hasMarkType(marks, "bold")) {
    const strong = document.createElement("strong");
    strong.append(node);
    node = strong;
  }
  if (hasMarkType(marks, "italic")) {
    const em = document.createElement("em");
    em.append(node);
    node = em;
  }
  if (hasMarkType(marks, "underline")) {
    const underline = document.createElement("u");
    underline.append(node);
    node = underline;
  }
  if (hasMarkType(marks, "strikethrough")) {
    const strike = document.createElement("s");
    strike.append(node);
    node = strike;
  }
  if (hasMarkType(marks, "highlight")) {
    const highlight = document.createElement("mark");
    highlight.append(node);
    node = highlight;
  }
  const linkAttrs = markAttrs(marks, "link");
  if (linkAttrs?.href) {
    const link = document.createElement("a");
    link.href = linkAttrs.href;
    link.setAttribute("data-je-link", "true");
    link.append(node);
    node = link;
  }
  const iconAttrs = markAttrs(marks, "icon-link");
  if (iconAttrs || hasMarkType(marks, "icon-link")) {
    const icon = document.createElement("span");
    icon.setAttribute("data-link-style", "icon");
    if (iconAttrs?.icon) {
      icon.setAttribute("data-link-icon", iconAttrs.icon);
      icon.style.setProperty("--je-link-icon-image", `url("${iconAttrs.icon}")`);
    }
    icon.append(node);
    node = icon;
  }
  const textColor = markAttrs(marks, "text-color")?.color;
  if (textColor) {
    const color = document.createElement("span");
    color.setAttribute("data-color", textColor);
    color.append(node);
    node = color;
  }
  const backgroundColor = markAttrs(marks, "background-color")?.color;
  if (backgroundColor) {
    const bg = document.createElement("span");
    bg.setAttribute("data-bg", backgroundColor);
    bg.append(node);
    node = bg;
  }
  return node;
}

function shortcutMatches(event: React.KeyboardEvent<HTMLElement>, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split("+");
  const key = parts.at(-1);
  const expectsMod = parts.includes("mod");
  const expectsShift = parts.includes("shift");
  if (!key) return false;
  if (expectsMod !== (event.metaKey || event.ctrlKey)) return false;
  if (expectsShift !== event.shiftKey) return false;
  if (event.altKey) return false;
  return event.key.toLowerCase() === key;
}

function textMarkForShortcut(
  event: React.KeyboardEvent<HTMLElement>,
  textMarkSpecs: EditorTextMarkExtensionSpec[],
): EditorTextMarkType | null {
  return textMarkSpecs.find((spec) => spec.shortcut && spec.kind === "toggle" && shortcutMatches(event, spec.shortcut))?.mark || null;
}

function isSameBlockSelection(selection: EditorSelection | null): selection is EditorSelection {
  return Boolean(selection && selection.anchor.blockId === selection.focus.blockId);
}

function selectedRange(selection: EditorSelection): { blockId: string; start: number; end: number } {
  return {
    blockId: selection.anchor.blockId,
    start: Math.min(selection.anchor.offset, selection.focus.offset),
    end: Math.max(selection.anchor.offset, selection.focus.offset),
  };
}

function markAttrsEqual(left: EditorTextMarkAttrs | null, right: EditorTextMarkAttrs | null): boolean {
  const leftEntries = Object.entries(left ?? {});
  const rightEntries = Object.entries(right ?? {});
  if (leftEntries.length !== rightEntries.length) return false;
  return leftEntries.every(([key, value]) => right?.[key] === value);
}

function textMarkFrom(mark: EditorTextMarkType, attrs: EditorTextMarkAttrs = {}): EditorTextMark {
  return Object.keys(attrs).length ? { type: mark, attrs } : { type: mark };
}

function normalizeStoredMarks(marks: EditorTextMark[]): EditorTextMark[] {
  const next = new Map<EditorTextMarkType, EditorTextMark>();
  for (const mark of marks) next.set(mark.type, mark);
  return Array.from(next.values());
}

function toggleStoredMark(marks: EditorTextMark[], mark: EditorTextMarkType): EditorTextMark[] {
  const existing = marks.find((item) => item.type === mark);
  return existing ? marks.filter((item) => item.type !== mark) : normalizeStoredMarks([...marks, { type: mark }]);
}

function setStoredMark(marks: EditorTextMark[], mark: EditorTextMarkType, attrs: EditorTextMarkAttrs = {}): EditorTextMark[] {
  return normalizeStoredMarks([...marks.filter((item) => item.type !== mark), textMarkFrom(mark, attrs)]);
}

function unsetStoredMark(marks: EditorTextMark[], mark: EditorTextMarkType): EditorTextMark[] {
  return marks.filter((item) => item.type !== mark);
}

function markRangesInBlock(block: EditorBlock, mark: EditorTextMarkType): Array<TextRange & { attrs: EditorTextMarkAttrs | null }> {
  const ranges: Array<TextRange & { attrs: EditorTextMarkAttrs | null }> = [];
  let cursor = 0;
  for (const span of block.text) {
    const spanStart = cursor;
    const spanEnd = cursor + span.text.length;
    cursor = spanEnd;
    const attrs = markAttrs(span.marks, mark);
    if (!hasMarkType(span.marks, mark)) continue;
    const previous = ranges.at(-1);
    if (previous && previous.end === spanStart && markAttrsEqual(previous.attrs, attrs)) {
      previous.end = spanEnd;
    } else {
      ranges.push({ attrs, blockId: block.id, end: spanEnd, start: spanStart });
    }
  }
  return ranges;
}

function isCollapsedSelection(selection: EditorSelection | null): selection is EditorSelection {
  return Boolean(selection && selection.anchor.blockId === selection.focus.blockId && selection.anchor.offset === selection.focus.offset);
}

function commonPrefixLength(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  let index = 0;
  while (index < max && left[index] === right[index]) index += 1;
  return index;
}

function commonSuffixLength(left: string, right: string, prefixLength: number): number {
  const max = Math.min(left.length, right.length) - prefixLength;
  let index = 0;
  while (index < max && left[left.length - 1 - index] === right[right.length - 1 - index]) index += 1;
  return index;
}

function insertedTextRange(previousText: string, nextText: string): TextRange | null {
  if (nextText.length <= previousText.length) return null;
  const start = commonPrefixLength(previousText, nextText);
  const suffix = commonSuffixLength(previousText, nextText, start);
  const end = nextText.length - suffix;
  return end > start ? { blockId: "", start, end } : null;
}

function markRangeAtOffset(block: EditorBlock, offset: number, mark: EditorTextMarkType): TextRange | null {
  const safeOffset = Math.max(0, Math.min(offset, blockTextLength(block)));
  return (
    markRangesInBlock(block, mark).find((range) => {
      if (range.start === range.end) return false;
      if (safeOffset === 0) return range.start === 0;
      return safeOffset > range.start && safeOffset <= range.end;
    }) ?? null
  );
}

function editableMarkRangeAtSelection(
  block: EditorBlock | null,
  selection: EditorSelection | null,
): TextRange | null {
  if (!block || !isSameBlockSelection(selection)) return null;
  const range = selectedRange(selection);
  if (range.start !== range.end) return range;
  return markRangeAtOffset(block, range.start, "link") ?? markRangeAtOffset(block, range.start, "icon-link");
}

function blockMatchesSpec(block: EditorBlock, spec: EditorBlockExtensionSpec): boolean {
  if (block.type !== spec.blockType) return false;
  if (block.type !== "heading") return true;
  return (block.level || 1) === spec.level;
}

function selectionHasMark(block: EditorBlock | null, selection: EditorSelection | null, mark: EditorTextMarkType): boolean {
  if (!block || !isSameBlockSelection(selection)) return false;
  const range = selectedRange(selection);
  if (range.start === range.end) return Boolean(markRangeAtOffset(block, range.start, mark));

  let cursor = 0;
  let touched = false;
  for (const span of block.text) {
    const spanStart = cursor;
    const spanEnd = cursor + span.text.length;
    cursor = spanEnd;
    if (spanEnd <= range.start || spanStart >= range.end) continue;
    touched = true;
    if (!hasMarkType(span.marks, mark)) return false;
  }
  return touched;
}

function selectedMarkAttrs(
  block: EditorBlock | null,
  selection: EditorSelection | null,
  mark: EditorTextMarkType,
): EditorTextMarkAttrs | null {
  if (!block || !isSameBlockSelection(selection)) return null;
  const range = selectedRange(selection);
  if (range.start === range.end) {
    const markRange = markRangeAtOffset(block, range.start, mark);
    if (!markRange) return null;
  }
  let cursor = 0;
  for (const span of block.text) {
    const spanStart = cursor;
    const spanEnd = cursor + span.text.length;
    cursor = spanEnd;
    if (range.start === range.end) {
      if (range.start === 0 ? spanStart !== 0 : range.start <= spanStart || range.start > spanEnd) continue;
    } else if (spanEnd <= range.start || spanStart >= range.end) continue;
    return markAttrs(span.marks, mark);
  }
  return null;
}

function marksAtOffset(block: EditorBlock | null, offset: number): EditorTextMark[] {
  if (!block) return [];
  let cursor = 0;
  for (const span of block.text) {
    const spanStart = cursor;
    const spanEnd = cursor + span.text.length;
    cursor = spanEnd;
    if (offset === 0 ? spanStart === 0 : offset > spanStart && offset <= spanEnd) {
      return span.marks ? [...span.marks] : [];
    }
  }
  return [];
}

function selectionMarkState(
  block: EditorBlock | null,
  selection: EditorSelection | null,
  mark: EditorTextMarkType,
  storedMarks: EditorTextMark[] | null = null,
): SelectionMarkState {
  if (!block || !isSameBlockSelection(selection)) return { active: false, attrs: null, mixed: false };
  const range = selectedRange(selection);
  if (range.start === range.end) {
    if (storedMarks) {
      const storedMark = storedMarks.find((item) => item.type === mark);
      return storedMark
        ? { active: true, attrs: storedMark.attrs ?? null, mixed: false }
        : { active: false, attrs: null, mixed: false };
    }
    return selectionHasMark(block, selection, mark)
      ? { active: true, attrs: selectedMarkAttrs(block, selection, mark), mixed: false }
      : { active: false, attrs: null, mixed: false };
  }

  let cursor = 0;
  let touched = false;
  let marked = 0;
  let unmarked = 0;
  let firstAttrs: EditorTextMarkAttrs | null | undefined;
  let attrsMixed = false;

  for (const span of block.text) {
    const spanStart = cursor;
    const spanEnd = cursor + span.text.length;
    cursor = spanEnd;
    if (spanEnd <= range.start || spanStart >= range.end) continue;

    touched = true;
    const attrs = markAttrs(span.marks, mark);
    if (!hasMarkType(span.marks, mark)) {
      unmarked += 1;
      continue;
    }

    marked += 1;
    if (firstAttrs === undefined) firstAttrs = attrs;
    else if (!markAttrsEqual(firstAttrs, attrs)) attrsMixed = true;
  }

  if (!touched || marked === 0) return { active: false, attrs: null, mixed: false };
  if (unmarked > 0) return { active: false, attrs: firstAttrs ?? null, mixed: true };
  return { active: true, attrs: attrsMixed ? null : firstAttrs ?? null, mixed: attrsMixed };
}

function inlineToolbarBlockSpecs(specs: EditorBlockExtensionSpec[]): EditorBlockExtensionSpec[] {
  return specs.filter((spec) => INLINE_TURN_INTO_BLOCK_TYPES.has(spec.blockType));
}

function normalizedHref(href: string): string {
  const trimmed = href.trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed, window.location.origin).toString();
  } catch {
    return trimmed;
  }
}

function blockAttrString(block: EditorBlock, key: string): string {
  const value = block.attrs?.[key];
  return typeof value === "string" ? value : "";
}

function syncEditableDom(element: HTMLElement, block: EditorBlock) {
  const fragment = document.createDocumentFragment();
  for (const span of block.text) {
    fragment.append(applyMarksToNode(span.text, span.marks));
  }
  element.replaceChildren(fragment);
}

function commandMatchesQuery(command: EditorBlockExtensionSpec, query: string): boolean {
  return commandSearchScore(command, query) < Number.POSITIVE_INFINITY;
}

function commandSearchScore(command: EditorBlockExtensionSpec, query: string): number {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return 0;
  const haystacks = [
    command.name.replace(/-/g, " "),
    command.label,
    command.description,
    command.group,
    command.blockType.replace(/-/g, " "),
    command.markdownShortcut,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  let best = Number.POSITIVE_INFINITY;
  for (const value of haystacks) {
    if (value === normalized) best = Math.min(best, 0);
    else if (value.startsWith(normalized)) best = Math.min(best, 1);
    else {
      const index = value.indexOf(normalized);
      if (index >= 0) best = Math.min(best, 2 + index / 100);
    }
  }
  return best;
}

function compareCommands(left: EditorBlockExtensionSpec, right: EditorBlockExtensionSpec, query: string): number {
  const leftScore = commandSearchScore(left, query);
  const rightScore = commandSearchScore(right, query);
  if (leftScore !== rightScore) return leftScore - rightScore;
  return left.label.localeCompare(right.label);
}

function slashSections(
  commands: EditorBlockExtensionSpec[],
  query: string,
  recentCommandNames: string[],
): SlashSection[] {
  const available = commands
    .filter((command) => command.slashMenu && commandMatchesQuery(command, query))
    .sort((left, right) => compareCommands(left, right, query));
  if (query.trim()) {
    return available.length ? [{ group: "Best matches", items: available }] : [];
  }

  const recent = query
    ? []
    : recentCommandNames
        .map((name) => available.find((command) => command.name === name))
        .filter((command): command is EditorBlockExtensionSpec => Boolean(command));
  const recentNames = new Set(recent.map((command) => command.name));
  const rest = available.filter((command) => !recentNames.has(command.name));
  const sections: SlashSection[] = [];
  if (recent.length) sections.push({ group: "Recent", items: recent });

  for (const command of rest) {
    const label = GROUP_LABELS[command.group] ?? "Other";
    const existing = sections.find((section) => section.group === label);
    if (existing) existing.items.push(command);
    else sections.push({ group: label, items: [command] });
  }

  return sections.sort((left, right) => (GROUP_ORDER[left.group] ?? 99) - (GROUP_ORDER[right.group] ?? 99));
}

function flattenSlashSections(sections: SlashSection[]): EditorBlockExtensionSpec[] {
  return sections.flatMap((section) => section.items);
}

function SlashMenu({
  slash,
  sections,
  onSelect,
  onActiveIndexChange,
}: {
  slash: SlashState;
  sections: SlashSection[];
  onSelect: (command: EditorBlockExtensionSpec) => void;
  onActiveIndexChange: (index: number) => void;
}) {
  let cursor = 0;
  const commandCount = sections.reduce((count, section) => count + section.items.length, 0);
  return (
    <div className="je-slash-menu" role="listbox" aria-label="Block commands">
      <div className="je-slash-menu__label">Commands</div>
      {commandCount === 0 ? <div className="je-slash-menu__empty">No commands</div> : null}
      {sections.map((section) => (
        <div className="je-slash-menu__section" key={section.group}>
          <div className="je-slash-menu__group">{section.group}</div>
          {section.items.map((command) => {
            const index = cursor++;
            return (
              <button
                aria-label={command.label}
                aria-selected={slash.activeIndex === index}
                className="je-slash-menu__item"
                key={command.name}
                role="option"
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect(command);
                }}
                onMouseEnter={() => onActiveIndexChange(index)}
              >
                <span className="je-slash-menu__icon">{command.icon || command.label.slice(0, 1)}</span>
                <span>
                  <strong>{command.label}</strong>
                  <small>{command.description}</small>
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function activeBlockSpec(block: EditorBlock | null, specs: EditorBlockExtensionSpec[]): EditorBlockExtensionSpec | null {
  if (!block) return null;
  return specs.find((spec) => blockMatchesSpec(block, spec)) ?? null;
}

function ToolbarGlyph({ spec }: { spec: EditorTextMarkExtensionSpec }) {
  if (spec.mark === "link") {
    return (
      <svg aria-hidden="true" className="je-toolbar-glyph" viewBox="0 0 16 16">
        <path d="M6.4 10.8 5.2 12a2.8 2.8 0 0 1-4-4l2-2a2.8 2.8 0 0 1 4 0" />
        <path d="m9.6 5.2 1.2-1.2a2.8 2.8 0 0 1 4 4l-2 2a2.8 2.8 0 0 1-4 0" />
        <path d="m5.8 10.2 4.4-4.4" />
      </svg>
    );
  }
  if (spec.mark === "icon-link") {
    return (
      <svg aria-hidden="true" className="je-toolbar-glyph" viewBox="0 0 16 16">
        <path d="M3 5.5h4.5V10H3z" />
        <path d="M9 4h3v3" />
        <path d="m8.8 7.2 3-3" />
        <path d="M7.5 12H3a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2h3.5" />
      </svg>
    );
  }
  if (spec.mark === "background-color") {
    return <span className="je-toolbar-glyph je-toolbar-glyph--fill">A</span>;
  }
  if (spec.mark === "text-color") {
    return <span className="je-toolbar-glyph je-toolbar-glyph--color">A</span>;
  }
  return <span className="je-toolbar-glyph je-toolbar-glyph--text">{TOGGLE_MARK_LABELS[spec.mark] || spec.label.slice(0, 1)}</span>;
}

function InlineToolbar({
  activeBlock,
  blockSpecs,
  position,
  selection,
  specs,
  storedMarks,
  onApplyLink,
  onSetBlockType,
  onSet,
  onToggle,
  onUnset,
}: {
  activeBlock: EditorBlock | null;
  blockSpecs: EditorBlockExtensionSpec[];
  position: BubblePosition;
  selection: EditorSelection | null;
  specs: EditorTextMarkExtensionSpec[];
  storedMarks: EditorTextMark[] | null;
  onApplyLink: (href: string, icon: string | null) => void;
  onSetBlockType: (block: EditorBlock, spec: EditorBlockExtensionSpec) => void;
  onSet: (mark: EditorTextMarkType, attrs?: EditorTextMarkAttrs) => void;
  onToggle: (mark: EditorTextMarkType) => void;
  onUnset: (mark: EditorTextMarkType) => void;
}) {
  const [panel, setPanel] = useState<null | { mark: EditorTextMarkExtensionSpec }>(null);
  const [blockPanelOpen, setBlockPanelOpen] = useState(false);
  const blockTypeSpecs = inlineToolbarBlockSpecs(blockSpecs);
  const currentBlockSpec = activeBlockSpec(activeBlock, blockSpecs);
  const linkAttrs = selectedMarkAttrs(activeBlock, selection, "link");
  const iconAttrs = selectedMarkAttrs(activeBlock, selection, "icon-link");
  const [href, setHref] = useState(linkAttrs?.href ?? "");
  const [icon, setIcon] = useState(iconAttrs?.icon ?? "");
  const hrefInputRef = useRef<HTMLInputElement>(null);
  const linkPanelOpen = panel?.mark.kind === "link" || panel?.mark.kind === "icon-link";
  const panelMarkState = panel ? selectionMarkState(activeBlock, selection, panel.mark.mark, storedMarks) : null;
  const panelSelectedColor = panel?.mark.kind === "color" && panelMarkState?.active && !panelMarkState.mixed
    ? panelMarkState.attrs?.color ?? "default"
    : "default";

  useEffect(() => {
    setHref(linkAttrs?.href ?? "");
    setIcon(iconAttrs?.icon ?? "");
  }, [linkAttrs?.href, iconAttrs?.icon, selection?.anchor.offset, selection?.focus.offset]);

  useEffect(() => {
    if (!linkPanelOpen) return;
    requestAnimationFrame(() => hrefInputRef.current?.focus());
  }, [linkPanelOpen, panel?.mark.mark]);

  const applyLink = (iconMode: boolean) => {
    const nextHref = href.trim();
    if (!nextHref) {
      onApplyLink("", null);
      setPanel(null);
      return;
    }
    onApplyLink(nextHref, iconMode ? icon.trim() : null);
    setPanel(null);
  };

  return (
    <div
      className="je-inline-toolbar"
      data-placement={position.placement}
      role="toolbar"
      aria-label="Inline text styles"
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target?.closest("input")) return;
        event.preventDefault();
      }}
    >
      {activeBlock && currentBlockSpec ? (
        <>
          <button
            aria-expanded={blockPanelOpen}
            aria-label={`Block type: ${currentBlockSpec.label}`}
            className="je-inline-toolbar__block-button"
            title={`Block type: ${currentBlockSpec.label}`}
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              setPanel(null);
              setBlockPanelOpen((current) => !current);
            }}
          >
            <span className="je-inline-toolbar__block-icon">{currentBlockSpec.icon || currentBlockSpec.label.slice(0, 1)}</span>
            <span className="je-inline-toolbar__block-label">{currentBlockSpec.label}</span>
          </button>
          <span className="je-inline-toolbar__separator" aria-hidden="true" />
        </>
      ) : null}
      {specs.map((spec) => {
        const markState = selectionMarkState(activeBlock, selection, spec.mark, storedMarks);
        const currentColor = spec.kind === "color" && markState.active && !markState.mixed ? markState.attrs?.color : undefined;
        const title = currentColor && currentColor !== "default" ? `${spec.label}: ${currentColor}` : spec.label;
        const commonButtonProps = {
          "aria-label": spec.label,
          "aria-pressed": markState.active,
          className: "je-inline-toolbar__button",
          "data-current-color": currentColor || undefined,
          "data-mark": spec.mark,
          "data-mixed": markState.mixed ? "true" : undefined,
          title: spec.shortcut ? `${title} (${spec.shortcut})` : title,
          type: "button" as const,
        };
        if (spec.kind === "toggle") {
          return (
            <button
              {...commonButtonProps}
              key={spec.mark}
              onMouseDown={(event) => {
                event.preventDefault();
                setBlockPanelOpen(false);
                onToggle(spec.mark);
              }}
            >
              <ToolbarGlyph spec={spec} />
            </button>
          );
        }
        if (spec.kind === "link" || spec.kind === "icon-link") {
          return (
            <button
              {...commonButtonProps}
              key={spec.mark}
              onMouseDown={(event) => {
                event.preventDefault();
                setBlockPanelOpen(false);
                setPanel((current) => current?.mark.mark === spec.mark ? null : { mark: spec });
              }}
            >
              <ToolbarGlyph spec={spec} />
            </button>
          );
        }
        return (
          <button
            {...commonButtonProps}
            key={spec.mark}
            onMouseDown={(event) => {
              event.preventDefault();
              setBlockPanelOpen(false);
              setPanel((current) => current?.mark.mark === spec.mark ? null : { mark: spec });
            }}
          >
            <ToolbarGlyph spec={spec} />
          </button>
        );
      })}
      {blockPanelOpen && activeBlock ? (
        <div className="je-inline-block-menu" role="listbox" aria-label="Block type">
          {blockTypeSpecs.map((spec) => (
            <button
              aria-label={spec.label}
              aria-selected={blockMatchesSpec(activeBlock, spec)}
              className="je-inline-block-menu__item"
              key={spec.name}
              role="option"
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                onSetBlockType(activeBlock, spec);
                setBlockPanelOpen(false);
              }}
            >
              <span className="je-inline-block-menu__icon">{spec.icon || spec.label.slice(0, 1)}</span>
              <span>{spec.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      {linkPanelOpen && panel ? (
        <div className="je-inline-popover" role="dialog" aria-label={panel.mark.label}>
          <label>
            <span>URL</span>
            <input
              ref={hrefInputRef}
              value={href}
              placeholder="https:// or /page"
              onChange={(event) => setHref(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyLink(panel.mark.kind === "icon-link");
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setPanel(null);
                }
              }}
            />
          </label>
          {panel.mark.kind === "icon-link" ? (
            <label>
              <span>Icon URL</span>
              <input
                value={icon}
                placeholder="/icon.svg"
                onChange={(event) => setIcon(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyLink(true);
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setPanel(null);
                  }
                }}
              />
            </label>
          ) : null}
          <div className="je-inline-popover__actions">
            <button type="button" onClick={() => applyLink(panel.mark.kind === "icon-link")}>Apply</button>
            <button
              type="button"
              onClick={() => {
                onApplyLink("", null);
                setPanel(null);
              }}
            >
              Remove
            </button>
          </div>
        </div>
      ) : null}
      {panel?.mark.kind === "color" ? (
        <div className="je-color-popover" role="dialog" aria-label={panel.mark.label}>
          {(panel.mark.values ?? []).map((value) => (
            <button
              aria-label={`${panel.mark.label} ${value}`}
              className="je-color-swatch"
              data-color-value={value}
              key={value}
              aria-pressed={panelSelectedColor === value}
              type="button"
              onClick={() => {
                if (value === "default") onUnset(panel.mark.mark);
                else onSet(panel.mark.mark, { color: value });
                setPanel(null);
              }}
            >
              {value === "default" ? "x" : "A"}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LinkPopover({
  link,
  onApply,
  onClose,
  onOpen,
  onRemove,
}: {
  link: LinkPopoverState;
  onApply: (href: string, icon: string | null) => void;
  onClose: () => void;
  onOpen: (href: string) => void;
  onRemove: () => void;
}) {
  const [href, setHref] = useState(link.href);
  const [icon, setIcon] = useState(link.icon ?? "");
  const [editing, setEditing] = useState(false);
  const hrefRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setHref(link.href);
    setIcon(link.icon ?? "");
    setEditing(false);
  }, [link.href, link.icon, link.start, link.end]);

  useEffect(() => {
    if (!editing) return;
    requestAnimationFrame(() => hrefRef.current?.focus());
  }, [editing]);

  function apply() {
    onApply(href, link.icon === null ? null : icon);
  }

  function copyHref() {
    if (navigator.clipboard) void navigator.clipboard.writeText(href).catch(() => undefined);
  }

  if (!editing) {
    return (
      <div
        className="je-link-popover je-link-popover--preview"
        role="dialog"
        aria-label="Link"
        style={{
          left: `${link.left}px`,
          top: `${link.top}px`,
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        onMouseDown={(event) => event.preventDefault()}
      >
        <button className="je-link-popover__target" data-icon={link.icon !== null ? "true" : "false"} type="button" onClick={() => onOpen(href)}>
          {link.icon !== null ? (
            <span
              className="je-link-popover__target-icon"
              style={icon ? { backgroundImage: `url("${icon}")`, color: "transparent" } : undefined}
            >
              {icon ? "" : "->"}
            </span>
          ) : null}
          <span className="je-link-popover__target-text">{href}</span>
        </button>
        <div className="je-link-popover__actions je-link-popover__actions--preview">
          <button type="button" onClick={() => onOpen(href)}>Open</button>
          <button type="button" onClick={() => setEditing(true)}>Edit</button>
          <button type="button" onClick={copyHref}>Copy</button>
          <button type="button" onClick={onRemove}>Remove</button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="je-link-popover je-link-popover--edit"
      role="dialog"
      aria-label="Edit link"
      style={{
        left: `${link.left}px`,
        top: `${link.top}px`,
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      onMouseDown={(event) => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target?.closest("input")) return;
        event.preventDefault();
      }}
    >
      <div className="je-link-popover__row">
        <input
          ref={hrefRef}
          aria-label="Link URL"
          value={href}
          placeholder="https:// or /page"
          onChange={(event) => setHref(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply();
            }
          }}
        />
        <button type="button" onClick={() => onOpen(href)}>Open</button>
      </div>
      {link.icon !== null ? (
        <input
          aria-label="Link icon URL"
          value={icon}
          placeholder="/icon.svg"
          onChange={(event) => setIcon(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply();
            }
          }}
        />
      ) : null}
      <div className="je-link-popover__actions">
        <button type="button" onClick={apply}>Apply</button>
        <button type="button" onClick={() => setEditing(false)}>Cancel</button>
        <button type="button" onClick={onRemove}>Remove</button>
      </div>
    </div>
  );
}

function BlockTypeMenu({
  activeBlock,
  canMoveDown,
  canMoveUp,
  onDelete,
  onDuplicate,
  onMoveDown,
  onMoveUp,
  specs,
  onSelect,
}: {
  activeBlock: EditorBlock;
  canMoveDown: boolean;
  canMoveUp: boolean;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
  specs: EditorBlockExtensionSpec[];
  onSelect: (spec: EditorBlockExtensionSpec) => void;
}) {
  return (
    <div className="je-block-type-menu" role="listbox" aria-label="Block types">
      <div className="je-block-type-menu__actions" role="group" aria-label="Block actions">
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onDuplicate}>Duplicate</button>
        <button type="button" disabled={!canMoveUp} onMouseDown={(event) => event.preventDefault()} onClick={onMoveUp}>Move up</button>
        <button type="button" disabled={!canMoveDown} onMouseDown={(event) => event.preventDefault()} onClick={onMoveDown}>Move down</button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onDelete}>Delete</button>
      </div>
      <div className="je-slash-menu__label">Block type</div>
      {specs.map((spec) => (
        <button
          aria-label={spec.label}
          aria-selected={blockMatchesSpec(activeBlock, spec)}
          className="je-slash-menu__item"
          key={spec.name}
          role="option"
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(spec);
          }}
        >
          <span className="je-slash-menu__icon">{spec.icon || spec.label.slice(0, 1)}</span>
          <span>
            <strong>{spec.label}</strong>
            <small>{spec.description}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

function StructuredBlockEditor({
  block,
  onAttrs,
  onText,
}: {
  block: EditorBlock;
  onAttrs: (attrs: Record<string, unknown>) => void;
  onText: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const text = getBlockPlainText(block);

  if (block.type === "image") {
    const url = blockAttrString(block, "url");
    const alt = blockAttrString(block, "alt");
    const showForm = editing || !url;
    return (
      <div className="je-structured-block je-structured-block--image">
        {url ? <img src={url} alt={alt || text} /> : <div className="je-structured-block__empty">Image</div>}
        <div className="je-structured-block__meta">
          <div>
            <strong>{text || alt || "Untitled image"}</strong>
            {url ? <small>{url}</small> : <small>Add a source URL to render the image.</small>}
          </div>
          <button type="button" onClick={() => setEditing((current) => !current)}>{editing ? "Done" : "Edit"}</button>
        </div>
        {showForm ? (
          <div className="je-structured-block__fields">
            <label>
              <span>URL</span>
              <input value={url} placeholder="https://image.jpg" onChange={(event) => onAttrs({ url: event.target.value })} />
            </label>
            <label>
              <span>Alt</span>
              <input
                value={alt || text}
                placeholder="Image description"
                onChange={(event) => {
                  onAttrs({ alt: event.target.value });
                  onText(event.target.value);
                }}
              />
            </label>
            <label>
              <span>Caption</span>
              <input value={text} placeholder="Optional caption" onChange={(event) => onText(event.target.value)} />
            </label>
          </div>
        ) : null}
      </div>
    );
  }

  if (block.type === "bookmark" || block.type === "embed" || block.type === "file" || block.type === "page-link") {
    const urlKey = block.type === "file" ? "url" : block.type === "page-link" ? "href" : "url";
    const titleLabel = block.type === "file" ? "Name" : block.type === "page-link" ? "Page" : "Title";
    const urlLabel = block.type === "page-link" ? "Href" : "URL";
    const url = blockAttrString(block, urlKey);
    const showForm = editing || (!text && !url);
    return (
      <div className={`je-structured-block je-structured-block--${block.type}`}>
        <div className="je-structured-block__preview">
          <span className="je-structured-block__badge">{block.type}</span>
          <div className="je-structured-block__meta">
            <div>
              <strong>{text || titleLabel}</strong>
              <small>{url || (block.type === "page-link" ? "/page" : "https://")}</small>
            </div>
            <button type="button" onClick={() => setEditing((current) => !current)}>{editing ? "Done" : "Edit"}</button>
          </div>
        </div>
        {showForm ? (
          <div className="je-structured-block__fields">
            <label>
              <span>{titleLabel}</span>
              <input value={text} placeholder={titleLabel} onChange={(event) => onText(event.target.value)} />
            </label>
            <label>
              <span>{urlLabel}</span>
              <input
                value={url}
                placeholder={block.type === "page-link" ? "/page" : "https://"}
                onChange={(event) => onAttrs({ [urlKey]: event.target.value })}
              />
            </label>
          </div>
        ) : null}
      </div>
    );
  }

  return null;
}

export const BlockEditor = forwardRef<BlockEditorHandle, BlockEditorProps>(function BlockEditor(
  { extensionManifests, initialDocument, readOnly = false, onChange },
  ref,
) {
  const initial = useMemo(() => createEditorHistory(initialDocument || createDocument()), [initialDocument]);
  const [history, setHistory] = useState(initial);
  const [selection, setSelection] = useState<EditorSelection | null>(() => {
    const first = initial.document.blocks[0];
    return first ? createCollapsedSelection(first.id, 0) : null;
  });
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [bubblePosition, setBubblePosition] = useState<BubblePosition | null>(null);
  const [blockTypeMenu, setBlockTypeMenu] = useState<BlockTypeMenuState | null>(null);
  const [linkPopover, setLinkPopover] = useState<LinkPopoverState | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [recentCommandNames, setRecentCommandNames] = useState<string[]>([]);
  const [storedMarksState, setStoredMarksState] = useState<StoredMarksState | null>(null);
  const blockRefs = useRef(new Map<string, HTMLElement>());
  const didDragRef = useRef(false);
  const storedMarksRef = useRef<StoredMarksState | null>(null);
  const typingMergeRef = useRef<TypingMergeState | null>(null);
  const pendingFocusRef = useRef<EditorSelection | null>(null);
  const isComposingRef = useRef(false);
  const manifest = useMemo(
    () => mergeEditorExtensionManifests([createDefaultEditorExtensionManifest(), ...(extensionManifests ?? [])]),
    [extensionManifests],
  );
  const blockSpecs = manifest.blocks;
  const textMarkSpecs = manifest.textMarks;

  function getSlashSections(query: string): SlashSection[] {
    return slashSections(blockSpecs, query, recentCommandNames);
  }

  function getSlashCommands(query: string): EditorBlockExtensionSpec[] {
    return flattenSlashSections(getSlashSections(query));
  }

  function setStoredMarks(next: StoredMarksState | null) {
    storedMarksRef.current = next;
    setStoredMarksState(next);
  }

  function storedMarksForSelection(nextSelection = selection): EditorTextMark[] | null {
    if (!isCollapsedSelection(nextSelection)) return null;
    const current = storedMarksRef.current;
    if (!current) return null;
    return current.blockId === nextSelection.anchor.blockId && current.offset === nextSelection.anchor.offset ? current.marks : null;
  }

  function collapsedMarksForSelection(nextSelection = selection): EditorTextMark[] {
    if (!isCollapsedSelection(nextSelection)) return [];
    const explicitMarks = storedMarksForSelection(nextSelection);
    if (explicitMarks) return explicitMarks;
    return marksAtOffset(currentBlock(nextSelection.anchor.blockId), nextSelection.anchor.offset);
  }

  function setCollapsedStoredMarks(marks: EditorTextMark[], nextSelection = selection) {
    if (!isCollapsedSelection(nextSelection)) return;
    setStoredMarks({
      blockId: nextSelection.anchor.blockId,
      offset: nextSelection.anchor.offset,
      marks: normalizeStoredMarks(marks),
    });
  }

  function clearStoredMarks() {
    setStoredMarks(null);
  }

  useEffect(() => {
    setHistory(initial);
    const first = initial.document.blocks[0];
    setSelection(first ? createCollapsedSelection(first.id, 0) : null);
    setSlash(null);
    setBubblePosition(null);
    setBlockTypeMenu(null);
    setLinkPopover(null);
    setSelectedBlockId(null);
    setDragState(null);
    setStoredMarks(null);
    typingMergeRef.current = null;
  }, [initial]);

  function focusSelection(nextSelection: EditorSelection | null) {
    if (!nextSelection) return;
    const focus = getSelectionFocus(nextSelection);
    const target = blockRefs.current.get(focus.blockId);
    if (!target) return;
    setTextSelection(target, nextSelection);
  }

  function setSelectionAndFocus(nextSelection: EditorSelection) {
    pendingFocusRef.current = nextSelection;
    setSelection(nextSelection);
    requestAnimationFrame(() => focusSelection(nextSelection));
  }

  useLayoutEffect(() => {
    if (isComposingRef.current) return;
    for (const block of history.document.blocks) {
      const target = blockRefs.current.get(block.id);
      if (target && block.type !== "divider") syncEditableDom(target, block);
    }
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    focusSelection(pending);
  }, [history.document]);

  function notifyHistoryChange(nextHistory: typeof history, nextSelection: EditorSelection | null) {
    pendingFocusRef.current = nextSelection;
    setHistory(nextHistory);
    setSelection(nextSelection);
    setSlash(null);
    setBubblePosition(null);
    setBlockTypeMenu(null);
    setLinkPopover(null);
    setSelectedBlockId(null);
    setDragState(null);
    clearStoredMarks();
    typingMergeRef.current = null;
    onChange?.(nextHistory.document);
    return nextHistory.document;
  }

  function undoHistory() {
    if (history.undoStack.length === 0) return history.document;
    const nextHistory = undo(history);
    const nextSelection = selectionForDocument(nextHistory.document, selection);
    return notifyHistoryChange(nextHistory, nextSelection);
  }

  function redoHistory() {
    if (history.redoStack.length === 0) return history.document;
    const nextHistory = redo(history);
    const nextSelection = selectionForDocument(nextHistory.document, selection);
    return notifyHistoryChange(nextHistory, nextSelection);
  }

  function commit(transaction: EditorTransaction, options: CommitOptions = {}) {
    const nextSelection = transaction.selection
      ? clampSelection(transaction.after, transaction.selection)
      : selection;
    const nextFocus = nextSelection ? getSelectionFocus(nextSelection) : null;
    const now = Date.now();
    pendingFocusRef.current = nextSelection;
    if (!options.preserveStoredMarks) clearStoredMarks();
    if (!options.mergeTyping) typingMergeRef.current = null;
    setHistory((current): EditorHistory => {
      const last = current.undoStack.at(-1);
      const typingMerge = typingMergeRef.current;
      if (
        options.mergeTyping &&
        nextFocus &&
        last &&
        typingMerge &&
        typingMerge.transactionId === last.id &&
        typingMerge.blockId === nextFocus.blockId &&
        now - typingMerge.updatedAt <= TYPING_MERGE_WINDOW_MS &&
        last.kind === "update-text" &&
        transaction.kind === "update-text"
      ) {
        const mergedTransaction = { ...transaction, before: last.before };
        typingMergeRef.current = {
          blockId: nextFocus.blockId,
          transactionId: mergedTransaction.id,
          updatedAt: now,
        };
        return {
          document: transaction.after,
          undoStack: [...current.undoStack.slice(0, -1), mergedTransaction],
          redoStack: [],
        };
      }

      if (options.mergeTyping && nextFocus && transaction.kind === "update-text") {
        typingMergeRef.current = {
          blockId: nextFocus.blockId,
          transactionId: transaction.id,
          updatedAt: now,
        };
      }
      return applyTransaction(current, transaction);
    });
    setSelection(nextSelection);
    setSlash(null);
    setBubblePosition(null);
    setBlockTypeMenu(null);
    setLinkPopover(null);
    setSelectedBlockId(null);
    setDragState(null);
    onChange?.(transaction.after, transaction);
  }

  useImperativeHandle(ref, () => ({
    exportMarkdown() {
      return documentToMarkdown(history.document);
    },
    focus() {
      const nextSelection = selectionForDocument(history.document, selection);
      if (nextSelection) setSelectionAndFocus(nextSelection);
    },
    getDocument() {
      return history.document;
    },
    redo() {
      return redoHistory();
    },
    undo() {
      return undoHistory();
    },
  }));

  function currentBlock(blockId: string) {
    return history.document.blocks.find((block) => block.id === blockId) || null;
  }

  function selectionForDocument(document: EditorDocument, preferred: EditorSelection | null): EditorSelection | null {
    if (preferred && document.blocks.some((block) => block.id === getSelectionFocus(preferred).blockId)) {
      return clampSelection(document, preferred);
    }
    const firstTextBlock = document.blocks.find((block) => block.type !== "divider" && !STRUCTURED_BLOCK_TYPES.has(block.type));
    return firstTextBlock ? createCollapsedSelection(firstTextBlock.id, blockTextLength(firstTextBlock)) : null;
  }

  function selectCommand(command: EditorBlockExtensionSpec, blockId = slash?.blockId) {
    if (!blockId) return;
    const block = currentBlock(blockId);
    let nextText: string | undefined;

    if (slash?.blockId === blockId && block) {
      const text = getBlockPlainText(block);
      const slashStart = text.lastIndexOf(`/${slash.query}`);
      if (slashStart >= 0) {
        nextText = `${text.slice(0, slashStart)}${text.slice(slashStart + slash.query.length + 1)}`;
      }
    }

    setRecentCommandNames((current) => [command.name, ...current.filter((name) => name !== command.name)].slice(0, 4));
    commit(setBlockType(history.document, blockId, command.blockType, command.level, nextText));
  }

  function selectBlockType(block: EditorBlock, spec: EditorBlockExtensionSpec) {
    const text = block.type === "divider" ? undefined : getBlockPlainText(block);
    commit(setBlockType(history.document, block.id, spec.blockType, spec.level, text));
  }

  function duplicateBlock(block: EditorBlock) {
    const clone = createBlock({
      type: block.type,
      text: block.text,
      level: block.level,
      indent: block.indent,
      checked: block.checked,
      attrs: block.attrs,
      children: block.children,
    });
    commit(insertBlockAfter(history.document, block.id, clone));
  }

  function deleteCurrentBlock(block: EditorBlock) {
    commit(deleteBlock(history.document, block.id));
  }

  function moveCurrentBlock(block: EditorBlock, direction: -1 | 1) {
    const index = history.document.blocks.findIndex((item) => item.id === block.id);
    if (index < 0) return;
    commit(moveBlock(history.document, block.id, index + direction));
  }

  function selectedTextRange(expandMark?: EditorTextMarkType): TextRange | undefined {
    if (!isSameBlockSelection(selection)) return;
    const range = selectedRange(selection);
    if (range.start === range.end) {
      const block = currentBlock(range.blockId);
      return block && expandMark ? markRangeAtOffset(block, range.start, expandMark) ?? undefined : undefined;
    }
    return range;
  }

  function toggleStoredSelectionMark(mark: EditorTextMarkType) {
    const range = selectedTextRange();
    if (!range) {
      if (isCollapsedSelection(selection)) setCollapsedStoredMarks(toggleStoredMark(collapsedMarksForSelection(selection), mark), selection);
      return;
    }
    commit(toggleTextMark(history.document, range.blockId, selection!.anchor.offset, selection!.focus.offset, mark));
  }

  function setStoredSelectionMark(mark: EditorTextMarkType, attrs: EditorTextMarkAttrs = {}) {
    const range = mark === "link" || mark === "icon-link"
      ? selectedTextRange(mark) ?? selectedTextRange("link") ?? selectedTextRange("icon-link")
      : selectedTextRange();
    if (!range) {
      if (isCollapsedSelection(selection) && mark !== "link" && mark !== "icon-link") {
        setCollapsedStoredMarks(setStoredMark(collapsedMarksForSelection(selection), mark, attrs), selection);
      }
      return;
    }
    commit(setTextMark(history.document, range.blockId, range.start, range.end, mark, attrs));
  }

  function unsetStoredSelectionMark(mark: EditorTextMarkType) {
    const range = mark === "link" || mark === "icon-link"
      ? selectedTextRange(mark) ?? selectedTextRange("link") ?? selectedTextRange("icon-link")
      : selectedTextRange();
    if (!range) {
      if (isCollapsedSelection(selection)) setCollapsedStoredMarks(unsetStoredMark(collapsedMarksForSelection(selection), mark), selection);
      return;
    }
    commit(unsetTextMark(history.document, range.blockId, range.start, range.end, mark));
  }

  function applyStoredLink(href: string, icon: string | null) {
    const range = selectedTextRange("link") ?? selectedTextRange("icon-link") ?? selectedTextRange();
    if (!range) return;
    const nextHref = href.trim();
    const linkTx = nextHref
      ? setTextMark(history.document, range.blockId, range.start, range.end, "link", { href: nextHref })
      : unsetTextMark(history.document, range.blockId, range.start, range.end, "link");
    const iconTx = icon === null
      ? unsetTextMark(linkTx.after, range.blockId, range.start, range.end, "icon-link")
      : setTextMark(linkTx.after, range.blockId, range.start, range.end, "icon-link", icon ? { icon } : {});
    commit({ ...iconTx, before: history.document });
  }

  function applyLinkRange(range: TextRange, href: string, icon: string | null) {
    const nextHref = href.trim();
    const linkTx = nextHref
      ? setTextMark(history.document, range.blockId, range.start, range.end, "link", { href: nextHref })
      : unsetTextMark(history.document, range.blockId, range.start, range.end, "link");
    const iconTx = icon === null
      ? unsetTextMark(linkTx.after, range.blockId, range.start, range.end, "icon-link")
      : setTextMark(linkTx.after, range.blockId, range.start, range.end, "icon-link", icon ? { icon } : {});
    commit({ ...iconTx, before: history.document });
  }

  function transactionWithExactMarks(transaction: EditorTransaction, blockId: string, range: TextRange, marks: EditorTextMark[]): EditorTransaction {
    let after = transaction.after;
    let lastTransaction = transaction;
    for (const spec of textMarkSpecs) {
      const mark = marks.find((candidate) => candidate.type === spec.mark);
      lastTransaction = mark
        ? setTextMark(after, blockId, range.start, range.end, spec.mark, mark.attrs ?? {})
        : unsetTextMark(after, blockId, range.start, range.end, spec.mark);
      after = lastTransaction.after;
    }
    return {
      ...lastTransaction,
      before: transaction.before,
      kind: transaction.kind,
      selection: transaction.selection,
    };
  }

  function openHref(href: string) {
    const target = normalizedHref(href);
    if (!target) return;
    window.open(target, "_blank", "noopener,noreferrer");
  }

  function handleText(block: EditorBlock, text: string, offset: number) {
    setSelectedBlockId(null);
    const previousText = getBlockPlainText(block);
    const storedMarks = storedMarksRef.current;
    const insertedRange = insertedTextRange(previousText, text);
    const shouldApplyStoredMarks = Boolean(
      storedMarks &&
      storedMarks.blockId === block.id &&
      insertedRange &&
      insertedRange.start === storedMarks.offset,
    );
    const baseTx = updateBlockTextWithMarkdownShortcut(history.document, block.id, text, offset);
    const tx = shouldApplyStoredMarks && insertedRange && baseTx.kind === "update-text"
      ? transactionWithExactMarks(baseTx, block.id, insertedRange, storedMarks!.marks)
      : baseTx;
    commit(tx, { mergeTyping: tx.kind === "update-text", preserveStoredMarks: shouldApplyStoredMarks });
    if (shouldApplyStoredMarks) {
      setStoredMarks({ blockId: block.id, offset, marks: storedMarks!.marks });
    }
    if (isComposingRef.current || tx.kind === "markdown-shortcut") return;

    const beforeCursor = text.slice(0, offset);
    const slashMatch = /\/([\w-]*)$/.exec(beforeCursor);
    if (slashMatch) setBlockTypeMenu(null);
    setSlash((current) => {
      if (!slashMatch) return null;
      const query = slashMatch[1];
      if (current?.blockId === block.id && current.query === query) return current;
      return { blockId: block.id, query, activeIndex: 0 };
    });
  }

  function handlePaste(event: React.ClipboardEvent<HTMLElement>, block: EditorBlock) {
    if (readOnly) return;
    const text = event.clipboardData.getData("text/plain");
    const markdown = block.type === "code-block" ? text : clipboardDataToMarkdown(event.clipboardData);
    if (!markdown) return;

    event.preventDefault();
    const nextSelection = readTextSelection(event.currentTarget, block.id);
    const range = selectedRange(nextSelection);

    if (block.type === "code-block") {
      const currentText = event.currentTarget.textContent || "";
      commit(
        updateBlockText(
          history.document,
          block.id,
          `${currentText.slice(0, range.start)}${text}${currentText.slice(range.end)}`,
          range.start + text.length,
        ),
      );
      return;
    }

    const fragment = markdownToDocument(markdown, "Clipboard");
    commit(insertDocumentFragment(history.document, block.id, range.start, range.end, fragment));
  }

  function handleSelectionChange(element: HTMLElement, blockId: string) {
    const nextSelection = readTextSelection(element, blockId);
    const block = currentBlock(blockId);
    const editableMarkRange = editableMarkRangeAtSelection(block, nextSelection);
    setSelection(nextSelection);
    if (
      !isCollapsedSelection(nextSelection) ||
      storedMarksRef.current?.blockId !== nextSelection.anchor.blockId ||
      storedMarksRef.current.offset !== nextSelection.anchor.offset
    ) {
      clearStoredMarks();
    }
    setBubblePosition(readSelectionBubblePosition(element, blockId, Boolean(editableMarkRange)));
  }

  function handleBlockMouseDown(event: React.MouseEvent<HTMLElement>, block: EditorBlock) {
    if (readOnly || event.button !== 0) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return;
    if (
      target.closest(
        "button, input, textarea, select, a, .je-editable, .je-block__gutter, .je-slash-menu, .je-block-type-menu, .je-inline-toolbar, .je-link-popover",
      )
    ) {
      return;
    }
    setSelectedBlockId(block.id);
    setBubblePosition(null);
    setLinkPopover(null);
    setSlash(null);
    setBlockTypeMenu(null);
  }

  function handleEditableMouseDown(event: React.MouseEvent<HTMLElement>, block: EditorBlock) {
    if (readOnly || event.button !== 0) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest("a[data-je-link]")) {
      setSelectedBlockId(null);
      return;
    }

    const clickedText = isPointInsideTextContent(event.currentTarget, event.clientX, event.clientY);
    setSelectedBlockId(clickedText ? null : block.id);
    if (!clickedText) {
      setBubblePosition(null);
      setLinkPopover(null);
      setSlash(null);
      setBlockTypeMenu(null);
    }
  }

  function handleLinkClick(event: React.MouseEvent<HTMLElement>, block: EditorBlock) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const anchor = target?.closest("a[data-je-link]");
    if (!(anchor instanceof HTMLAnchorElement) || !event.currentTarget.contains(anchor)) {
      setLinkPopover(null);
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const href = anchor.getAttribute("href") || anchor.href;
    setSelectedBlockId(null);
    if (readOnly || event.metaKey || event.ctrlKey) {
      openHref(href);
      return;
    }

    const clickedRange = readElementTextRange(event.currentTarget, anchor);
    if (!clickedRange) return;
    const probeOffset = Math.max(clickedRange.start, Math.min(clickedRange.end, clickedRange.start + 1));
    const linkRange = markRangeAtOffset(block, probeOffset, "link") ?? {
      ...clickedRange,
      blockId: block.id,
    };
    const iconRange = markRangeAtOffset(block, probeOffset, "icon-link");
    const linkAttrs = selectedMarkAttrs(block, {
      anchor: { blockId: block.id, offset: linkRange.start },
      focus: { blockId: block.id, offset: linkRange.end },
    }, "link");
    const iconAttrs = selectedMarkAttrs(block, {
      anchor: { blockId: block.id, offset: linkRange.start },
      focus: { blockId: block.id, offset: linkRange.end },
    }, "icon-link");
    const box = anchor.getBoundingClientRect();
    setSelection({
      anchor: { blockId: block.id, offset: linkRange.start },
      focus: { blockId: block.id, offset: linkRange.end },
    });
    setBubblePosition(null);
    setBlockTypeMenu(null);
    setSlash(null);
    setLinkPopover({
      blockId: block.id,
      end: linkRange.end,
      href: linkAttrs?.href || href,
      icon: iconRange ? iconAttrs?.icon ?? "" : null,
      left: Math.min(Math.max(12, box.left), window.innerWidth - 300),
      start: linkRange.start,
      top: box.bottom + 8,
    });
  }

  function toggleSelectionMark(event: React.KeyboardEvent<HTMLElement>, block: EditorBlock, mark: EditorTextMarkType) {
    const nextSelection = readTextSelection(event.currentTarget, block.id);
    setSelectedBlockId(null);
    setSelection(nextSelection);
    if (nextSelection.anchor.blockId !== nextSelection.focus.blockId) return;
    event.preventDefault();
    if (nextSelection.anchor.offset === nextSelection.focus.offset) {
      setCollapsedStoredMarks(toggleStoredMark(collapsedMarksForSelection(nextSelection), mark), nextSelection);
      return;
    }
    commit(toggleTextMark(history.document, block.id, nextSelection.anchor.offset, nextSelection.focus.offset, mark));
  }

  function patchBlockAttrs(block: EditorBlock, attrs: Record<string, unknown>) {
    commit(setBlockAttrs(history.document, block.id, attrs, getBlockPlainText(block).length));
  }

  function patchBlockText(block: EditorBlock, text: string) {
    commit(updateBlockText(history.document, block.id, text, text.length));
  }

  function splitBlockForEnter(block: EditorBlock, offset: number): EditorTransaction {
    const splitTx = splitBlock(history.document, block.id, offset);
    if (!EXIT_TO_PARAGRAPH_ON_ENTER.has(block.type)) return splitTx;

    const splitIndex = splitTx.after.blocks.findIndex((item) => item.id === block.id);
    const nextBlock = splitIndex >= 0 ? splitTx.after.blocks[splitIndex + 1] : null;
    if (!nextBlock) return splitTx;

    const typeTx = setBlockType(splitTx.after, nextBlock.id, "paragraph", undefined, getBlockPlainText(nextBlock));
    return {
      ...typeTx,
      before: history.document,
      createdAt: splitTx.createdAt,
      id: splitTx.id,
      kind: splitTx.kind,
      selection: splitTx.selection,
    };
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>, block: EditorBlock) {
    if (readOnly) return;
    if (event.nativeEvent.isComposing || isComposingRef.current || event.key === "Process") return;
    setSelectedBlockId(null);

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redoHistory();
      else undoHistory();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redoHistory();
      return;
    }

    if (event.key === "Escape" && blockTypeMenu) {
      event.preventDefault();
      setBlockTypeMenu(null);
      return;
    }

    const shortcutMark = textMarkForShortcut(event, textMarkSpecs);
    if (shortcutMark) {
      event.preventDefault();
      toggleSelectionMark(event, block, shortcutMark);
      return;
    }

    if (slash) {
      const commands = getSlashCommands(slash.query);
      if (event.key === "Escape") {
        event.preventDefault();
        setSlash(null);
        setBlockTypeMenu(null);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (commands.length === 0) return;
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setSlash({
          ...slash,
          activeIndex: (slash.activeIndex + direction + commands.length) % commands.length,
        });
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        if (commands.length === 0) return;
        setSlash({ ...slash, activeIndex: event.key === "Home" ? 0 : commands.length - 1 });
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const command = commands[slash.activeIndex] || commands[0];
        if (command) selectCommand(command, slash.blockId);
        return;
      }
    }

    const currentSelection = readTextSelection(event.currentTarget, block.id);

    if (event.key === "ArrowUp" && isSelectionAtStart(currentSelection, block)) {
      const index = history.document.blocks.findIndex((item) => item.id === block.id);
      const previous = history.document.blocks[index - 1];
      if (previous && !STRUCTURED_BLOCK_TYPES.has(previous.type) && previous.type !== "divider") {
        event.preventDefault();
        const nextSelection = createCollapsedSelection(previous.id, blockTextLength(previous));
        setSelectionAndFocus(nextSelection);
      }
      return;
    }

    if (event.key === "ArrowDown" && isSelectionAtEnd(currentSelection, block)) {
      const index = history.document.blocks.findIndex((item) => item.id === block.id);
      const next = history.document.blocks[index + 1];
      if (next && !STRUCTURED_BLOCK_TYPES.has(next.type) && next.type !== "divider") {
        event.preventDefault();
        const nextSelection = createCollapsedSelection(next.id, 0);
        setSelectionAndFocus(nextSelection);
      }
      return;
    }

    if (event.key === "ArrowLeft" && isSelectionAtStart(currentSelection, block)) {
      const index = history.document.blocks.findIndex((item) => item.id === block.id);
      const previous = history.document.blocks[index - 1];
      if (previous && !STRUCTURED_BLOCK_TYPES.has(previous.type) && previous.type !== "divider") {
        event.preventDefault();
        const nextSelection = createCollapsedSelection(previous.id, blockTextLength(previous));
        setSelectionAndFocus(nextSelection);
      }
      return;
    }

    if (event.key === "ArrowRight" && isSelectionAtEnd(currentSelection, block)) {
      const index = history.document.blocks.findIndex((item) => item.id === block.id);
      const next = history.document.blocks[index + 1];
      if (next && !STRUCTURED_BLOCK_TYPES.has(next.type) && next.type !== "divider") {
        event.preventDefault();
        const nextSelection = createCollapsedSelection(next.id, 0);
        setSelectionAndFocus(nextSelection);
      }
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      const direction = event.shiftKey ? -1 : 1;
      commit(setBlockIndent(history.document, block.id, (block.indent || 0) + direction, readTextOffset(event.currentTarget)));
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && block.type === "todo") {
      event.preventDefault();
      commit(toggleTodo(history.document, block.id));
      return;
    }

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && block.type === "code-block") {
      event.preventDefault();
      commit(insertBlockAfter(history.document, block.id, createBlock({ type: "paragraph" })));
      return;
    }

    if (event.key === "Enter" && block.type === "code-block" && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      const nextSelection = readTextSelection(event.currentTarget, block.id);
      const startOffset = Math.min(nextSelection.anchor.offset, nextSelection.focus.offset);
      const endOffset = Math.max(nextSelection.anchor.offset, nextSelection.focus.offset);
      const text = event.currentTarget.textContent || "";
      const insertText = endOffset === text.length ? "\n\n" : "\n";
      commit(
        updateBlockText(
          history.document,
          block.id,
          `${text.slice(0, startOffset)}${insertText}${text.slice(endOffset)}`,
          startOffset + 1,
        ),
      );
      setSlash(null);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const text = getBlockPlainText(block);
      if (!text.trim() && block.type !== "paragraph") {
        commit(setBlockType(history.document, block.id, "paragraph", undefined, ""));
        return;
      }
      const element = event.currentTarget;
      const offset = readTextOffset(element);
      commit(splitBlockForEnter(block, offset));
      return;
    }

    if (event.key === "Backspace" && isSelectionAtStart(currentSelection, block)) {
      event.preventDefault();
      const text = getBlockPlainText(block);
      if ((block.indent || 0) > 0) {
        commit(setBlockIndent(history.document, block.id, (block.indent || 0) - 1, 0));
        return;
      }
      if (block.type !== "paragraph") {
        commit(setBlockType(history.document, block.id, "paragraph", undefined, text));
        return;
      }
      const index = history.document.blocks.findIndex((item) => item.id === block.id);
      if (index === 0) return;
      if (!text && history.document.blocks[index - 1]?.type === "divider") {
        commit(deleteBlock(history.document, block.id));
        return;
      }
      commit(mergeWithPrevious(history.document, block.id));
    }
  }

  function handleDragStart(event: React.DragEvent, block: EditorBlock) {
    event.dataTransfer.setData("application/x-jinnkunn-editor-block", block.id);
    event.dataTransfer.effectAllowed = "move";
    didDragRef.current = true;
    setDragState({ blockId: block.id, overBlockId: block.id, placement: "before" });
  }

  function moveBlockTo(blockId: string, targetIndex: number, placement: DragState["placement"]) {
    const fromIndex = history.document.blocks.findIndex((block) => block.id === blockId);
    if (fromIndex < 0) return;
    let insertionIndex = targetIndex + (placement === "after" ? 1 : 0);
    if (fromIndex < insertionIndex) insertionIndex -= 1;
    if (fromIndex === insertionIndex) return;
    commit(moveBlock(history.document, blockId, insertionIndex));
  }

  function handleDragOver(event: React.DragEvent, block: EditorBlock) {
    const blockId = event.dataTransfer.getData("application/x-jinnkunn-editor-block") || dragState?.blockId;
    if (!blockId || blockId === block.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    setDragState((current) => {
      if (current?.blockId === blockId && current.overBlockId === block.id && current.placement === placement) return current;
      return { blockId, overBlockId: block.id, placement };
    });
  }

  function handleDrop(event: React.DragEvent, targetIndex: number, targetBlock: EditorBlock) {
    const blockId = event.dataTransfer.getData("application/x-jinnkunn-editor-block");
    if (!blockId) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    moveBlockTo(blockId, targetIndex, blockId === targetBlock.id ? "before" : placement);
    setDragState(null);
  }

  function handleDragEnd() {
    setDragState(null);
    window.setTimeout(() => {
      didDragRef.current = false;
    }, 0);
  }

  const focusedBlockId = selection ? getSelectionFocus(selection).blockId : null;

  return (
    <section className="je-editor" data-readonly={readOnly ? "true" : "false"}>
      <input
        className="je-title"
        value={history.document.title}
        readOnly={readOnly}
        aria-label="Document title"
        onChange={(event) => {
          const next = { ...history.document, title: event.target.value };
          setHistory((current) => ({ ...current, document: next }));
          onChange?.(next);
        }}
        onFocus={() => {
          setSelection(null);
          setSlash(null);
          setBubblePosition(null);
          setBlockTypeMenu(null);
          setLinkPopover(null);
          setSelectedBlockId(null);
        }}
      />
      <div className="je-blocks" role="list">
        {history.document.blocks.map((block, index) => {
          const text = getBlockPlainText(block);
          const isFocused = focusedBlockId === block.id;
          const isSelected = selectedBlockId === block.id;
          const dropPosition = dragState?.overBlockId === block.id ? dragState.placement : undefined;
          const currentSlashSections = slash?.blockId === block.id ? getSlashSections(slash.query) : [];
          const controlsOpen = blockTypeMenu?.blockId === block.id || slash?.blockId === block.id || isSelected;
          return (
            <div
              className={blockClassName(block)}
              data-block-id={block.id}
              data-dragging={dragState?.blockId === block.id ? "true" : undefined}
              data-drop-position={dropPosition}
              data-indent={block.indent || undefined}
              data-heading-level={block.type === "heading" ? block.level : undefined}
              data-focused={isFocused ? "true" : "false"}
              data-selected={isSelected ? "true" : "false"}
              data-controls-open={controlsOpen ? "true" : "false"}
              key={block.id}
              role="listitem"
              onMouseDown={(event) => handleBlockMouseDown(event, block)}
              onDragLeave={(event) => {
                const relatedTarget = event.relatedTarget;
                if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) {
                  setDragState((current) => current && current.overBlockId === block.id ? { ...current, overBlockId: null } : current);
                }
              }}
              onDragOver={(event) => handleDragOver(event, block)}
              onDrop={(event) => handleDrop(event, index, block)}
            >
              <div className="je-block__gutter">
                <button
                  aria-label="Add block below"
                  className="je-block__button"
                  disabled={readOnly}
                  type="button"
                  onClick={() => commit(insertBlockAfter(history.document, block.id))}
                >
                  +
                </button>
                <button
                  aria-expanded={blockTypeMenu?.blockId === block.id}
                  aria-label="Block actions"
                  className="je-block__handle"
                  draggable={!readOnly}
                  disabled={readOnly}
                  type="button"
                  onClick={() => {
                    if (didDragRef.current) {
                      didDragRef.current = false;
                      return;
                    }
                    setSlash(null);
                    setBubblePosition(null);
                    setLinkPopover(null);
                    setBlockTypeMenu((current) => (current?.blockId === block.id ? null : { blockId: block.id }));
                  }}
                  onDragEnd={handleDragEnd}
                  onDragStart={(event) => handleDragStart(event, block)}
                >
                  ⋮⋮
                </button>
              </div>
              {block.type === "todo" ? (
                <button
                  className="je-todo-check"
                  type="button"
                  aria-pressed={Boolean(block.checked)}
                  disabled={readOnly}
                  onClick={() => commit(toggleTodo(history.document, block.id))}
                />
              ) : null}
              {block.type === "divider" ? (
                <hr className="je-divider" />
              ) : STRUCTURED_BLOCK_TYPES.has(block.type) ? (
                <StructuredBlockEditor
                  block={block}
                  onAttrs={(attrs) => patchBlockAttrs(block, attrs)}
                  onText={(nextText) => patchBlockText(block, nextText)}
                />
              ) : (
                <div
                  className="je-editable"
                  contentEditable={!readOnly}
                  data-placeholder={blockPlaceholder(block, blockSpecs, isFocused)}
                  suppressContentEditableWarning
                  ref={(node) => {
                    if (node) blockRefs.current.set(block.id, node);
                    else blockRefs.current.delete(block.id);
                  }}
                  onFocus={(event) => {
                    handleSelectionChange(event.currentTarget, block.id);
                  }}
                  onKeyUp={(event) => {
                    handleSelectionChange(event.currentTarget, block.id);
                  }}
                  onMouseUp={(event) => {
                    handleSelectionChange(event.currentTarget, block.id);
                  }}
                  onMouseDown={(event) => handleEditableMouseDown(event, currentBlock(block.id) || block)}
                  onClick={(event) => handleLinkClick(event, currentBlock(block.id) || block)}
                  onInput={(event) => {
                    if (isComposingRef.current || event.nativeEvent.isComposing) return;
                    const offset = readTextOffset(event.currentTarget);
                    handleText(block, event.currentTarget.textContent || "", offset);
                  }}
                  onPaste={(event) => handlePaste(event, currentBlock(block.id) || block)}
                  onCompositionStart={() => {
                    isComposingRef.current = true;
                    setSlash(null);
                  }}
                  onCompositionEnd={(event) => {
                    isComposingRef.current = false;
                    const offset = readTextOffset(event.currentTarget);
                    handleText(block, event.currentTarget.textContent || "", offset);
                  }}
                  onKeyDown={(event) => handleKeyDown(event, currentBlock(block.id) || block)}
                />
              )}
              {slash?.blockId === block.id ? (
                <SlashMenu
                  slash={slash}
                  sections={currentSlashSections}
                  onSelect={selectCommand}
                  onActiveIndexChange={(activeIndex) => setSlash({ ...slash, activeIndex })}
                />
              ) : null}
              {blockTypeMenu?.blockId === block.id ? (
                <BlockTypeMenu
                  activeBlock={block}
                  canMoveDown={index < history.document.blocks.length - 1}
                  canMoveUp={index > 0}
                  onDelete={() => deleteCurrentBlock(block)}
                  onDuplicate={() => duplicateBlock(block)}
                  onMoveDown={() => moveCurrentBlock(block, 1)}
                  onMoveUp={() => moveCurrentBlock(block, -1)}
                  specs={blockSpecs}
                  onSelect={(spec) => selectBlockType(block, spec)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      {!readOnly && bubblePosition && isSameBlockSelection(selection) ? (
        <InlineToolbar
          activeBlock={currentBlock(bubblePosition.blockId)}
          blockSpecs={blockSpecs}
          position={bubblePosition}
          selection={selection}
          specs={textMarkSpecs}
          onApplyLink={applyStoredLink}
          onSetBlockType={selectBlockType}
          onSet={setStoredSelectionMark}
          storedMarks={
            storedMarksState &&
            isCollapsedSelection(selection) &&
            storedMarksState.blockId === selection.anchor.blockId &&
            storedMarksState.offset === selection.anchor.offset
              ? storedMarksState.marks
              : null
          }
          onToggle={toggleStoredSelectionMark}
          onUnset={unsetStoredSelectionMark}
        />
      ) : null}
      {!readOnly && linkPopover ? (
        <LinkPopover
          link={linkPopover}
          onApply={(href, icon) => applyLinkRange(linkPopover, href, icon)}
          onClose={() => setLinkPopover(null)}
          onOpen={openHref}
          onRemove={() => applyLinkRange(linkPopover, "", null)}
        />
      ) : null}
    </section>
  );
});
