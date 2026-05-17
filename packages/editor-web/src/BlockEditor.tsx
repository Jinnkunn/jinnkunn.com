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
  mergeWithPrevious,
  moveBlock,
  redo,
  setBlockIndent,
  setBlockType,
  splitBlock,
  toggleTodo,
  undo,
  updateBlockText,
  type EditorBlock,
  type EditorCommand,
  type EditorDocument,
  type EditorSelection,
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

function blockPlaceholder(block: EditorBlock): string {
  if (block.type === "heading") return `Heading ${block.level || 1}`;
  if (block.type === "todo") return "To-do";
  if (block.type === "quote") return "Quote";
  if (block.type === "bulleted-list") return "List item";
  if (block.type === "numbered-list") return "Numbered item";
  return "Type '/' for commands";
}

function blockClassName(block: EditorBlock): string {
  return ["je-block", `je-block--${block.type}`, block.checked ? "is-checked" : ""]
    .filter(Boolean)
    .join(" ");
}

function readTextOffset(element: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return element.textContent?.length || 0;
  const range = selection.getRangeAt(0);
  if (!selection.focusNode || !element.contains(selection.focusNode)) {
    return element.textContent?.length || 0;
  }
  const before = range.cloneRange();
  before.selectNodeContents(element);
  before.setEnd(selection.focusNode, selection.focusOffset);
  return before.toString().length;
}

function setTextOffset(element: HTMLElement, offset: number) {
  element.focus();
  const text = element.textContent || "";
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const node = element.firstChild || element.appendChild(document.createTextNode(""));
  const range = document.createRange();
  range.setStart(node, Math.min(safeOffset, node.textContent?.length || 0));
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
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
          <span className="je-slash-menu__icon">{command.label.slice(0, 1)}</span>
          <span>
            <strong>{command.label}</strong>
            <small>{command.description}</small>
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
  const blockRefs = useRef(new Map<string, HTMLElement>());
  const pendingFocusRef = useRef<EditorSelection | null>(null);
  const isComposingRef = useRef(false);

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
    setTextOffset(target, focus.offset);
  }

  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    focusSelection(pending);
  }, [history.document, selection]);

  function commit(transaction: EditorTransaction) {
    const nextSelection = transaction.selection
      ? clampSelection(transaction.after, transaction.selection)
      : selection;
    pendingFocusRef.current = nextSelection;
    setHistory((current) => applyTransaction(current, transaction));
    setSelection(nextSelection);
    setSlash(null);
    onChange?.(transaction.after, transaction);
  }

  function currentBlock(blockId: string) {
    return history.document.blocks.find((block) => block.id === blockId) || null;
  }

  function selectCommand(command: EditorCommand, blockId = slash?.blockId) {
    if (!blockId) return;
    const block = currentBlock(blockId);
    const focus = selection ? getSelectionFocus(selection) : null;
    let nextText: string | undefined;

    if (slash?.blockId === blockId && block && focus?.blockId === blockId) {
      const text = getBlockPlainText(block);
      const beforeCursor = text.slice(0, focus.offset);
      const slashStart = beforeCursor.lastIndexOf("/");
      if (slashStart >= 0) {
        nextText = `${beforeCursor.slice(0, slashStart)}${text.slice(focus.offset)}`;
      }
    }

    commit(setBlockType(history.document, blockId, command.blockType, command.level, nextText));
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
    setSlash((current) => {
      if (!slashMatch) return null;
      const query = slashMatch[1];
      if (current?.blockId === block.id && current.query === query) return current;
      return { blockId: block.id, query, activeIndex: 0 };
    });
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

    if (slash) {
      const commands = findEditorCommand(slash.query);
      if (event.key === "Escape") {
        event.preventDefault();
        setSlash(null);
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
                  data-placeholder={blockPlaceholder(block)}
                  suppressContentEditableWarning
                  ref={(node) => {
                    if (node) blockRefs.current.set(block.id, node);
                    else blockRefs.current.delete(block.id);
                  }}
                  onFocus={(event) => {
                    const offset = readTextOffset(event.currentTarget);
                    setSelection(createCollapsedSelection(block.id, offset));
                  }}
                  onKeyUp={(event) => {
                    const offset = readTextOffset(event.currentTarget);
                    setSelection(createCollapsedSelection(block.id, offset));
                  }}
                  onMouseUp={(event) => {
                    const offset = readTextOffset(event.currentTarget);
                    setSelection(createCollapsedSelection(block.id, offset));
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
                >
                  {text}
                </div>
              )}
              {slash?.blockId === block.id ? (
                <SlashMenu
                  slash={slash}
                  onSelect={selectCommand}
                  onActiveIndexChange={(activeIndex) => setSlash({ ...slash, activeIndex })}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
