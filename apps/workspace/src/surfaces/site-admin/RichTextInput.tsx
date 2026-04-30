// TipTap-backed inline-markdown editor. Drop-in replacement for `<textarea>`
// in text-bearing blocks (paragraph for now; heading/quote/callout in later
// phases). Renders **bold**, *italic*, `code`, ~~strike~~ and [links](url)
// inline so the user sees formatted text instead of raw markdown chars.
//
// Contract:
//
// - `value` is markdown — exactly what gets persisted on `block.text`. The
//   editor parses it into a ProseMirror doc on mount and re-parses if the
//   prop changes externally (draft restore, source-mode edit, etc.).
//
// - `onChange(next)` fires on every mutation with the editor's current doc
//   re-serialized to markdown, so the round-trip stays inside this module.
//
// - `onKeyDown(event)` forwards every keystroke BEFORE TipTap handles it,
//   so the parent block can intercept Enter / Backspace-at-empty / Cmd+
//   shortcuts. Calling `event.preventDefault()` blocks TipTap's default.
//
// - The imperative ref handle exposes `focus()`, `getEditor()`, and a few
//   selection helpers the parent uses to anchor format toolbars and mention
//   pickers — equivalent to the bits of the textarea API we depended on.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";

import {
  INLINE_MARKDOWN_PARSE_OPTIONS,
  inlineMarkdownToHtml,
  tiptapDocToMarkdown,
} from "./markdown-inline";
import { createRichTextExtensions } from "./rich-text-extensions";
import { openExternalUrl } from "../../lib/tauri";
import { handleEditorLinkClick } from "./link-click";

export interface RichTextInputHandle {
  /** Focus the contenteditable + place caret at end (or current selection
   * if it has one). Used after slash-menu / mention picker selections. */
  focus(): void;
  /** Returns the underlying TipTap editor for parent components that need
   * to dispatch commands (toggleBold, setLink, etc.) or read selection. */
  getEditor(): Editor | null;
  /** Returns true when the visible plain text is empty — used to drive the
   * placeholder overlay and the Backspace-at-empty merge behavior. */
  isEmpty(): boolean;
  /** Plain text projection (no markdown chars). Useful for slash-command
   * detection: `getText().startsWith("/")`. */
  getText(): string;
}

export interface RichTextInputProps {
  value: string;
  onChange: (next: string) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  onPaste?: (event: ClipboardEvent) => boolean | void;
  onFocus?: (event: FocusEvent) => void;
  onBlur?: (event: FocusEvent) => void;
  /** Fires whenever the underlying TipTap editor becomes available (or
   * is destroyed on unmount). Lets the parent depend on the editor as
   * reactive state — e.g. to subscribe to selectionUpdate so the inline
   * format toolbar can anchor to the live caret. The imperative ref's
   * `getEditor()` returns the same instance but isn't reactive, so a
   * `useEffect([])` against it would race the editor's mount and miss
   * the subscription. */
  onEditorReady?: (editor: Editor | null) => void;
  /** Forwarded to the contenteditable node. Default `mdx-document-text-block`
   * so the same CSS rules the textarea relied on still apply. Add per-type
   * variant classes via the parent (e.g. `mdx-document-text-block--paragraph`). */
  className?: string;
  ariaLabel?: string;
  readOnly?: boolean;
  /** Placeholder shown via CSS `[data-placeholder]` when the editor is
   * empty. The component sets the data-attr; the parent's CSS owns the look
   * (see InlineRichText placeholder rule in index.css). */
  placeholder?: string;
}

export const RichTextInput = forwardRef<RichTextInputHandle, RichTextInputProps>(
  function RichTextInput(
    {
      value,
      onChange,
      onKeyDown,
      onPaste,
      onFocus,
      onBlur,
      onEditorReady,
      className,
      ariaLabel,
      readOnly = false,
      placeholder,
    },
    ref,
  ) {
    // Track the markdown we last emitted so the value-sync effect below can
    // distinguish a "parent caught up to us" prop update from a real
    // external change. Without this guard, every onChange would round-trip
    // back through setContent and steal the cursor mid-keystroke.
    const lastEmittedRef = useRef(value);

    const extensions = useMemo(
      () => createRichTextExtensions({ placeholder }),
      [placeholder],
    );

    const editor = useEditor({
      extensions,
      content: inlineMarkdownToHtml(value),
      editable: !readOnly,
      parseOptions: INLINE_MARKDOWN_PARSE_OPTIONS,
      // Each EditorContent renders inside a contenteditable. We hand ProseMirror
      // an explicit class on its host element so existing block CSS still
      // applies. ariaLabel goes on the contenteditable for screen readers.
      editorProps: {
        attributes: {
          class: className ?? "mdx-document-text-block",
          "aria-label": ariaLabel ?? "",
        },
        handleKeyDown: (_view, event) => {
          if (!onKeyDown) return false;
          // Wrap into a synthetic-like KeyboardEvent so the parent's typed
          // handler (which expects React's KeyboardEvent) can introspect
          // .key / .metaKey / .preventDefault uniformly. The DOM event has
          // the same surface we read in handlers.
          onKeyDown(event as unknown as KeyboardEvent);
          return event.defaultPrevented;
        },
        handlePaste: (_view, event) => {
          if (!onPaste) return false;
          const handled = onPaste(event);
          return Boolean(handled) || event.defaultPrevented;
        },
        handleClick: (_view, _pos, event) =>
          // Tauri's webview ignores `<a target="_blank">`, and TipTap's
          // Link extension is configured with `openOnClick: false` so a
          // plain click can still place the caret inside link text.
          // The extracted helper handles the modifier-click intercept
          // — see link-click.ts for the contract + tests.
          handleEditorLinkClick(event, { openExternalUrl }),
      },
      onUpdate: ({ editor: ed }) => {
        const md = tiptapDocToMarkdown(ed.getJSON());
        lastEmittedRef.current = md;
        onChange(md);
      },
    });

    // External value sync. Fires when the parent passes a `value` that
    // differs from what we just emitted — e.g. the user restored a draft,
    // switched to source mode and back, or the slash menu replaced the
    // block's text. `setContent(..., false)` skips firing onUpdate so we
    // don't re-emit and trigger an infinite loop.
    useEffect(() => {
      if (!editor) return;
      if (value === lastEmittedRef.current) return;
      lastEmittedRef.current = value;
      // Second arg `false` skips firing onUpdate so we don't re-emit and
      // trigger an infinite loop. (TipTap v2 signature:
      // setContent(content, emitUpdate?, parseOptions?))
      editor.commands.setContent(
        inlineMarkdownToHtml(value),
        false,
        INLINE_MARKDOWN_PARSE_OPTIONS,
      );
    }, [editor, value]);

    useEffect(() => {
      editor?.setEditable(!readOnly);
    }, [editor, readOnly]);

    // Fire onEditorReady when the editor becomes available (or is
    // destroyed). The imperative-ref `getEditor()` would also work but
    // isn't reactive — a parent's useEffect against it can race the
    // initial mount and never re-run. Pushing the editor up via a
    // callback gives the parent a real piece of state to depend on.
    useEffect(() => {
      onEditorReady?.(editor ?? null);
      return () => onEditorReady?.(null);
    }, [editor, onEditorReady]);

    // Imperative handle. Most parent operations route through getEditor()
    // — focus + isEmpty are common enough to ship as conveniences.
    useImperativeHandle(
      ref,
      () => ({
        focus() {
          editor?.commands.focus("end");
        },
        getEditor() {
          return editor ?? null;
        },
        isEmpty() {
          return editor?.isEmpty ?? true;
        },
        getText() {
          return editor?.getText() ?? "";
        },
      }),
      [editor],
    );

    return (
      <EditorContent
        editor={editor}
        onFocus={onFocus}
        onBlur={onBlur}
      />
    );
  },
);
