"use client";

import { basicSetup } from "codemirror";
import { defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder as editorPlaceholder } from "@codemirror/view";
import {
  type ClipboardEvent,
  type DragEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { uploadSiteAdminAsset } from "./site-admin-media-library";
import styles from "./site-admin-dashboard.module.css";

type SiteAdminSourceEditorProps = {
  label: string;
  value: string;
  onChange: (next: string) => void;
  minHeight: number;
  placeholder?: string;
  disabled?: boolean;
  allowImageUpload?: boolean;
};

export function SiteAdminSourceEditor({
  label,
  value,
  onChange,
  minHeight,
  placeholder,
  disabled = false,
  allowImageUpload = true,
}: SiteAdminSourceEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  const [uploadError, setUploadError] = useState("");

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!hostRef.current) return;

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          basicSetup,
          markdown({ base: markdownLanguage }),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorState.readOnly.of(disabled),
          EditorView.editable.of(!disabled),
          EditorView.contentAttributes.of({
            "aria-label": label,
            spellcheck: "false",
          }),
          placeholder ? editorPlaceholder(placeholder) : [],
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const next = update.state.doc.toString();
            valueRef.current = next;
            onChangeRef.current(next);
          }),
          EditorView.theme({
            "&": {
              minHeight: `${minHeight}px`,
              backgroundColor: "transparent",
              color: "var(--ds-text-primary)",
              fontSize: "14px",
            },
            ".cm-scroller": {
              minHeight: `${minHeight}px`,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              lineHeight: "1.62",
              padding: "18px 20px 32px",
            },
            ".cm-content": {
              maxWidth: "88ch",
              margin: "0 auto",
              caretColor: "var(--ds-accent)",
            },
            ".cm-gutters": {
              backgroundColor: "transparent",
              color: "var(--ds-text-faint)",
              border: "0",
            },
            ".cm-activeLine, .cm-activeLineGutter": {
              backgroundColor: "var(--ds-surface-soft)",
            },
            ".cm-selectionBackground, ::selection": {
              backgroundColor: "var(--ds-selection-bg)",
            },
            ".cm-focused": { outline: "none" },
          }),
        ],
      }),
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [disabled, label, minHeight, placeholder]);

  useEffect(() => {
    valueRef.current = value;
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  async function insertImage(file: File) {
    const view = viewRef.current;
    if (!view || disabled || !file.type.startsWith("image/")) return;
    setUploadError("");
    try {
      const asset = await uploadSiteAdminAsset(file);
      const alt = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
      const selection = view.state.selection.main;
      const prefix = selection.from > 0 ? "\n\n" : "";
      const markdownImage = `${prefix}![${alt}](${asset.url})\n\n`;
      view.dispatch({
        changes: {
          from: selection.from,
          to: selection.to,
          insert: markdownImage,
        },
        selection: { anchor: selection.from + markdownImage.length },
        scrollIntoView: true,
      });
      view.focus();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error));
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    if (!allowImageUpload) return;
    const image = Array.from(event.clipboardData.files).find((file) =>
      file.type.startsWith("image/"),
    );
    if (!image) return;
    event.preventDefault();
    void insertImage(image);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!allowImageUpload) return;
    const image = Array.from(event.dataTransfer.files).find((file) =>
      file.type.startsWith("image/"),
    );
    if (!image) return;
    event.preventDefault();
    void insertImage(image);
  }

  return (
    <div className={styles.sourceEditorShell}>
      {uploadError ? (
        <p className={styles.editorInlineError} role="alert">
          Image upload failed: {uploadError}
        </p>
      ) : null}
      <div
        ref={hostRef}
        className={styles.sourceEditor}
        onPasteCapture={handlePaste}
        onDropCapture={handleDrop}
        onDragOver={(event) => event.preventDefault()}
      />
    </div>
  );
}
