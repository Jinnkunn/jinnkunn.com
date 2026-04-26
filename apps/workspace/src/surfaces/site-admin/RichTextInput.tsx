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
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";

import { InlineColor } from "./inline-color-mark";
import { inlineMarkdownToHtml, tiptapDocToMarkdown } from "./markdown-inline";

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
  onFocus?: (event: FocusEvent) => void;
  onBlur?: (event: FocusEvent) => void;
  /** Forwarded to the contenteditable node. Default `mdx-document-text-block`
   * so the same CSS rules the textarea relied on still apply. Add per-type
   * variant classes via the parent (e.g. `mdx-document-text-block--paragraph`). */
  className?: string;
  ariaLabel?: string;
  /** Placeholder shown via CSS `[data-placeholder]` when the editor is
   * empty. The component sets the data-attr; the parent's CSS owns the look
   * (see InlineRichText placeholder rule in index.css). */
  placeholder?: string;
}

export const RichTextInput = forwardRef<RichTextInputHandle, RichTextInputProps>(
  function RichTextInput(
    { value, onChange, onKeyDown, onFocus, onBlur, className, ariaLabel, placeholder },
    ref,
  ) {
    // Track the markdown we last emitted so the value-sync effect below can
    // distinguish a "parent caught up to us" prop update from a real
    // external change. Without this guard, every onChange would round-trip
    // back through setContent and steal the cursor mid-keystroke.
    const lastEmittedRef = useRef(value);

    // Memoize the extension list. Disable everything in StarterKit that
    // implies block-level structure (headings, lists, blockquotes, code
    // blocks) — those are owned by the MdxBlock model. We keep just the
    // inline marks plus history + hardbreak.
    const extensions = useMemo(
      () => [
        StarterKit.configure({
          heading: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          blockquote: false,
          codeBlock: false,
          horizontalRule: false,
        }),
        Link.configure({
          openOnClick: false,
          autolink: false,
          // Allow the contenteditable to render `<a href="...">` for marks
          // without auto-converting bare URLs in the user's text — the user
          // explicitly asks for links via Cmd+K or by pasting a markdown
          // link, so autolink would surprise more than help.
          HTMLAttributes: { rel: "noreferrer noopener" },
        }),
        // Underline is the only common inline mark StarterKit doesn't
        // bundle — markdown has no `**`-style syntax for it, so we
        // round-trip via literal `<u>` HTML tags in the markdown source.
        Underline,
        // Inline color (foreground + background tint), matching the
        // Notion selection-toolbar "Color" entry. Round-trips via
        // `<span data-color="..." data-bg="...">` inline HTML.
        InlineColor,
        // The extension adds an `is-editor-empty` class on the empty <p>
        // node when the doc has no content; CSS keys off it to render the
        // placeholder string we pass in via the `placeholder` prop.
        Placeholder.configure({
          placeholder: ({ editor: ed }) => (ed.isEmpty ? placeholder ?? "" : ""),
          showOnlyWhenEditable: true,
          showOnlyCurrent: false,
        }),
      ],
      [placeholder],
    );

    const editor = useEditor({
      extensions,
      content: inlineMarkdownToHtml(value),
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      editor.commands.setContent(inlineMarkdownToHtml(value), false);
    }, [editor, value]);

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
