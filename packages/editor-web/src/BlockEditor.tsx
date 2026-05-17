import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  applyMarkdownShortcut,
  applyTransaction,
  clampSelection,
  createBlock,
  createCollapsedSelection,
  createDocument,
  createEditorHistory,
  findEditorCommand,
  getSelectionFocus,
  getBlockPlainText,
  insertBlockAfter,
  listBlockSpecs,
  listTextMarkSpecs,
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
  type EditorBlock,
  type EditorBlockSpec,
  type EditorCommand,
  type EditorDocument,
  type EditorSelection,
  type EditorTextMark,
  type EditorTextMarkSpec,
  type EditorTextSpan,
  type EditorTransaction,
} from "../../editor-core/src/index.ts";

export type BlockEditorProps = {
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

function blockPlaceholder(block: EditorBlock, blockSpecs: EditorBlockSpec[]): string {
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

function applyMarksToNode(text: string, marks: EditorTextMark[] | undefined): Node {
  let node: Node = document.createTextNode(text);
  if (marks?.includes("code")) {
    const code = document.createElement("code");
    code.append(node);
    node = code;
  }
  if (marks?.includes("bold")) {
    const strong = document.createElement("strong");
    strong.append(node);
    node = strong;
  }
  if (marks?.includes("italic")) {
    const em = document.createElement("em");
    em.append(node);
    node = em;
  }
  if (marks?.includes("underline")) {
    const underline = document.createElement("u");
    underline.append(node);
    node = underline;
  }
  if (marks?.includes("strikethrough")) {
    const strike = document.createElement("s");
    strike.append(node);
    node = strike;
  }
  if (marks?.includes("highlight")) {
    const highlight = document.createElement("mark");
    highlight.append(node);
    node = highlight;
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
  textMarkSpecs: EditorTextMarkSpec[],
): EditorTextMark | null {
  return textMarkSpecs.find((spec) => shortcutMatches(event, spec.shortcut))?.mark || null;
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

function blockMatchesSpec(block: EditorBlock, spec: EditorBlockSpec): boolean {
  if (block.type !== spec.blockType) return false;
  if (block.type !== "heading") return true;
  return (block.level || 1) === spec.level;
}

function selectionHasMark(block: EditorBlock | null, selection: EditorSelection | null, mark: EditorTextMark): boolean {
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
    if (!span.marks?.includes(mark)) return false;
  }
  return touched;
}

function syncEditableDom(element: HTMLElement, block: EditorBlock) {
  const fragment = document.createDocumentFragment();
  for (const span of block.text) {
    fragment.append(applyMarksToNode(span.text, span.marks));
  }
  element.replaceChildren(fragment);
}

function SlashMenu({
  slash,
  onSelect,
  onActiveIndexChange,
}: {
  slash: SlashState;
  onSelect: (command: EditorCommand) => void;
  onActiveIndexChange: (index: number) => void;
}) {
  const commands = findEditorCommand(slash.query);
  return (
    <div className="je-slash-menu" role="listbox" aria-label="Block commands">
      <div className="je-slash-menu__label">Commands</div>
      {commands.length === 0 ? <div className="je-slash-menu__empty">No commands</div> : null}
      {commands.map((command, index) => (
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
      ))}
    </div>
  );
}

function InlineToolbar({
  activeBlock,
  position,
  selection,
  specs,
  onToggle,
}: {
  activeBlock: EditorBlock | null;
  position: BubblePosition;
  selection: EditorSelection | null;
  specs: EditorTextMarkSpec[];
  onToggle: (mark: EditorTextMark) => void;
}) {
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
      {specs.map((spec) => (
        <button
          aria-label={spec.label}
          aria-pressed={selectionHasMark(activeBlock, selection, spec.mark)}
          className="je-inline-toolbar__button"
          key={spec.mark}
          title={`${spec.label} (${spec.shortcut})`}
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            onToggle(spec.mark);
          }}
        >
          {spec.label.slice(0, 1)}
        </button>
      ))}
    </div>
  );
}

function BlockTypeMenu({
  activeBlock,
  specs,
  onSelect,
}: {
  activeBlock: EditorBlock;
  specs: EditorBlockSpec[];
  onSelect: (spec: EditorBlockSpec) => void;
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

export function BlockEditor({ initialDocument, readOnly = false, onChange }: BlockEditorProps) {
  const initial = useMemo(() => createEditorHistory(initialDocument || createDocument()), [initialDocument]);
  const [history, setHistory] = useState(initial);
  const [selection, setSelection] = useState<EditorSelection | null>(() => {
    const first = initial.document.blocks[0];
    return first ? createCollapsedSelection(first.id, 0) : null;
  });
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [bubblePosition, setBubblePosition] = useState<BubblePosition | null>(null);
  const [blockTypeMenu, setBlockTypeMenu] = useState<BlockTypeMenuState | null>(null);
  const blockRefs = useRef(new Map<string, HTMLElement>());
  const pendingFocusRef = useRef<EditorSelection | null>(null);
  const isComposingRef = useRef(false);
  const blockSpecs = useMemo(() => listBlockSpecs(), []);
  const textMarkSpecs = useMemo(() => listTextMarkSpecs(), []);

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
    onChange?.(transaction.after, transaction);
  }

  function currentBlock(blockId: string) {
    return history.document.blocks.find((block) => block.id === blockId) || null;
  }

  function selectCommand(command: EditorCommand, blockId = slash?.blockId) {
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

    commit(setBlockType(history.document, blockId, command.blockType, command.level, nextText));
  }

  function selectBlockType(block: EditorBlock, spec: EditorBlockSpec) {
    const text = block.type === "divider" ? undefined : getBlockPlainText(block);
    commit(setBlockType(history.document, block.id, spec.blockType, spec.level, text));
  }

  function toggleStoredSelectionMark(mark: EditorTextMark) {
    if (!isSameBlockSelection(selection)) return;
    const range = selectedRange(selection);
    if (range.start === range.end) return;
    commit(toggleTextMark(history.document, range.blockId, selection.anchor.offset, selection.focus.offset, mark));
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

  function toggleSelectionMark(event: React.KeyboardEvent<HTMLElement>, block: EditorBlock, mark: EditorTextMark) {
    const nextSelection = readTextSelection(event.currentTarget, block.id);
    setSelection(nextSelection);
    if (nextSelection.anchor.blockId !== nextSelection.focus.blockId) return;
    if (nextSelection.anchor.offset === nextSelection.focus.offset) return;
    event.preventDefault();
    commit(toggleTextMark(history.document, block.id, nextSelection.anchor.offset, nextSelection.focus.offset, mark));
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
      const commands = findEditorCommand(slash.query);
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
      const element = event.currentTarget;
      const offset = readTextOffset(element);
      commit(splitBlock(history.document, block.id, offset));
      return;
    }

    if (event.key === "Backspace" && readTextOffset(event.currentTarget) === 0) {
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
      commit(mergeWithPrevious(history.document, block.id));
    }
  }

  function handleDragStart(event: React.DragEvent, block: EditorBlock) {
    event.dataTransfer.setData("application/x-jinnkunn-editor-block", block.id);
    event.dataTransfer.effectAllowed = "move";
  }

  function handleDrop(event: React.DragEvent, targetIndex: number) {
    const blockId = event.dataTransfer.getData("application/x-jinnkunn-editor-block");
    if (!blockId) return;
    event.preventDefault();
    commit(moveBlock(history.document, blockId, targetIndex));
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
          return (
            <div
              className={blockClassName(block)}
              data-indent={block.indent || undefined}
              data-focused={isFocused ? "true" : "false"}
              key={block.id}
              role="listitem"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDrop(event, index)}
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
          onToggle={toggleStoredSelectionMark}
        />
      ) : null}
    </section>
  );
}
