import { useCallback, useMemo, useRef } from "react";
import type { DragEvent } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";

export interface MarkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  placeholder?: string;
  minHeight?: number;
  disabled?: boolean;
  /** Expose the current cursor/selection end so callers (image upload) can
   * insert markdown at the caret. */
  onReady?: (api: MarkdownEditorApi) => void;
}

export interface MarkdownEditorApi {
  /** Insert text at the current selection, replacing any selected range. */
  insertAtCursor: (snippet: string) => void;
  /** Focus the editor. */
  focus: () => void;
}

/**
 * Thin wrapper around @uiw/react-codemirror with markdown syntax highlighting
 * and a one-dark theme. Kept dependency-light: no extensions beyond lang +
 * theme. The parent owns drag-drop so image upload / file handling stays
 * consistent with the rest of the editor surface.
 */
export function MarkdownEditor({
  value,
  onChange,
  onDrop,
  placeholder,
  minHeight = 360,
  disabled = false,
  onReady,
}: MarkdownEditorProps) {
  const cmRef = useRef<ReactCodeMirrorRef | null>(null);

  const extensions = useMemo(
    () => [
      markdown(),
      EditorView.lineWrapping,
      EditorView.theme({
        "&": {
          fontSize: "13px",
          minHeight: `${minHeight}px`,
        },
        ".cm-scroller": {
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, 'Cascadia Mono', Consolas, monospace",
          lineHeight: "1.55",
          minHeight: `${minHeight}px`,
        },
      }),
    ],
    [minHeight],
  );

  const handleCreateEditor = useCallback(
    (view: EditorView) => {
      onReady?.({
        insertAtCursor(snippet: string) {
          const selection = view.state.selection.main;
          view.dispatch({
            changes: { from: selection.from, to: selection.to, insert: snippet },
            selection: { anchor: selection.from + snippet.length },
          });
        },
        focus() {
          view.focus();
        },
      });
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
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      style={{
        border: "1px solid var(--border-subtle)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <CodeMirror
        ref={cmRef}
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={oneDark}
        placeholder={placeholder}
        readOnly={disabled}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightActiveLine: true,
          bracketMatching: false,
          foldGutter: false,
          autocompletion: false,
          searchKeymap: true,
        }}
        onCreateEditor={handleCreateEditor}
      />
    </div>
  );
}
