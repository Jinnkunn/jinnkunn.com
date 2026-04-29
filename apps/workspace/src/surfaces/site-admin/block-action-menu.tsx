import { useEffect, useState, type DragEvent } from "react";

import { BlockPopover } from "./block-popover";
import {
  MDX_BLOCK_COLORS,
  type MdxBlock,
  type MdxBlockColor,
  type MdxBlockType,
} from "./mdx-blocks";

// Per-block hover gutter (the "+ ⋮⋮" handles to the left of every block)
// and the popover that opens when the user clicks the menu handle. Both
// were previously inline at the bottom of MdxDocumentEditor.tsx; lifting
// them here keeps the dispatcher file focused on block routing without
// changing visible behavior.

export type TurnIntoOption = {
  label: string;
  level?: 1 | 2 | 3;
  listStyle?: "bulleted" | "numbered";
  type: MdxBlockType;
};

// Options that can appear in the "Turn into" submenu, in display order.
// Block types whose data lives outside the `text` field (table, bookmark,
// embed, file, page-link) are intentionally omitted — turning to them from
// a text block would discard meaningful data.
export const TURN_INTO_OPTIONS: TurnIntoOption[] = [
  { label: "Text", type: "paragraph" },
  { label: "Heading 1", type: "heading", level: 1 },
  { label: "Heading 2", type: "heading", level: 2 },
  { label: "Heading 3", type: "heading", level: 3 },
  { label: "Bulleted list", type: "list", listStyle: "bulleted" },
  { label: "Numbered list", type: "list", listStyle: "numbered" },
  { label: "To-do list", type: "todo" },
  { label: "Toggle", type: "toggle" },
  { label: "Quote", type: "quote" },
  { label: "Callout", type: "callout" },
  { label: "Code", type: "code" },
  { label: "Divider", type: "divider" },
  { label: "Image", type: "image" },
  { label: "Raw MDX", type: "raw" },
];

export function isTurnIntoOptionActive(
  block: MdxBlock | null,
  option: TurnIntoOption,
): boolean {
  if (!block || block.type !== option.type) return false;
  if (option.type === "heading") {
    return (block.level ?? 2) === option.level;
  }
  if (option.type === "list") {
    return (block.listStyle ?? "bulleted") === option.listStyle;
  }
  return true;
}

export interface BlockGutterHandlesProps {
  controlsActive: boolean;
  isDragging: boolean;
  onAdd: () => void;
  onDragEnd: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onMenu: (anchor: HTMLElement) => void;
}

export function BlockGutterHandles({
  controlsActive,
  isDragging,
  onAdd,
  onDragEnd,
  onDragStart,
  onMenu,
}: BlockGutterHandlesProps) {
  return (
    <div className="mdx-document-block__gutter" aria-hidden="false">
      <button
        type="button"
        className="mdx-document-block__handle mdx-document-block__handle--add"
        tabIndex={controlsActive ? 0 : -1}
        onClick={onAdd}
        aria-label="Add block below"
        title="Click to add a block below"
      >
        +
      </button>
      <button
        type="button"
        className="mdx-document-block__handle mdx-document-block__handle--menu"
        tabIndex={controlsActive ? 0 : -1}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={(event) => onMenu(event.currentTarget)}
        aria-label="Drag to reorder, click for block actions"
        title={isDragging ? "Dragging" : "Drag to reorder · Click for actions"}
      >
        ⋮⋮
      </button>
    </div>
  );
}

export interface BlockActionMenuProps {
  anchor: HTMLElement;
  block: MdxBlock | null;
  canMoveDown: boolean;
  canMoveUp: boolean;
  onClose: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
  onSetColor: (color: MdxBlockColor) => void;
  onTurnInto: (
    type: MdxBlockType,
    level?: 1 | 2 | 3,
    listStyle?: "bulleted" | "numbered",
  ) => void;
}

type ActionMenuPanel = "main" | "turnInto" | "color";

export function BlockActionMenu({
  anchor,
  block,
  canMoveDown,
  canMoveUp,
  onClose,
  onCopyLink,
  onDelete,
  onDuplicate,
  onMoveDown,
  onMoveUp,
  onSetColor,
  onTurnInto,
}: BlockActionMenuProps) {
  const [panel, setPanel] = useState<ActionMenuPanel>("main");

  useEffect(() => {
    if (!block) onClose();
  }, [block, onClose]);

  return (
    <BlockPopover
      anchor={anchor}
      ariaLabel="Block actions"
      className="block-popover--menu"
      onClose={onClose}
      open={Boolean(block)}
      placement="bottom-start"
    >
      {panel === "turnInto" ? (
        <div className="block-popover__section" role="menu" aria-label="Turn into">
          <button
            type="button"
            className="block-popover__item block-popover__item--back"
            onClick={() => setPanel("main")}
          >
            ← Turn into…
          </button>
          {TURN_INTO_OPTIONS.map((option) => (
            <button
              type="button"
              className="block-popover__item"
              key={`${option.type}-${option.level ?? option.listStyle ?? "default"}`}
              onClick={() =>
                onTurnInto(option.type, option.level, option.listStyle)
              }
              aria-current={
                isTurnIntoOptionActive(block, option) ? "true" : undefined
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : panel === "color" ? (
        <div className="block-popover__section" role="menu" aria-label="Color">
          <button
            type="button"
            className="block-popover__item block-popover__item--back"
            onClick={() => setPanel("main")}
          >
            ← Color
          </button>
          {MDX_BLOCK_COLORS.map((color) => (
            <button
              type="button"
              key={color}
              className="block-popover__item block-popover__item--swatch"
              data-color={color}
              onClick={() => onSetColor(color)}
              aria-current={
                (block?.color ?? "default") === color ? "true" : undefined
              }
            >
              <span
                className="block-popover__swatch"
                data-color={color}
                aria-hidden="true"
              />
              <span style={{ textTransform: "capitalize" }}>{color}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="block-popover__section" role="menu">
          <button type="button" className="block-popover__item" onClick={onDelete}>
            <span>Delete</span>
            <kbd>⌫</kbd>
          </button>
          <button type="button" className="block-popover__item" onClick={onDuplicate}>
            <span>Duplicate</span>
            <kbd>⌘D</kbd>
          </button>
          <button
            type="button"
            className="block-popover__item"
            onClick={() => setPanel("turnInto")}
          >
            <span>Turn into</span>
            <span aria-hidden="true">›</span>
          </button>
          <button
            type="button"
            className="block-popover__item"
            onClick={() => setPanel("color")}
          >
            <span>Color</span>
            <span aria-hidden="true">›</span>
          </button>
          <button type="button" className="block-popover__item" onClick={onCopyLink}>
            <span>Copy link to block</span>
          </button>
          <div className="block-popover__divider" role="separator" />
          <button
            type="button"
            className="block-popover__item"
            disabled={!canMoveUp}
            onClick={onMoveUp}
          >
            <span>Move up</span>
            <kbd>⌥↑</kbd>
          </button>
          <button
            type="button"
            className="block-popover__item"
            disabled={!canMoveDown}
            onClick={onMoveDown}
          >
            <span>Move down</span>
            <kbd>⌥↓</kbd>
          </button>
        </div>
      )}
    </BlockPopover>
  );
}
