// WYSIWYG paragraph block. Renders inline marks (bold/italic/code/strike,
// links) the way they'll appear on the public site instead of leaving raw
// markdown chars on screen — `**foo**` becomes **foo**, `[t](u)` becomes a
// styled link, etc.
//
// This is the TipTap-based replacement for the textarea path EditableBlock
// uses for paragraph blocks. The dispatcher in MdxDocumentEditor routes
// `block.type === "paragraph"` here BEFORE the textarea fallback. Other
// text-bearing block types (heading, quote, callout, list, todo, toggle)
// still use the textarea path until later phases migrate them.

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

export interface ParagraphRichTextBlockProps {
  block: MdxBlock;
  slashCommands: SlashCommand[];
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

export function ParagraphRichTextBlock({
  block,
  slashCommands,
  onChooseSlashCommand,
  onDuplicate,
  onInsertParagraphAfter,
  onMoveDown,
  onMoveUp,
  onPatch,
  onRemoveEmpty,
  onSlashCommand,
  onTurnInto,
  request,
}: ParagraphRichTextBlockProps) {
  const richRef = useRef<RichTextInputHandle>(null);
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
    const editor = richRef.current?.getEditor();
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
  }, []);

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
      onPatch((current) => ({ ...current, text: next }));
    },
    [onPatch],
  );

  // Anchor for the inline format toolbar. ProseMirror's `coordsAtPos`
  // returns viewport-relative pixel coords — same coordinate space the
  // textarea-caret helper uses for the textarea path, so the existing
  // BlockPopover positioning works unchanged.
  const inlineAnchor = useMemo<BlockPopoverAnchor>(() => {
    const editor = richRef.current?.getEditor();
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
  }, [selection]);

  const mentionAnchor = useMemo<BlockPopoverAnchor>(() => {
    const editor = richRef.current?.getEditor();
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
  }, [mention]);

  const insertMention = useCallback(
    (target: MentionTarget) => {
      const editor = richRef.current?.getEditor();
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
    [mention],
  );

  const mentionInitialQuery = useMemo(() => {
    const editor = richRef.current?.getEditor();
    if (!editor || !mention) return "";
    const text = editor.state.doc.textBetween(
      mention.from,
      editor.state.selection.from,
      "",
    );
    return text;
  }, [mention]);

  return (
    <div className="mdx-document-text-block-shell">
      <RichTextInput
        ref={richRef}
        value={block.text}
        onChange={handleValueChange}
        onKeyDown={onKeyDown}
        className="mdx-document-text-block mdx-document-text-block--paragraph"
        ariaLabel="Paragraph block"
        placeholder={isEmpty ? "Type '/' for commands" : undefined}
      />
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
          editor={richRef.current?.getEditor() ?? null}
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
    </div>
  );
}

interface InlineFormatToolbarProps {
  anchor: BlockPopoverAnchor;
  editor: Editor | null;
  onClose: () => void;
  onTurnInto: (type: MdxBlockType, level?: 1 | 2 | 3) => void;
}

function InlineFormatToolbar({ anchor, editor, onClose }: InlineFormatToolbarProps) {
  // Same focus-preserving trick the textarea version uses — mousedown on
  // toolbar buttons would normally collapse the editor selection before
  // the click handler runs, so we preventDefault to keep the range intact.
  const preserve = (event: ReactMouseEvent) => {
    event.preventDefault();
  };

  if (!editor) return null;

  const onBold = () => editor.chain().focus().toggleBold().run();
  const onItalic = () => editor.chain().focus().toggleItalic().run();
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
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().setLink({ href: url }).run();
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
      </div>
    </BlockPopover>
  );
}
