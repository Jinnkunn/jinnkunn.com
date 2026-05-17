import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  applyMarkdownShortcut,
  applyTransaction,
  clampSelection,
  createBlock,
  createCollapsedSelection,
  createDocument,
  createDefaultEditorExtensionManifest,
  createEditorHistory,
  deleteBlock,
  getSelectionFocus,
  getBlockPlainText,
  insertBlockAfter,
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
  type EditorBlock,
  type EditorBlockExtensionSpec,
  type EditorDocument,
  type EditorExtensionManifest,
  type EditorSelection,
  type EditorTextMark,
  type EditorTextMarkAttrs,
  type EditorTextMarkType,
  type EditorTextMarkExtensionSpec,
  type EditorTextSpan,
  type EditorTransaction,
} from "../../editor-core/src/index.ts";

export type BlockEditorProps = {
  extensionManifests?: EditorExtensionManifest[];
  initialDocument?: EditorDocument;
  readOnly?: boolean;
  onChange?: (document: EditorDocument, transaction: EditorTransaction) => void;
};

type SlashState = {
  blockId: string;
  query: string;
  activeIndex: number;
};

type BubblePosition = {
  blockId: string;
  left: number;
  top: number;
};

type BlockTypeMenuState = {
  blockId: string;
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

const STRUCTURED_BLOCK_TYPES = new Set<EditorBlock["type"]>([
  "image",
  "bookmark",
  "embed",
  "file",
  "page-link",
]);

const TOGGLE_MARK_LABELS: Record<string, string> = {
  bold: "B",
  italic: "I",
  underline: "U",
  code: "<>",
  strikethrough: "S",
  highlight: "H",
};

const GROUP_LABELS: Record<EditorBlockExtensionSpec["group"], string> = {
  advanced: "Advanced",
  basic: "Basic",
  embed: "Embed",
  format: "Format",
  media: "Media",
  navigation: "Navigation",
};

function blockPlaceholder(block: EditorBlock, blockSpecs: EditorBlockExtensionSpec[]): string {
  const spec = blockSpecs.find((candidate) => {
    if (candidate.blockType !== block.type) return false;
    if (candidate.blockType !== "heading") return true;
    return candidate.level === (block.level || 1);
  });
  return spec?.placeholder || "Type '/' for commands";
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

function readSelectionBubblePosition(element: HTMLElement, blockId: string): BubblePosition | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  if (!element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) return null;

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  const fallback = range.getClientRects()[0];
  const box = rect.width > 0 || rect.height > 0 ? rect : fallback;
  if (!box) return null;

  return {
    blockId,
    left: box.left + box.width / 2,
    top: Math.max(8, box.top - 8),
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

function blockMatchesSpec(block: EditorBlock, spec: EditorBlockExtensionSpec): boolean {
  if (block.type !== spec.blockType) return false;
  if (block.type !== "heading") return true;
  return (block.level || 1) === spec.level;
}

function selectionHasMark(block: EditorBlock | null, selection: EditorSelection | null, mark: EditorTextMarkType): boolean {
  if (!block || !isSameBlockSelection(selection)) return false;
  const range = selectedRange(selection);
  if (range.start === range.end) return false;

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
  let cursor = 0;
  for (const span of block.text) {
    const spanStart = cursor;
    const spanEnd = cursor + span.text.length;
    cursor = spanEnd;
    if (spanEnd <= range.start || spanStart >= range.end) continue;
    return markAttrs(span.marks, mark);
  }
  return null;
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
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [command.name, command.label, command.description, command.group, command.blockType]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalized));
}

function slashSections(
  commands: EditorBlockExtensionSpec[],
  query: string,
  recentCommandNames: string[],
): SlashSection[] {
  const available = commands.filter((command) => command.slashMenu && commandMatchesQuery(command, query));
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

  return sections;
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

function InlineToolbar({
  activeBlock,
  position,
  selection,
  specs,
  onSet,
  onToggle,
  onUnset,
}: {
  activeBlock: EditorBlock | null;
  position: BubblePosition;
  selection: EditorSelection | null;
  specs: EditorTextMarkExtensionSpec[];
  onSet: (mark: EditorTextMarkType, attrs?: EditorTextMarkAttrs) => void;
  onToggle: (mark: EditorTextMarkType) => void;
  onUnset: (mark: EditorTextMarkType) => void;
}) {
  const [panel, setPanel] = useState<null | { mark: EditorTextMarkExtensionSpec }>(null);
  const linkAttrs = selectedMarkAttrs(activeBlock, selection, "link");
  const iconAttrs = selectedMarkAttrs(activeBlock, selection, "icon-link");
  const [href, setHref] = useState(linkAttrs?.href ?? "");
  const [icon, setIcon] = useState(iconAttrs?.icon ?? "");

  useEffect(() => {
    setHref(linkAttrs?.href ?? "");
    setIcon(iconAttrs?.icon ?? "");
  }, [linkAttrs?.href, iconAttrs?.icon, selection?.anchor.offset, selection?.focus.offset]);

  const applyLink = (iconMode: boolean) => {
    const nextHref = href.trim();
    if (!nextHref) {
      onUnset("link");
      onUnset("icon-link");
      setPanel(null);
      return;
    }
    onSet("link", { href: nextHref });
    if (iconMode) {
      onSet("icon-link", icon.trim() ? { icon: icon.trim() } : {});
    } else {
      onUnset("icon-link");
    }
    setPanel(null);
  };

  return (
    <div
      className="je-inline-toolbar"
      role="toolbar"
      aria-label="Inline text styles"
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
      }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {specs.map((spec) => {
        if (spec.kind === "toggle") {
          return (
            <button
              aria-label={spec.label}
              aria-pressed={selectionHasMark(activeBlock, selection, spec.mark)}
              className="je-inline-toolbar__button"
              key={spec.mark}
              title={`${spec.label}${spec.shortcut ? ` (${spec.shortcut})` : ""}`}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                onToggle(spec.mark);
              }}
            >
              {TOGGLE_MARK_LABELS[spec.mark] || spec.label.slice(0, 1)}
            </button>
          );
        }
        if (spec.kind === "link" || spec.kind === "icon-link") {
          return (
            <button
              aria-label={spec.label}
              aria-pressed={selectionHasMark(activeBlock, selection, spec.mark)}
              className="je-inline-toolbar__button"
              key={spec.mark}
              title={spec.label}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                setPanel((current) => current?.mark.mark === spec.mark ? null : { mark: spec });
              }}
            >
              {spec.kind === "icon-link" ? "->" : "Link"}
            </button>
          );
        }
        return (
          <button
            aria-label={spec.label}
            aria-pressed={selectionHasMark(activeBlock, selection, spec.mark)}
            className="je-inline-toolbar__button"
            key={spec.mark}
            title={spec.label}
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              setPanel((current) => current?.mark.mark === spec.mark ? null : { mark: spec });
            }}
          >
            {spec.mark === "text-color" ? "A" : "BG"}
          </button>
        );
      })}
      {panel?.mark.kind === "link" || panel?.mark.kind === "icon-link" ? (
        <div className="je-inline-popover" role="dialog" aria-label={panel.mark.label}>
          <label>
            <span>URL</span>
            <input value={href} placeholder="https:// or /page" onChange={(event) => setHref(event.target.value)} />
          </label>
          {panel.mark.kind === "icon-link" ? (
            <label>
              <span>Icon URL</span>
              <input value={icon} placeholder="/icon.svg" onChange={(event) => setIcon(event.target.value)} />
            </label>
          ) : null}
          <div className="je-inline-popover__actions">
            <button type="button" onClick={() => applyLink(panel.mark.kind === "icon-link")}>Apply</button>
            <button
              type="button"
              onClick={() => {
                onUnset("link");
                onUnset("icon-link");
                setPanel(null);
              }}
            >
              Clear
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

function BlockTypeMenu({
  activeBlock,
  specs,
  onSelect,
}: {
  activeBlock: EditorBlock;
  specs: EditorBlockExtensionSpec[];
  onSelect: (spec: EditorBlockExtensionSpec) => void;
}) {
  return (
    <div className="je-block-type-menu" role="listbox" aria-label="Block types">
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
  const text = getBlockPlainText(block);

  if (block.type === "image") {
    const url = blockAttrString(block, "url");
    const alt = blockAttrString(block, "alt");
    return (
      <div className="je-structured-block je-structured-block--image">
        {url ? <img src={url} alt={alt || text} /> : <div className="je-structured-block__empty">Image</div>}
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
    );
  }

  if (block.type === "bookmark" || block.type === "embed" || block.type === "file" || block.type === "page-link") {
    const urlKey = block.type === "file" ? "url" : block.type === "page-link" ? "href" : "url";
    const titleLabel = block.type === "file" ? "Name" : block.type === "page-link" ? "Page" : "Title";
    const urlLabel = block.type === "page-link" ? "Href" : "URL";
    return (
      <div className={`je-structured-block je-structured-block--${block.type}`}>
        <div className="je-structured-block__badge">{block.type}</div>
        <label>
          <span>{titleLabel}</span>
          <input value={text} placeholder={titleLabel} onChange={(event) => onText(event.target.value)} />
        </label>
        <label>
          <span>{urlLabel}</span>
          <input
            value={blockAttrString(block, urlKey)}
            placeholder={block.type === "page-link" ? "/page" : "https://"}
            onChange={(event) => onAttrs({ [urlKey]: event.target.value })}
          />
        </label>
      </div>
    );
  }

  return null;
}

export function BlockEditor({ extensionManifests, initialDocument, readOnly = false, onChange }: BlockEditorProps) {
  const initial = useMemo(() => createEditorHistory(initialDocument || createDocument()), [initialDocument]);
  const [history, setHistory] = useState(initial);
  const [selection, setSelection] = useState<EditorSelection | null>(() => {
    const first = initial.document.blocks[0];
    return first ? createCollapsedSelection(first.id, 0) : null;
  });
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [bubblePosition, setBubblePosition] = useState<BubblePosition | null>(null);
  const [blockTypeMenu, setBlockTypeMenu] = useState<BlockTypeMenuState | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [recentCommandNames, setRecentCommandNames] = useState<string[]>([]);
  const blockRefs = useRef(new Map<string, HTMLElement>());
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

  useEffect(() => {
    setHistory(initial);
    const first = initial.document.blocks[0];
    setSelection(first ? createCollapsedSelection(first.id, 0) : null);
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
    for (const block of history.document.blocks) {
      const target = blockRefs.current.get(block.id);
      if (target && block.type !== "divider") syncEditableDom(target, block);
    }
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    focusSelection(pending);
  }, [history.document]);

  function commit(transaction: EditorTransaction) {
    const nextSelection = transaction.selection
      ? clampSelection(transaction.after, transaction.selection)
      : selection;
    pendingFocusRef.current = nextSelection;
    setHistory((current) => applyTransaction(current, transaction));
    setSelection(nextSelection);
    setSlash(null);
    setBubblePosition(null);
    setBlockTypeMenu(null);
    setDragState(null);
    onChange?.(transaction.after, transaction);
  }

  function currentBlock(blockId: string) {
    return history.document.blocks.find((block) => block.id === blockId) || null;
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

  function selectedTextRange() {
    if (!isSameBlockSelection(selection)) return;
    const range = selectedRange(selection);
    if (range.start === range.end) return;
    return range;
  }

  function toggleStoredSelectionMark(mark: EditorTextMarkType) {
    const range = selectedTextRange();
    if (!range) return;
    commit(toggleTextMark(history.document, range.blockId, selection!.anchor.offset, selection!.focus.offset, mark));
  }

  function setStoredSelectionMark(mark: EditorTextMarkType, attrs: EditorTextMarkAttrs = {}) {
    const range = selectedTextRange();
    if (!range) return;
    commit(setTextMark(history.document, range.blockId, selection!.anchor.offset, selection!.focus.offset, mark, attrs));
  }

  function unsetStoredSelectionMark(mark: EditorTextMarkType) {
    const range = selectedTextRange();
    if (!range) return;
    commit(unsetTextMark(history.document, range.blockId, selection!.anchor.offset, selection!.focus.offset, mark));
  }

  function handleText(block: EditorBlock, text: string, offset: number) {
    const tx = updateBlockText(history.document, block.id, text, offset);
    const updatedBlock = tx.after.blocks.find((item) => item.id === block.id);
    commit(tx);
    if (isComposingRef.current) return;

    if (updatedBlock) {
      const converted = applyMarkdownShortcut(updatedBlock);
      if (converted.type !== updatedBlock.type || converted.level !== updatedBlock.level) {
        commit(setBlockType(tx.after, updatedBlock.id, converted.type, converted.level, getBlockPlainText(converted)));
        return;
      }
    }

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

  function handleSelectionChange(element: HTMLElement, blockId: string) {
    const nextSelection = readTextSelection(element, blockId);
    setSelection(nextSelection);
    setBubblePosition(readSelectionBubblePosition(element, blockId));
  }

  function toggleSelectionMark(event: React.KeyboardEvent<HTMLElement>, block: EditorBlock, mark: EditorTextMarkType) {
    const nextSelection = readTextSelection(event.currentTarget, block.id);
    setSelection(nextSelection);
    if (nextSelection.anchor.blockId !== nextSelection.focus.blockId) return;
    if (nextSelection.anchor.offset === nextSelection.focus.offset) return;
    event.preventDefault();
    commit(toggleTextMark(history.document, block.id, nextSelection.anchor.offset, nextSelection.focus.offset, mark));
  }

  function patchBlockAttrs(block: EditorBlock, attrs: Record<string, unknown>) {
    commit(setBlockAttrs(history.document, block.id, attrs, getBlockPlainText(block).length));
  }

  function patchBlockText(block: EditorBlock, text: string) {
    commit(updateBlockText(history.document, block.id, text, text.length));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>, block: EditorBlock) {
    if (readOnly) return;
    if (event.nativeEvent.isComposing || isComposingRef.current || event.key === "Process") return;

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      const nextHistory = event.shiftKey ? redo(history) : undo(history);
      const focusBlock = nextHistory.document.blocks[0];
      const nextSelection = focusBlock
        ? createCollapsedSelection(focusBlock.id, getBlockPlainText(focusBlock).length)
        : null;
      pendingFocusRef.current = nextSelection;
      setHistory(nextHistory);
      setSelection(nextSelection);
      setSlash(null);
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      const nextHistory = redo(history);
      const focusBlock = nextHistory.document.blocks[0];
      const nextSelection = focusBlock
        ? createCollapsedSelection(focusBlock.id, getBlockPlainText(focusBlock).length)
        : null;
      pendingFocusRef.current = nextSelection;
      setHistory(nextHistory);
      setSelection(nextSelection);
      setSlash(null);
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
      if (event.key === "Enter") {
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
      commit(splitBlock(history.document, block.id, offset));
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
        }}
        onFocus={() => {
          setSelection(null);
          setSlash(null);
          setBubblePosition(null);
          setBlockTypeMenu(null);
        }}
      />
      <div className="je-blocks" role="list">
        {history.document.blocks.map((block, index) => {
          const text = getBlockPlainText(block);
          const isFocused = focusedBlockId === block.id;
          const dropPosition = dragState?.overBlockId === block.id ? dragState.placement : undefined;
          const currentSlashSections = slash?.blockId === block.id ? getSlashSections(slash.query) : [];
          return (
            <div
              className={blockClassName(block)}
              data-block-id={block.id}
              data-dragging={dragState?.blockId === block.id ? "true" : undefined}
              data-drop-position={dropPosition}
              data-indent={block.indent || undefined}
              data-focused={isFocused ? "true" : "false"}
              key={block.id}
              role="listitem"
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
                  aria-label="Change block type"
                  className="je-block__button je-block__type-button"
                  disabled={readOnly}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setSlash(null);
                    setBubblePosition(null);
                    setBlockTypeMenu((current) => (current?.blockId === block.id ? null : { blockId: block.id }));
                  }}
                >
                  {blockSpecs.find((spec) => blockMatchesSpec(block, spec))?.icon || "T"}
                </button>
                <button
                  aria-label="Drag block"
                  className="je-block__handle"
                  draggable={!readOnly}
                  type="button"
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
                  data-placeholder={blockPlaceholder(block, blockSpecs)}
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
                  onInput={(event) => {
                    const offset = readTextOffset(event.currentTarget);
                    handleText(block, event.currentTarget.textContent || "", offset);
                  }}
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
          position={bubblePosition}
          selection={selection}
          specs={textMarkSpecs}
          onSet={setStoredSelectionMark}
          onToggle={toggleStoredSelectionMark}
          onUnset={unsetStoredSelectionMark}
        />
      ) : null}
    </section>
  );
}
