// WYSIWYG inline-markdown block. Renders **bold**, *italic*, `code`,
// ~~strike~~, [links](url) the way they'll appear on the public site
// instead of leaving raw markdown chars on screen.
//
// Handles every text-bearing block whose body is styled inline text:
// paragraph, heading, quote, callout, and list rows. Todo items and
// toggle summaries use the same RichTextInput in their dedicated renderers.
//
// All four kinds share the same TipTap engine (RichTextInput); the only
// differences are the wrapper chrome, slash-menu affordance, and the CSS
// class on the contenteditable.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from "react";
import { getMarkRange, type Editor } from "@tiptap/core";

import { AssetLibraryPicker, rememberRecentAsset } from "./AssetLibraryPicker";
import {
  BlockEditorCommandMenu,
  type BlockEditorCommand,
} from "./block-editor";
import { BlockPopover, type BlockPopoverAnchor } from "./block-popover";
import {
  findIconLinkEntryForHref,
  ICON_LINK_REGISTRY,
  type IconLinkRegistryEntry,
} from "./icon-link-registry";
import { MentionPicker, type MentionTarget } from "./mention-picker";
import {
  createMdxBlock,
  parseMdxBlocks,
  type MdxBlock,
  type MdxBlockType,
} from "./mdx-blocks";
import { RichTextInput, type RichTextInputHandle } from "./RichTextInput";
import { uploadImageFile } from "./assets-upload";
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
  onInsertBlocksAfter: (blocks: MdxBlock[]) => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  onRemoveEmpty: () => void;
  onReplaceWithBlocks: (blocks: MdxBlock[]) => void;
  onSlashCommand: (value: string) => boolean;
  onTurnInto: (type: MdxBlockType, level?: 1 | 2 | 3) => void;
  readOnly?: boolean;
  request: RequestFn;
  setMessage: (kind: "error" | "success", text: string) => void;
}

type KeyboardLinkMode = "regular" | "icon";

function isProbablyUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return true;
  if (/^\/(?!\/)/.test(trimmed)) return true;
  return /^[\w.-]+\.[a-z]{2,}(?:[/?#].*)?$/i.test(trimmed);
}

function isValidPastedBlock(block: MdxBlock): boolean {
  if (block.type === "paragraph") return block.text.trim().length > 0;
  if (block.type === "heading") return block.text.trim().length > 0;
  return true;
}

export function markdownShortcutBlock(text: string): MdxBlock | null {
  const marker = text.trim();
  if (marker === "#") return { ...createMdxBlock("heading"), level: 1, text: "" };
  if (marker === "##") return { ...createMdxBlock("heading"), level: 2, text: "" };
  if (marker === "###") return { ...createMdxBlock("heading"), level: 3, text: "" };
  if (marker === "-" || marker === "*") {
    return { ...createMdxBlock("list"), listStyle: "bulleted", text: "" };
  }
  if (/^\d+\.$/.test(marker)) {
    return { ...createMdxBlock("list"), listStyle: "numbered", text: "" };
  }
  if (marker === ">") return createMdxBlock("quote");
  if (marker === "[ ]" || marker === "[]") return createMdxBlock("todo");
  if (/^\[[xX]\]$/.test(marker)) {
    return { ...createMdxBlock("todo"), checkedLines: [0] };
  }
  if (marker === "---" || marker === "***") return createMdxBlock("divider");
  if (marker === "```") return createMdxBlock("code");
  return null;
}

export function shouldPromotePlainTextPaste(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.includes("\n\n")) return true;
  if (/^```/m.test(trimmed)) return true;
  if (/^\s{0,3}(#{1,3}\s+|[-*]\s+|\d+\.\s+|>\s+|- \[[ xX]\]\s+)/m.test(trimmed))
    return true;
  const lines = trimmed.split("\n");
  return (
    lines.length >= 2 &&
    lines.every((line) => line.trim().startsWith("|")) &&
    /\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|/.test(lines[1] ?? "")
  );
}

export function blocksFromPlainTextPaste(text: string): MdxBlock[] {
  return parseMdxBlocks(text)
    .filter(isValidPastedBlock)
    .map((block) => ({ ...block, blankLinesBefore: undefined }));
}

function imageFilesFromClipboard(event: ClipboardEvent): File[] {
  const items = Array.from(event.clipboardData?.items ?? []);
  const fromItems = items
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  if (fromItems.length > 0) return fromItems;
  return Array.from(event.clipboardData?.files ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );
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
  onInsertBlocksAfter,
  onMoveDown,
  onMoveUp,
  onPatch,
  onRemoveEmpty,
  onReplaceWithBlocks,
  onSlashCommand,
  onTurnInto,
  readOnly = false,
  request,
  setMessage,
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
  const [keyboardLinkMode, setKeyboardLinkMode] =
    useState<KeyboardLinkMode | null>(null);
  const [slashCursor, setSlashCursor] = useState(0);
  // Force re-render on every selection / doc update so anchor coords stay
  // pinned to the current caret. Cheap — the editor only fires these on
  // user input.
  const [, setRevision] = useState(0);

  const showSlashMenu = slashCommands.length > 0;
  const isEmpty = !block.text;

  useEffect(() => {
    setSlashCursor(0);
  }, [block.text, slashCommands.length]);

  const uploadClipboardImages = useCallback(
    async (files: File[]) => {
      const imageBlocks: MdxBlock[] = [];
      for (const file of files) {
        const result = await uploadImageFile({ file, request });
        if (!result.ok) {
          setMessage("error", `Image paste failed: ${result.error}`);
          continue;
        }
        rememberRecentAsset(result.asset, result.filename);
        imageBlocks.push({
          ...createMdxBlock("image"),
          alt: file.name.replace(/\.[^.]+$/, "") || result.filename,
          url: result.asset.url,
        });
      }
      if (imageBlocks.length > 0) onInsertBlocksAfter(imageBlocks);
    },
    [onInsertBlocksAfter, request, setMessage],
  );

  // Subscribe to TipTap selection / doc updates so the format toolbar
  // anchors to the live caret and its mark indicators reflect the current
  // marks. Two listeners with different jobs:
  //
  //   selectionUpdate — caret/range moved. Update the selection state so
  //     the toolbar appears/disappears/repositions; bump revision so
  //     coords recompute even when the range numbers happen to coincide.
  //
  //   transaction — any doc/state mutation. We only force a re-render
  //     when there's an active selection — that's the only time the
  //     toolbar is visible and its `editor.isActive(...)` indicators
  //     might need to update. Skipping this for empty-selection
  //     transactions (the common keystroke case) is what makes typing
  //     into a 100-block document feel responsive.
  useEffect(() => {
    if (!editor) return;
    const onSelectionUpdate = () => {
      setRevision((r) => r + 1);
      const { from, to, empty } = editor.state.selection;
      setSelection(empty ? null : { from, to });
    };
    const onTransaction = () => {
      if (!editor.state.selection.empty) {
        setRevision((r) => r + 1);
      }
    };
    editor.on("selectionUpdate", onSelectionUpdate);
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("selectionUpdate", onSelectionUpdate);
      editor.off("transaction", onTransaction);
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
      if (readOnly) return;
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
      if (!meta && event.altKey && event.key === "ArrowUp") {
        event.preventDefault();
        onMoveUp();
        return;
      }
      if (!meta && event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        onMoveDown();
        return;
      }

      if (
        event.key === " " &&
        !meta &&
        !event.altKey &&
        !event.shiftKey &&
        block.type === "paragraph" &&
        editor.state.selection.empty
      ) {
        const shortcutBlock = markdownShortcutBlock(editor.getText());
        if (shortcutBlock) {
          event.preventDefault();
          onReplaceWithBlocks([shortcutBlock]);
          return;
        }
      }

      if (showSlashMenu && !meta && !event.altKey) {
        if (!event.shiftKey && event.key === "ArrowDown") {
          event.preventDefault();
          setSlashCursor((current) =>
            Math.min(slashCommands.length - 1, current + 1),
          );
          return;
        }
        if (!event.shiftKey && event.key === "ArrowUp") {
          event.preventDefault();
          setSlashCursor((current) => Math.max(0, current - 1));
          return;
        }
        if (event.key === "Tab") {
          event.preventDefault();
          setSlashCursor((current) =>
            event.shiftKey
              ? Math.max(0, current - 1)
              : Math.min(slashCommands.length - 1, current + 1),
          );
          return;
        }
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

      if (meta && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setKeyboardLinkMode(event.shiftKey ? "icon" : "regular");
        setRevision((r) => r + 1);
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
      }

      if (event.key === "Enter" && !event.shiftKey) {
        if (
          block.type === "paragraph" &&
          editor.state.selection.empty
        ) {
          const shortcutBlock = markdownShortcutBlock(editor.getText());
          if (shortcutBlock && (shortcutBlock.type === "divider" || shortcutBlock.type === "code")) {
            event.preventDefault();
            onReplaceWithBlocks([shortcutBlock]);
            return;
          }
        }
        // list blocks let TipTap split the paragraph — each split becomes
        // a new line in the markdown serializer (which prepends the bullet
        // / number on save). All other kinds intercept Enter to either
        // trigger the slash menu or insert a sibling block.
        if (block.type === "list") return;
        const plain = editor.getText();
        if (plain.trim().startsWith("/")) {
          const command = slashCommands[slashCursor];
          if (command) {
            event.preventDefault();
            onChooseSlashCommand(command);
            return;
          }
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
      onChooseSlashCommand,
      onDuplicate,
      onInsertParagraphAfter,
      onReplaceWithBlocks,
      onMoveDown,
      onMoveUp,
      onPatch,
      onRemoveEmpty,
      onSlashCommand,
      onTurnInto,
      readOnly,
      showSlashMenu,
      slashCommands,
      slashCursor,
    ],
  );

  const onPaste = useCallback(
    (event: ClipboardEvent) => {
      const editor = richRef.current?.getEditor();
      if (!editor || readOnly) return false;

      const imageFiles = imageFilesFromClipboard(event);
      if (imageFiles.length > 0) {
        event.preventDefault();
        void uploadClipboardImages(imageFiles);
        return true;
      }

      const text = event.clipboardData?.getData("text/plain") ?? "";
      const trimmed = text.trim();
      if (!trimmed) return false;

      if (editor.isEmpty && isProbablyUrl(trimmed)) {
        event.preventDefault();
        onReplaceWithBlocks([
          {
            ...createMdxBlock("bookmark"),
            text: "",
            title: "",
            url: trimmed,
          },
        ]);
        return true;
      }

      if (!shouldPromotePlainTextPaste(text)) return false;
      const pastedBlocks = blocksFromPlainTextPaste(text);
      if (pastedBlocks.length === 0) return false;
      event.preventDefault();
      if (editor.isEmpty || !editor.state.selection.empty) {
        onReplaceWithBlocks(pastedBlocks);
      } else {
        onInsertBlocksAfter(pastedBlocks);
      }
      return true;
    },
    [
      onInsertBlocksAfter,
      onReplaceWithBlocks,
      readOnly,
      uploadClipboardImages,
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

  const keyboardLinkAnchor = useMemo<BlockPopoverAnchor>(() => {
    if (!editor || !keyboardLinkMode) return null;
    try {
      const coords = editor.view.coordsAtPos(editor.state.selection.from);
      return {
        top: coords.top,
        left: coords.left,
        width: 0,
        height: coords.bottom - coords.top,
      };
    } catch {
      return null;
    }
  }, [editor, keyboardLinkMode]);

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
      onPaste={onPaste}
      onEditorReady={setEditor}
      className={classNameFor(block)}
      ariaLabel={`${block.type} block`}
      readOnly={readOnly}
      placeholder={isEmpty ? placeholderFor(block) : undefined}
    />
  );

  const overlays = (
    <>
      {showSlashMenu && !readOnly ? (
        <BlockEditorCommandMenu
          activeCommandId={slashCommands[slashCursor]?.id}
          className="mdx-document-slash-menu"
          commands={slashCommands}
          onActiveCommandChange={(command) => {
            const index = slashCommands.findIndex((item) => item.id === command.id);
            if (index >= 0) setSlashCursor(index);
          }}
          onChoose={onChooseSlashCommand}
        />
      ) : null}
      {((selection && inlineAnchor) || (keyboardLinkMode && keyboardLinkAnchor)) && !readOnly ? (
        <InlineFormatToolbar
          key={keyboardLinkMode ? `keyboard-link-${keyboardLinkMode}` : "selection-toolbar"}
          anchor={(selection && inlineAnchor) || keyboardLinkAnchor}
          editor={editor}
          initialLinkMode={keyboardLinkMode}
          onClose={() => {
            setSelection(null);
            setKeyboardLinkMode(null);
          }}
          request={request}
          setMessage={setMessage}
          onTurnInto={onTurnInto}
        />
      ) : null}
      {mention && mentionAnchor && !readOnly ? (
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
    <div className="mdx-document-text-block-shell" data-empty={isEmpty ? "true" : undefined}>
      {inner}
      {overlays}
    </div>
  );
}

interface InlineFormatToolbarProps {
  anchor: BlockPopoverAnchor;
  editor: Editor | null;
  initialLinkMode?: KeyboardLinkMode | null;
  onClose: () => void;
  request: RequestFn;
  setMessage: (kind: "error" | "success", text: string) => void;
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

type LinkDraft = {
  href: string;
  iconMode: boolean;
  iconUrl: string;
  text: string;
};

function currentLinkRange(editor: Editor) {
  const type = editor.schema.marks.link;
  if (!type) return null;
  return getMarkRange(editor.state.selection.$from, type) ?? null;
}

function currentSelectionOrLinkText(editor: Editor): string {
  const { from, to, empty } = editor.state.selection;
  if (!empty) return editor.state.doc.textBetween(from, to, "\n");
  const range = currentLinkRange(editor);
  if (!range) return "";
  return editor.state.doc.textBetween(range.from, range.to, "\n");
}

function draftFromEditor(editor: Editor, forceIcon = false): LinkDraft {
  const linkAttrs = editor.getAttributes("link") as { href?: unknown };
  const iconAttrs = editor.getAttributes("inlineLinkStyle") as {
    icon?: unknown;
    style?: unknown;
  };
  const href = typeof linkAttrs.href === "string" ? linkAttrs.href : "";
  const iconUrl = typeof iconAttrs.icon === "string" ? iconAttrs.icon : "";
  const detected = findIconLinkEntryForHref(href);
  return {
    href,
    iconMode: forceIcon || iconAttrs.style === "icon" || Boolean(detected),
    iconUrl,
    text: currentSelectionOrLinkText(editor),
  };
}

function textMarkNamesForEditor(editor: Editor): string[] {
  return ["bold", "italic", "strike", "code", "underline"].filter((name) =>
    editor.isActive(name),
  );
}

function InlineFormatToolbar({
  anchor,
  editor,
  initialLinkMode = null,
  onClose,
  request,
  setMessage,
  onTurnInto,
}: InlineFormatToolbarProps) {
  // Same focus-preserving trick the textarea version uses — mousedown on
  // toolbar buttons would normally collapse the editor selection before
  // the click handler runs, so we preventDefault to keep the range intact.
  const preserve = (event: ReactMouseEvent) => {
    event.preventDefault();
  };
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [linkInspectorOpen, setLinkInspectorOpen] = useState(Boolean(initialLinkMode));
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState<LinkDraft>(() => ({
    ...(editor
      ? draftFromEditor(editor, initialLinkMode === "icon")
      : { href: "", iconMode: false, iconUrl: "", text: "" }),
  }));
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const iconFileInputRef = useRef<HTMLInputElement>(null);

  if (!editor) return null;

  const onBold = () => editor.chain().focus().toggleBold().run();
  const onItalic = () => editor.chain().focus().toggleItalic().run();
  const onUnderline = () => editor.chain().focus().toggleUnderline().run();
  const onCode = () => editor.chain().focus().toggleCode().run();
  const onStrike = () => editor.chain().focus().toggleStrike().run();
  const openLinkInspector = (forceIcon = false) => {
    setColorPickerOpen(false);
    setAssetPickerOpen(false);
    setLinkDraft(draftFromEditor(editor, forceIcon));
    setLinkInspectorOpen(true);
  };
  const closeLinkInspector = () => {
    setLinkInspectorOpen(false);
    setAssetPickerOpen(false);
    if (initialLinkMode) onClose();
  };
  const onLink = () => openLinkInspector(false);
  const onIconLink = () => openLinkInspector(true);
  const applyLinkDraft = () => {
    const href = linkDraft.href.trim();
    const label = linkDraft.text || currentSelectionOrLinkText(editor) || href;
    if (!href) {
      editor.chain().focus().extendMarkRange("link").unsetLink().unsetInlineLinkStyle().run();
      closeLinkInspector();
      return;
    }

    const baseMarks = textMarkNamesForEditor(editor).map((type) => ({ type }));
    const marks = [
      ...baseMarks,
      { type: "link", attrs: { href } },
      ...(linkDraft.iconMode
        ? [
            {
              type: "inlineLinkStyle",
              attrs: {
                icon: linkDraft.iconUrl.trim() || null,
                style: "icon",
              },
            },
          ]
        : []),
    ];
    const range = currentLinkRange(editor);
    const selection = editor.state.selection;
    const shouldReplaceText =
      Boolean(label) &&
      ((!selection.empty && label !== currentSelectionOrLinkText(editor)) ||
        (selection.empty && !range));

    if (shouldReplaceText) {
      editor
        .chain()
        .focus()
        .insertContent({
          type: "text",
          text: label,
          marks,
        })
        .run();
    } else if (selection.empty && range && label !== currentSelectionOrLinkText(editor)) {
      editor
        .chain()
        .focus()
        .insertContentAt(range, {
          type: "text",
          text: label,
          marks,
        })
        .run();
    } else {
      const chain = editor.chain().focus().extendMarkRange("link").setLink({ href });
      if (linkDraft.iconMode) {
        chain.setInlineLinkStyle({
          icon: linkDraft.iconUrl.trim() || null,
          style: "icon",
        });
      } else {
        chain.unsetInlineLinkStyle();
      }
      chain.run();
    }
    closeLinkInspector();
  };
  const clearLink = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().unsetInlineLinkStyle().run();
    setLinkDraft({ href: "", iconMode: false, iconUrl: "", text: "" });
    closeLinkInspector();
  };
  const onUploadIcon = () => {
    setLinkDraft((draft) => ({ ...draft, iconMode: true }));
    iconFileInputRef.current?.click();
  };
  const chooseKnownIcon = (entry: IconLinkRegistryEntry) => {
    setLinkDraft((draft) => ({
      ...draft,
      iconMode: true,
      iconUrl: entry.asset,
    }));
  };
  const onIconFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    setUploadingIcon(true);
    const result = await uploadImageFile({
      file,
      request: (path, method, body) => request(path, method, body),
    });
    setUploadingIcon(false);
    if (!result.ok) {
      setMessage("error", `Icon upload failed: ${result.error}`);
      return;
    }
    rememberRecentAsset(result.asset, result.filename);
    setLinkDraft((draft) => ({
      ...draft,
      iconMode: true,
      iconUrl: result.asset.url,
    }));
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

  const detectedIcon = findIconLinkEntryForHref(linkDraft.href);

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
          Link
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
        <input
          ref={iconFileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif"
          className="mdx-document-hidden-file-input"
          tabIndex={-1}
          onChange={onIconFileChange}
        />
        {linkInspectorOpen ? (
          <LinkInspectorPanel
            assetPickerOpen={assetPickerOpen}
            detectedIcon={detectedIcon}
            draft={linkDraft}
            onApply={applyLinkDraft}
            onAssetPick={() => setAssetPickerOpen((open) => !open)}
            onClear={clearLink}
            onClose={closeLinkInspector}
            onDraftChange={setLinkDraft}
            onKnownIcon={chooseKnownIcon}
            onUploadIcon={onUploadIcon}
            preserveSelection={preserve}
            uploadingIcon={uploadingIcon}
          />
        ) : null}
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

interface LinkInspectorPanelProps {
  assetPickerOpen: boolean;
  detectedIcon: IconLinkRegistryEntry | null;
  draft: LinkDraft;
  onApply: () => void;
  onAssetPick: () => void;
  onClear: () => void;
  onClose: () => void;
  onDraftChange: Dispatch<SetStateAction<LinkDraft>>;
  onKnownIcon: (entry: IconLinkRegistryEntry) => void;
  onUploadIcon: () => void;
  preserveSelection: (event: ReactMouseEvent) => void;
  uploadingIcon: boolean;
}

function iconPreviewStyle(url: string): { backgroundImage?: string } {
  const trimmed = url.trim();
  return trimmed ? { backgroundImage: `url(${trimmed})` } : {};
}

function shouldAllowFormFocus(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select"));
}

function LinkInspectorPanel({
  assetPickerOpen,
  detectedIcon,
  draft,
  onApply,
  onAssetPick,
  onClear,
  onClose,
  onDraftChange,
  onKnownIcon,
  onUploadIcon,
  preserveSelection,
  uploadingIcon,
}: LinkInspectorPanelProps) {
  const customIconUrl = draft.iconUrl.trim();
  const previewIcon = customIconUrl || detectedIcon?.asset || "";
  const preserveInspectorClick = (event: ReactMouseEvent) => {
    if (shouldAllowFormFocus(event.target)) return;
    preserveSelection(event);
  };
  return (
    <div
      className="mdx-link-inspector"
      role="dialog"
      aria-label="Link inspector"
      onMouseDown={preserveInspectorClick}
    >
      <div className="mdx-link-inspector__head">
        <strong>Link</strong>
        <button type="button" onClick={onClose} aria-label="Close link inspector">
          ×
        </button>
      </div>

      <label className="mdx-link-inspector__field">
        <span>Text</span>
        <input
          value={draft.text}
          placeholder="Selected text"
          onChange={(event) =>
            onDraftChange((current) => ({ ...current, text: event.target.value }))
          }
        />
      </label>

      <label className="mdx-link-inspector__field">
        <span>URL</span>
        <input
          value={draft.href}
          placeholder="https:// or /internal-path"
          onChange={(event) =>
            onDraftChange((current) => ({ ...current, href: event.target.value }))
          }
        />
      </label>

      <div className="mdx-link-inspector__style-row" role="group" aria-label="Link style">
        <button
          type="button"
          className="mdx-link-inspector__seg"
          data-active={!draft.iconMode || undefined}
          onClick={() =>
            onDraftChange((current) => ({ ...current, iconMode: false, iconUrl: "" }))
          }
        >
          Regular
        </button>
        <button
          type="button"
          className="mdx-link-inspector__seg"
          data-active={draft.iconMode || undefined}
          onClick={() => onDraftChange((current) => ({ ...current, iconMode: true }))}
        >
          Icon link
        </button>
      </div>

      {draft.iconMode ? (
        <div className="mdx-link-inspector__icon-panel">
          <div className="mdx-link-inspector__icon-preview">
            <span
              className="mdx-link-inspector__icon-chip"
              style={iconPreviewStyle(previewIcon)}
              aria-hidden="true"
            />
            <div>
              <strong>{customIconUrl ? "Custom icon" : detectedIcon?.label || "Generic icon"}</strong>
              <span>
                {customIconUrl
                  ? customIconUrl
                  : detectedIcon
                    ? "Detected from URL"
                    : "No known icon match"}
              </span>
            </div>
          </div>

          <label className="mdx-link-inspector__field">
            <span>Custom icon URL</span>
            <input
              value={draft.iconUrl}
              placeholder={detectedIcon ? detectedIcon.asset : "/uploads/icon.svg"}
              onChange={(event) =>
                onDraftChange((current) => ({
                  ...current,
                  iconMode: true,
                  iconUrl: event.target.value,
                }))
              }
            />
          </label>

          <div className="mdx-link-inspector__icon-actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() =>
                onDraftChange((current) => ({
                  ...current,
                  iconMode: true,
                  iconUrl: "",
                }))
              }
            >
              Use auto
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onAssetPick}
            >
              {assetPickerOpen ? "Hide assets" : "Pick asset"}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onUploadIcon}
              disabled={uploadingIcon}
            >
              {uploadingIcon ? "Uploading…" : "Upload"}
            </button>
          </div>

          <div className="mdx-link-inspector__known-icons">
            {ICON_LINK_REGISTRY.map((entry) => (
              <button
                type="button"
                key={entry.id}
                title={entry.label}
                onClick={() => onKnownIcon(entry)}
                data-active={draft.iconUrl === entry.asset || undefined}
              >
                <span
                  className="mdx-link-inspector__known-icon"
                  style={iconPreviewStyle(entry.asset)}
                  aria-hidden="true"
                />
                <span>{entry.label}</span>
              </button>
            ))}
          </div>

          {assetPickerOpen ? (
            <AssetLibraryPicker
              currentUrl={draft.iconUrl}
              onSelect={(asset) => {
                onDraftChange((current) => ({
                  ...current,
                  iconMode: true,
                  iconUrl: asset.url,
                }));
              }}
            />
          ) : null}
        </div>
      ) : null}

      <div className="mdx-link-inspector__actions">
        <button type="button" className="btn btn--ghost" onClick={onClear}>
          Remove link
        </button>
        <button type="button" className="btn btn--primary" onClick={onApply}>
          Apply
        </button>
      </div>
    </div>
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
