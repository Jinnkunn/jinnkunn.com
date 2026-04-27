// WYSIWYG inline-markdown block. Renders **bold**, *italic*, `code`,
// ~~strike~~, [links](url) the way they'll appear on the public site
// instead of leaving raw markdown chars on screen.
//
// Handles every text-bearing block type whose body is "one logical paragraph
// of styled inline text" — paragraph, heading, quote, callout. The
// dispatcher in MdxDocumentEditor routes those four block types here BEFORE
// the textarea fallback. Multi-item blocks (list, todo, toggle summary)
// still go through the textarea path until a later phase migrates them.
//
// All four kinds share the same TipTap engine (RichTextInput); the only
// differences are the wrapper chrome (heading gets a level selector;
// paragraph hosts the slash menu) and the CSS class on the contenteditable.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { Editor } from "@tiptap/core";

import {
  BlockEditorCommandMenu,
  type BlockEditorCommand,
} from "./block-editor";
import { BlockPopover, type BlockPopoverAnchor } from "./block-popover";
import { MentionPicker, type MentionTarget } from "./mention-picker";
import type { MdxBlock, MdxBlockType } from "./mdx-blocks";
import { RichTextInput, type RichTextInputHandle } from "./RichTextInput";
import type { NormalizedApiResponse } from "./types";

type RequestFn = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<NormalizedApiResponse>;

interface SlashCommand extends BlockEditorCommand {
  makeBlock: () => MdxBlock;
}

export type RichTextBlockKind = "paragraph" | "heading" | "quote" | "callout";

export interface RichTextEditableBlockProps {
  block: MdxBlock;
  /** Empty for non-paragraph kinds — slash menu only fires on `block.text`
   * starting with "/" inside a paragraph. */
  slashCommands: SlashCommand[];
  /** Receives the contenteditable DOM node so the parent's focus-request
   * effect can call `node.focus()` after a new block is inserted. The
   * focus effect is tolerant of non-textarea nodes (no setSelectionRange
   * call when `value` is missing). */
  onFocusInput: (node: HTMLElement | null) => void;
  onChooseSlashCommand: (command: SlashCommand) => void;
  onDuplicate: () => void;
  onInsertParagraphAfter: () => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  onRemoveEmpty: () => void;
  onSlashCommand: (value: string) => boolean;
  onTurnInto: (type: MdxBlockType, level?: 1 | 2 | 3) => void;
  request: RequestFn;
}

function placeholderFor(block: MdxBlock): string {
  if (block.type === "heading") return "Heading";
  if (block.type === "quote") return "Quote";
  if (block.type === "callout") return "Callout";
  if (block.type === "list") return "One item per line";
  return "Type '/' for commands";
}

function classNameFor(block: MdxBlock): string {
  if (block.type === "heading") {
    const level = block.level ?? 2;
    return `mdx-document-text-block mdx-document-text-block--heading mdx-document-heading-block__input mdx-document-heading-block__input--h${level}`;
  }
  if (block.type === "list") {
    const style = block.listStyle ?? "bulleted";
    return `mdx-document-text-block mdx-document-text-block--list mdx-document-text-block--list-${style}`;
  }
  return `mdx-document-text-block mdx-document-text-block--${block.type}`;
}

export function RichTextEditableBlock({
  block,
  slashCommands,
  onChooseSlashCommand,
  onDuplicate,
  onFocusInput,
  onInsertParagraphAfter,
  onMoveDown,
  onMoveUp,
  onPatch,
  onRemoveEmpty,
  onSlashCommand,
  onTurnInto,
  request,
}: RichTextEditableBlockProps) {
  const richRef = useRef<RichTextInputHandle>(null);
  // The editor lives in RichTextInput's `useEditor`. We track it as
  // reactive state via the `onEditorReady` callback so the
  // selection-subscribe effect below can depend on it — `useEffect([])`
  // against `richRef.current?.getEditor()` was racing the initial mount
  // and never registering the listener (selection toolbar never showed).
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selection, setSelection] = useState<{ from: number; to: number } | null>(null);
  const [mention, setMention] = useState<{ from: number } | null>(null);
  // Force re-render on every selection / doc update so anchor coords stay
  // pinned to the current caret. Cheap — the editor only fires these on
  // user input.
  const [, setRevision] = useState(0);

  const showSlashMenu = slashCommands.length > 0;
  const isEmpty = !block.text;

  // Subscribe to TipTap selection / doc updates so the format toolbar
  // anchors to the live caret and the rev counter forces a coords recompute.
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      setRevision((r) => r + 1);
      const { from, to, empty } = editor.state.selection;
      setSelection(empty ? null : { from, to });
    };
    editor.on("selectionUpdate", onUpdate);
    editor.on("transaction", onUpdate);
    return () => {
      editor.off("selectionUpdate", onUpdate);
      editor.off("transaction", onUpdate);
    };
  }, [editor]);

  // Keyboard handler. Most logic is borrowed from the textarea path — the
  // diffs are: format shortcuts use TipTap commands instead of toggle-wrap,
  // Enter checks editor.getText() for the slash trigger, Backspace-empty
  // uses editor.isEmpty.
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const editor = richRef.current?.getEditor();
      if (!editor) return;
      const meta = event.metaKey || event.ctrlKey;

      if (event.key === "@" && !meta) {
        // Snapshot the position one char ahead — by the time we read it on
        // the next frame the "@" will have landed in the doc.
        requestAnimationFrame(() => {
          const e = richRef.current?.getEditor();
          if (!e) return;
          setMention({ from: e.state.selection.from });
        });
      }

      if (meta && event.shiftKey && event.key === "ArrowUp") {
        event.preventDefault();
        onMoveUp();
        return;
      }
      if (meta && event.shiftKey && event.key === "ArrowDown") {
        event.preventDefault();
        onMoveDown();
        return;
      }
      if (
        meta &&
        event.altKey &&
        (event.key === "1" || event.key === "2" || event.key === "3")
      ) {
        event.preventDefault();
        onTurnInto("heading", Number(event.key) as 1 | 2 | 3);
        return;
      }

      if (meta && !event.shiftKey && !event.altKey) {
        const lowered = event.key.toLowerCase();
        if (lowered === "d") {
          event.preventDefault();
          onDuplicate();
          return;
        }
        if (event.key === "/") {
          // Cmd+/: open the slash menu. Replace the doc with "/" so the
          // matcher fires on the next render via the slashCommands prop.
          event.preventDefault();
          onPatch((current) => ({ ...current, text: "/" }));
          return;
        }
        if (lowered === "b") {
          event.preventDefault();
          editor.chain().focus().toggleBold().run();
          return;
        }
        if (lowered === "i") {
          event.preventDefault();
          editor.chain().focus().toggleItalic().run();
          return;
        }
        if (lowered === "u") {
          event.preventDefault();
          editor.chain().focus().toggleUnderline().run();
          return;
        }
        if (lowered === "e") {
          event.preventDefault();
          editor.chain().focus().toggleCode().run();
          return;
        }
        if (lowered === "k") {
          event.preventDefault();
          const url =
            typeof window !== "undefined" ? window.prompt("Link URL", "https://") : null;
          if (url) {
            editor.chain().focus().setLink({ href: url }).run();
          }
          return;
        }
      }

      if (event.key === "Enter" && !event.shiftKey) {
        // list blocks let TipTap split the paragraph — each split becomes
        // a new line in the markdown serializer (which prepends the bullet
        // / number on save). All other kinds intercept Enter to either
        // trigger the slash menu or insert a sibling block.
        if (block.type === "list") return;
        const plain = editor.getText();
        if (plain.trim().startsWith("/")) {
          if (onSlashCommand(plain)) {
            event.preventDefault();
            return;
          }
        }
        event.preventDefault();
        onInsertParagraphAfter();
        return;
      }

      if (
        event.key === "Backspace" &&
        editor.isEmpty &&
        editor.state.selection.empty &&
        editor.state.selection.from === 1
      ) {
        event.preventDefault();
        onRemoveEmpty();
      }
    },
    [
      block.type,
      onDuplicate,
      onInsertParagraphAfter,
      onMoveDown,
      onMoveUp,
      onPatch,
      onRemoveEmpty,
      onSlashCommand,
      onTurnInto,
    ],
  );

  const handleValueChange = useCallback(
    (next: string) => {
      onPatch((current) => {
        // Lists track per-line `markers`; once the user adds / removes a
        // line via the WYSIWYG editor those indices go stale, so we drop
        // the array and let the markdown serializer fall back to the
        // default for the current `listStyle` (`- ` or `1. `, `2. `, …).
        if (current.type === "list") {
          return { ...current, text: next, markers: undefined };
        }
        return { ...current, text: next };
      });
    },
    [onPatch],
  );

  // Anchor for the inline format toolbar. ProseMirror's `coordsAtPos`
  // returns viewport-relative pixel coords — same coordinate space the
  // textarea-caret helper uses for the textarea path, so the existing
  // BlockPopover positioning works unchanged.
  const inlineAnchor = useMemo<BlockPopoverAnchor>(() => {
    if (!editor || !selection) return null;
    try {
      const coords = editor.view.coordsAtPos(selection.from);
      return {
        top: coords.top,
        left: coords.left,
        width: 0,
        height: coords.bottom - coords.top,
      };
    } catch {
      return null;
    }
  }, [editor, selection]);

  const mentionAnchor = useMemo<BlockPopoverAnchor>(() => {
    if (!editor || !mention) return null;
    try {
      const coords = editor.view.coordsAtPos(mention.from);
      return {
        top: coords.bottom,
        left: coords.left,
        width: 0,
        height: 0,
      };
    } catch {
      return null;
    }
  }, [editor, mention]);

  const insertMention = useCallback(
    (target: MentionTarget) => {
      if (!editor || !mention) return;
      // Range to replace: from one char before the "@" up through the
      // current caret (so the picker swallows the literal @ and any partial
      // query the user typed before selecting).
      const atStart = mention.from - 1;
      const caret = editor.state.selection.from;
      editor
        .chain()
        .focus()
        .deleteRange({ from: atStart, to: caret })
        .insertContent({
          type: "text",
          text: target.title,
          marks: [{ type: "link", attrs: { href: `/pages/${target.slug}` } }],
        })
        .run();
      setMention(null);
    },
    [editor, mention],
  );

  const mentionInitialQuery = useMemo(() => {
    if (!editor || !mention) return "";
    const text = editor.state.doc.textBetween(
      mention.from,
      editor.state.selection.from,
      "",
    );
    return text;
  }, [editor, mention]);

  // Hand the contenteditable DOM node to the parent so its focus-request
  // effect (when a new block is created) can call `node.focus()`. Tied to
  // editor identity so a re-creation re-registers; cleanup on unmount
  // un-registers so stale ids don't leak.
  useEffect(() => {
    if (!editor) return;
    const node = editor.view.dom as HTMLElement;
    onFocusInput(node);
    return () => onFocusInput(null);
    // We intentionally re-run when block id or editor identity changes;
    // otherwise the node is stable for the editor's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, editor]);

  const inner = (
    <RichTextInput
      ref={richRef}
      value={block.text}
      onChange={handleValueChange}
      onKeyDown={onKeyDown}
      onEditorReady={setEditor}
      className={classNameFor(block)}
      ariaLabel={`${block.type} block`}
      placeholder={isEmpty ? placeholderFor(block) : undefined}
    />
  );

  const overlays = (
    <>
      {showSlashMenu ? (
        <BlockEditorCommandMenu
          className="mdx-document-slash-menu"
          commands={slashCommands}
          onChoose={onChooseSlashCommand}
        />
      ) : null}
      {selection && inlineAnchor ? (
        <InlineFormatToolbar
          anchor={inlineAnchor}
          editor={editor}
          onClose={() => setSelection(null)}
          onTurnInto={onTurnInto}
        />
      ) : null}
      {mention && mentionAnchor ? (
        <MentionPicker
          anchor={mentionAnchor}
          initialQuery={mentionInitialQuery}
          onClose={() => setMention(null)}
          onPick={insertMention}
          request={request}
        />
      ) : null}
    </>
  );

  // Heading level and list style now live in the block action menu /
  // slash commands rather than persistent inline selects. This keeps the
  // canvas content-first like Notion: controls appear from the left gutter
  // when the row is hovered or focused.
  return (
    <div className="mdx-document-text-block-shell">
      {inner}
      {overlays}
    </div>
  );
}

interface InlineFormatToolbarProps {
  anchor: BlockPopoverAnchor;
  editor: Editor | null;
  onClose: () => void;
  onTurnInto: (type: MdxBlockType, level?: 1 | 2 | 3) => void;
}

// Notion's named-color palette, mirrored on the public site as
// --ds-color-{text,bg}-{name} CSS variables. "default" means no color
// (renders as the surrounding text/background); selecting it from the
// picker clears the corresponding axis.
const COLOR_PALETTE = [
  "default",
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const;

type ColorValue = (typeof COLOR_PALETTE)[number];

function InlineFormatToolbar({
  anchor,
  editor,
  onClose,
  onTurnInto,
}: InlineFormatToolbarProps) {
  // Same focus-preserving trick the textarea version uses — mousedown on
  // toolbar buttons would normally collapse the editor selection before
  // the click handler runs, so we preventDefault to keep the range intact.
  const preserve = (event: ReactMouseEvent) => {
    event.preventDefault();
  };
  const [colorPickerOpen, setColorPickerOpen] = useState(false);

  if (!editor) return null;

  const onBold = () => editor.chain().focus().toggleBold().run();
  const onItalic = () => editor.chain().focus().toggleItalic().run();
  const onUnderline = () => editor.chain().focus().toggleUnderline().run();
  const onCode = () => editor.chain().focus().toggleCode().run();
  const onStrike = () => editor.chain().focus().toggleStrike().run();
  const onLink = () => {
    const existing = editor.getAttributes("link").href as string | undefined;
    const url =
      typeof window !== "undefined"
        ? window.prompt("Link URL", existing || "https://")
        : null;
    if (url === null) return;
    if (!url) {
      editor.chain().focus().unsetLink().unsetInlineLinkStyle().run();
      return;
    }
    editor.chain().focus().setLink({ href: url }).run();
  };
  const onIconLink = () => {
    const active = editor.isActive("inlineLinkStyle", { style: "icon" });
    if (active) {
      editor.chain().focus().unsetInlineLinkStyle().run();
      return;
    }

    const existing = editor.getAttributes("link").href as string | undefined;
    if (!existing) {
      const url =
        typeof window !== "undefined"
          ? window.prompt("Link URL", "https://")
          : null;
      if (!url) return;
      editor
        .chain()
        .focus()
        .setLink({ href: url })
        .setInlineLinkStyle({ style: "icon" })
        .run();
      return;
    }

    editor.chain().focus().setInlineLinkStyle({ style: "icon" }).run();
  };

  // Read the current color attrs so the picker shows what's already
  // applied to the selection. Empty string when no inlineColor mark
  // is set on the cursor / range.
  const activeAttrs = editor.getAttributes("inlineColor") as {
    color?: string | null;
    bg?: string | null;
  };
  const activeColor: ColorValue =
    (typeof activeAttrs.color === "string" && (COLOR_PALETTE as readonly string[]).includes(
      activeAttrs.color,
    )
      ? (activeAttrs.color as ColorValue)
      : "default");
  const activeBg: ColorValue =
    (typeof activeAttrs.bg === "string" && (COLOR_PALETTE as readonly string[]).includes(
      activeAttrs.bg,
    )
      ? (activeAttrs.bg as ColorValue)
      : "default");

  const applyColor = (axis: "color" | "bg", value: ColorValue) => {
    const next = value === "default" ? "" : value;
    editor
      .chain()
      .focus()
      .setInlineColor({
        color: axis === "color" ? next : activeColor === "default" ? "" : activeColor,
        bg: axis === "bg" ? next : activeBg === "default" ? "" : activeBg,
      })
      .run();
  };

  return (
    <BlockPopover
      anchor={anchor}
      ariaLabel="Inline format"
      className="block-popover--inline"
      onClose={onClose}
      open={true}
      placement="top-start"
    >
      <div className="block-popover__inline" role="toolbar" aria-label="Inline format">
        <button
          type="button"
          className="block-popover__inline-btn"
          aria-label="Bold (⌘B)"
          title="Bold (⌘B)"
          onMouseDown={preserve}
          onClick={onBold}
          data-active={editor.isActive("bold") || undefined}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          className="block-popover__inline-btn"
          aria-label="Italic (⌘I)"
          title="Italic (⌘I)"
          onMouseDown={preserve}
          onClick={onItalic}
          data-active={editor.isActive("italic") || undefined}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          className="block-popover__inline-btn"
          aria-label="Underline (⌘U)"
          title="Underline (⌘U)"
          onMouseDown={preserve}
          onClick={onUnderline}
          data-active={editor.isActive("underline") || undefined}
        >
          <u>U</u>
        </button>
        <button
          type="button"
          className="block-popover__inline-btn"
          aria-label="Strikethrough"
          title="Strikethrough"
          onMouseDown={preserve}
          onClick={onStrike}
          data-active={editor.isActive("strike") || undefined}
        >
          <s>S</s>
        </button>
        <button
          type="button"
          className="block-popover__inline-btn block-popover__inline-btn--mono"
          aria-label="Inline code (⌘E)"
          title="Inline code (⌘E)"
          onMouseDown={preserve}
          onClick={onCode}
          data-active={editor.isActive("code") || undefined}
        >
          {"<>"}
        </button>
        <button
          type="button"
          className="block-popover__inline-btn"
          aria-label="Link (⌘K)"
          title="Link (⌘K)"
          onMouseDown={preserve}
          onClick={onLink}
          data-active={editor.isActive("link") || undefined}
        >
          🔗
        </button>
        <button
          type="button"
          className="block-popover__inline-btn"
          aria-label="Icon link"
          title="Icon link"
          onMouseDown={preserve}
          onClick={onIconLink}
          data-active={
            editor.isActive("inlineLinkStyle", { style: "icon" }) || undefined
          }
        >
          ↗
        </button>
        <span className="block-popover__inline-divider" aria-hidden="true" />
        {/* Color picker — opens a small palette popover below the toolbar
         * with separate rows for text color and background color. The
         * outer button shows the active foreground tint as a colored "A"
         * (Notion-style affordance). */}
        <button
          type="button"
          className="block-popover__inline-btn block-popover__inline-color-btn"
          aria-label="Text color"
          title="Text color"
          aria-haspopup="true"
          aria-expanded={colorPickerOpen}
          onMouseDown={preserve}
          onClick={() => setColorPickerOpen((open) => !open)}
          data-active={
            (activeColor !== "default" || activeBg !== "default") || undefined
          }
        >
          <span
            className="block-popover__inline-color-letter"
            data-color={activeColor === "default" ? undefined : activeColor}
            data-bg={activeBg === "default" ? undefined : activeBg}
          >
            A
          </span>
          <span aria-hidden="true">▾</span>
        </button>
        {colorPickerOpen ? (
          <ColorPickerPanel
            activeColor={activeColor}
            activeBg={activeBg}
            onPick={applyColor}
            onClose={() => setColorPickerOpen(false)}
            preserveSelection={preserve}
          />
        ) : null}
        <span className="block-popover__inline-divider" aria-hidden="true" />
        {/* Turn-into shortcuts — replace the current block (paragraph or
         * heading) with a heading at the chosen level, or convert back to
         * paragraph. The buttons mirror Cmd+Alt+1/2/3 already wired in the
         * keyboard handler. */}
        <button
          type="button"
          className="block-popover__inline-btn"
          aria-label="Turn into Text"
          title="Turn into Text"
          onMouseDown={preserve}
          onClick={() => onTurnInto("paragraph")}
        >
          T
        </button>
        {([1, 2, 3] as const).map((level) => (
          <button
            key={`h${level}`}
            type="button"
            className="block-popover__inline-btn"
            aria-label={`Turn into Heading ${level} (⌘⌥${level})`}
            title={`Turn into Heading ${level} (⌘⌥${level})`}
            onMouseDown={preserve}
            onClick={() => onTurnInto("heading", level)}
          >
            H{level}
          </button>
        ))}
      </div>
    </BlockPopover>
  );
}

interface ColorPickerPanelProps {
  activeColor: ColorValue;
  activeBg: ColorValue;
  onPick: (axis: "color" | "bg", value: ColorValue) => void;
  onClose: () => void;
  preserveSelection: (event: ReactMouseEvent) => void;
}

/** Two-row palette under the toolbar's "A▾" button — text colors above,
 * background tints below. Click a swatch to apply that tint to the
 * corresponding axis; click the active swatch (or the "default" cell) to
 * clear it. The panel is keyboard-dismissable via Esc. */
function ColorPickerPanel({
  activeColor,
  activeBg,
  onPick,
  onClose,
  preserveSelection,
}: ColorPickerPanelProps) {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="mdx-document-color-picker"
      role="dialog"
      aria-label="Color"
      onMouseDown={preserveSelection}
    >
      <div className="mdx-document-color-picker__row" role="group" aria-label="Text color">
        <span className="mdx-document-color-picker__label">Text</span>
        {COLOR_PALETTE.map((value) => (
          <button
            key={`text-${value}`}
            type="button"
            className="mdx-document-color-picker__swatch mdx-document-color-picker__swatch--text"
            data-color={value === "default" ? undefined : value}
            aria-label={`Text color ${value}`}
            aria-pressed={activeColor === value || undefined}
            data-active={activeColor === value || undefined}
            onMouseDown={preserveSelection}
            onClick={() => onPick("color", value)}
          >
            A
          </button>
        ))}
      </div>
      <div className="mdx-document-color-picker__row" role="group" aria-label="Background color">
        <span className="mdx-document-color-picker__label">BG</span>
        {COLOR_PALETTE.map((value) => (
          <button
            key={`bg-${value}`}
            type="button"
            className="mdx-document-color-picker__swatch mdx-document-color-picker__swatch--bg"
            data-bg={value === "default" ? undefined : value}
            aria-label={`Background color ${value}`}
            aria-pressed={activeBg === value || undefined}
            data-active={activeBg === value || undefined}
            onMouseDown={preserveSelection}
            onClick={() => onPick("bg", value)}
          >
            A
          </button>
        ))}
      </div>
    </div>
  );
}
