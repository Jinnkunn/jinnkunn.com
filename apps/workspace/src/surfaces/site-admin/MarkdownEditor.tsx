import { useCallback, useMemo, useRef } from "react";
import type { DragEvent } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView, keymap } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { Prec, type EditorState } from "@codemirror/state";

import {
  insertCodeBlock,
  insertDivider,
  insertLink,
  removeSlashThen,
  setHeadingLevel,
  slashCommands,
  toggleLinePrefix,
  wrapSelection,
} from "./markdown-editor-commands";
import { MarkdownEditorToolbar } from "./MarkdownEditorToolbar";
import { useTheme } from "../../shell/useTheme";

export interface MarkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  placeholder?: string;
  minHeight?: number;
  disabled?: boolean;
  /** Show the formatting toolbar above the editor. Defaults to true. */
  showToolbar?: boolean;
  /** Expose editor actions (bold/italic/insert/…) so callers can drive the
   * editor imperatively (image upload, etc.). */
  onReady?: (api: MarkdownEditorApi) => void;
}

/** Imperative surface exposed to the rest of the site-admin UI. All methods
 * operate on the underlying CodeMirror EditorView so edits integrate with its
 * undo/redo history. */
export interface MarkdownEditorApi {
  insertAtCursor(snippet: string): void;
  wrapSelection(prefix: string, suffix?: string): void;
  toggleLinePrefix(prefix: string): void;
  setHeadingLevel(level: 1 | 2 | 3 | 4 | 5 | 6): void;
  insertCodeBlock(lang?: string): void;
  insertLink(): void;
  insertDivider(): void;
  focus(): void;
}

function lineSliceUpToPos(state: EditorState, pos: number): string {
  const line = state.doc.lineAt(pos);
  return line.text.slice(0, pos - line.from);
}

const markdownLightTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--color-bg-surface)",
      color: "var(--color-text-primary)",
    },
    ".cm-content": {
      caretColor: "var(--color-accent)",
    },
    ".cm-cursor": {
      borderLeftColor: "var(--color-accent)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "color-mix(in srgb, var(--color-accent) 24%, transparent)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--color-bg-surface-alt)",
      color: "var(--color-text-muted)",
      borderRight: "1px solid var(--color-border-subtle)",
    },
    ".cm-activeLine": {
      backgroundColor: "color-mix(in srgb, var(--color-accent) 7%, transparent)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "color-mix(in srgb, var(--color-accent) 9%, transparent)",
      color: "var(--color-text-primary)",
    },
    ".cm-placeholder": {
      color: "var(--color-text-muted)",
    },
  },
  { dark: false },
);

export function MarkdownEditor({
  value,
  onChange,
  onDrop,
  placeholder,
  minHeight = 360,
  disabled = false,
  showToolbar = true,
  onReady,
}: MarkdownEditorProps) {
  const { resolved } = useTheme();
  const cmRef = useRef<ReactCodeMirrorRef | null>(null);
  const apiRef = useRef<MarkdownEditorApi | null>(null);

  const extensions = useMemo(() => {
    const slash = slashCommands();
    const slashCompletions: Completion[] = slash.map((cmd) => ({
      label: `/${cmd.label}`,
      type: "keyword",
      detail: cmd.detail,
      apply(view: EditorView) {
        removeSlashThen(view, cmd.run);
      },
    }));
    const slashSource = (context: CompletionContext): CompletionResult | null => {
      const line = lineSliceUpToPos(context.state, context.pos);
      // Only trigger when the current line starts with `/` and has no spaces
      // between `/` and the caret — that's our "slash mode" heuristic.
      const match = /(^|\s)(\/[A-Za-z0-9_-]*)$/.exec(line);
      if (!match) return null;
      const from = context.pos - match[2].length;
      return {
        from,
        to: context.pos,
        options: slashCompletions,
        validFor: /^\/[A-Za-z0-9_-]*$/,
      };
    };

    const keymapBindings = keymap.of([
      {
        key: "Mod-b",
        run: (view) => {
          wrapSelection(view, "**");
          return true;
        },
      },
      {
        key: "Mod-i",
        run: (view) => {
          wrapSelection(view, "*");
          return true;
        },
      },
      {
        key: "Mod-`",
        run: (view) => {
          wrapSelection(view, "`");
          return true;
        },
      },
      {
        key: "Mod-k",
        run: (view) => {
          insertLink(view);
          return true;
        },
      },
      {
        key: "Mod-Shift-k",
        run: (view) => {
          insertCodeBlock(view, "ts");
          return true;
        },
      },
      {
        key: "Mod-1",
        run: (view) => {
          setHeadingLevel(view, 1);
          return true;
        },
      },
      {
        key: "Mod-2",
        run: (view) => {
          setHeadingLevel(view, 2);
          return true;
        },
      },
      {
        key: "Mod-3",
        run: (view) => {
          setHeadingLevel(view, 3);
          return true;
        },
      },
      {
        key: "Mod-Shift-.",
        run: (view) => {
          toggleLinePrefix(view, "> ");
          return true;
        },
      },
      {
        key: "Mod-Shift-8",
        run: (view) => {
          toggleLinePrefix(view, "- ");
          return true;
        },
      },
    ]);

    return [
      markdown(),
      EditorView.lineWrapping,
      autocompletion({
        override: [slashSource],
        activateOnTyping: true,
        defaultKeymap: true,
      }),
      Prec.high(keymapBindings),
      EditorView.theme({
        "&": { fontSize: "13px", minHeight: `${minHeight}px` },
        ".cm-scroller": {
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, 'Cascadia Mono', Consolas, monospace",
          lineHeight: "1.55",
          minHeight: `${minHeight}px`,
        },
      }),
    ];
  }, [minHeight]);

  const handleCreateEditor = useCallback(
    (view: EditorView) => {
      const api: MarkdownEditorApi = {
        insertAtCursor(snippet: string) {
          const selection = view.state.selection.main;
          view.dispatch({
            changes: { from: selection.from, to: selection.to, insert: snippet },
            selection: { anchor: selection.from + snippet.length },
          });
          view.focus();
        },
        wrapSelection(prefix: string, suffix?: string) {
          wrapSelection(view, prefix, suffix ?? prefix);
        },
        toggleLinePrefix(prefix: string) {
          toggleLinePrefix(view, prefix);
        },
        setHeadingLevel(level) {
          setHeadingLevel(view, level);
        },
        insertCodeBlock(lang = "") {
          insertCodeBlock(view, lang);
        },
        insertLink() {
          insertLink(view);
        },
        insertDivider() {
          insertDivider(view);
        },
        focus() {
          view.focus();
        },
      };
      apiRef.current = api;
      onReady?.(api);
    },
    [onReady],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!onDrop) return;
      onDrop(event);
    },
    [onDrop],
  );

  return (
    <div
      className="mdx-editor"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      {showToolbar && <MarkdownEditorToolbar getApi={() => apiRef.current} />}
      <div className="mdx-editor__cm">
        <CodeMirror
          ref={cmRef}
          value={value}
          onChange={onChange}
          extensions={extensions}
          theme={resolved === "dark" ? oneDark : markdownLightTheme}
          placeholder={placeholder}
          readOnly={disabled}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: true,
            highlightActiveLine: true,
            bracketMatching: false,
            foldGutter: false,
            autocompletion: false, // we supply our own above
            // Search keeps CodeMirror's defaults. The editor's high-priority
            // `Mod-k` binding inserts links while the shell palette handles
            // `Mod-k` outside focused editor instances.
            searchKeymap: true,
          }}
          onCreateEditor={handleCreateEditor}
        />
      </div>
    </div>
  );
}
