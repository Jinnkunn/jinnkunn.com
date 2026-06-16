"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import styles from "./site-admin-dashboard.module.css";

type MarkdownEditorSize = "regular" | "compact" | "large";
type MarkdownPreviewLayout = "tabs" | "split";

type MarkdownEditorProps = {
  label?: string;
  value: string;
  onChange: (next: string) => void;
  minHeight?: number;
  placeholder?: string;
  size?: MarkdownEditorSize;
  disabled?: boolean;
  previewLayout?: MarkdownPreviewLayout;
};

type MarkdownAction = {
  id: string;
  label: string;
  title: string;
  run: (textarea: HTMLTextAreaElement) => string | null;
};

type MarkdownActionGroup = {
  label: string;
  actions: MarkdownAction[];
};

function selectedRange(textarea: HTMLTextAreaElement) {
  return {
    start: textarea.selectionStart,
    end: textarea.selectionEnd,
    value: textarea.value.slice(textarea.selectionStart, textarea.selectionEnd),
  };
}

function replaceSelection(
  textarea: HTMLTextAreaElement,
  replacement: string,
  caretOffset = replacement.length,
) {
  const { start, end } = selectedRange(textarea);
  const next = `${textarea.value.slice(0, start)}${replacement}${textarea.value.slice(end)}`;
  window.requestAnimationFrame(() => {
    textarea.focus();
    const nextCaret = start + caretOffset;
    textarea.setSelectionRange(nextCaret, nextCaret);
  });
  return next;
}

function wrapSelection(
  textarea: HTMLTextAreaElement,
  before: string,
  after = before,
  fallback = "text",
) {
  const { start, end, value } = selectedRange(textarea);
  const inner = value || fallback;
  const replacement = `${before}${inner}${after}`;
  const next = `${textarea.value.slice(0, start)}${replacement}${textarea.value.slice(end)}`;
  window.requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(start + before.length, start + before.length + inner.length);
  });
  return next;
}

function linePrefixSelection(
  textarea: HTMLTextAreaElement,
  prefix: string,
  fallback = "New line",
) {
  const { value } = selectedRange(textarea);
  if (!value) return replaceSelection(textarea, `${prefix}${fallback}`);
  const nextSelection = value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
  return replaceSelection(textarea, nextSelection, nextSelection.length);
}

function insertBlock(textarea: HTMLTextAreaElement, block: string) {
  const { start } = selectedRange(textarea);
  const before = textarea.value.slice(0, start);
  const needsLeadingBreak = before.length > 0 && !before.endsWith("\n\n");
  const insert = `${needsLeadingBreak ? "\n\n" : ""}${block}`;
  return replaceSelection(textarea, insert, insert.length);
}

const markdownActionGroups: MarkdownActionGroup[] = [
  {
    label: "Inline formatting",
    actions: [
      {
        id: "bold",
        label: "B",
        title: "Bold",
        run: (textarea) => wrapSelection(textarea, "**", "**", "bold text"),
      },
      {
        id: "italic",
        label: "I",
        title: "Italic",
        run: (textarea) => wrapSelection(textarea, "*", "*", "italic text"),
      },
      {
        id: "inline-code",
        label: "`",
        title: "Inline code",
        run: (textarea) => wrapSelection(textarea, "`", "`", "code"),
      },
      {
        id: "link",
        label: "Link",
        title: "Link",
        run: (textarea) => wrapSelection(textarea, "[", "](https://)", "link text"),
      },
    ],
  },
  {
    label: "Block formatting",
    actions: [
      {
        id: "heading-2",
        label: "H2",
        title: "Heading 2",
        run: (textarea) => linePrefixSelection(textarea, "## ", "Heading"),
      },
      {
        id: "heading-3",
        label: "H3",
        title: "Heading 3",
        run: (textarea) => linePrefixSelection(textarea, "### ", "Heading"),
      },
      {
        id: "bullet-list",
        label: "UL",
        title: "Bullet list",
        run: (textarea) => linePrefixSelection(textarea, "- ", "List item"),
      },
      {
        id: "quote",
        label: ">",
        title: "Quote",
        run: (textarea) => linePrefixSelection(textarea, "> ", "Quote"),
      },
    ],
  },
  {
    label: "Insert blocks",
    actions: [
      {
        id: "divider",
        label: "HR",
        title: "Divider",
        run: (textarea) => insertBlock(textarea, "---\n\n"),
      },
      {
        id: "code-block",
        label: "{}",
        title: "Code block",
        run: (textarea) => insertBlock(textarea, "```\ncode\n```\n\n"),
      },
    ],
  },
];

export function SiteAdminMarkdownEditor({
  label = "MDX editor",
  value,
  onChange,
  minHeight = 420,
  placeholder,
  size = "regular",
  disabled = false,
  previewLayout = "tabs",
}: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previewRequestIdRef = useRef(0);
  const [mode, setMode] = useState<"source" | "preview">("source");
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

  const isSplitPreview = previewLayout === "split";

  const renderPreview = useCallback(async () => {
    const requestId = previewRequestIdRef.current + 1;
    previewRequestIdRef.current = requestId;
    setPreviewLoading(true);
    setPreviewError("");
    try {
      const response = await fetch("/api/site-admin/preview/mdx", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ source: value }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || `${response.status} ${response.statusText}`);
      }
      if (previewRequestIdRef.current !== requestId) return;
      setPreviewHtml(String(payload?.data?.html || payload?.html || ""));
    } catch (error: unknown) {
      if (previewRequestIdRef.current !== requestId) return;
      setPreviewHtml("");
      setPreviewError(error instanceof Error ? error.message : String(error));
    } finally {
      if (previewRequestIdRef.current === requestId) setPreviewLoading(false);
    }
  }, [value]);

  useEffect(() => {
    if (!isSplitPreview) return;
    const timer = window.setTimeout(() => {
      void renderPreview();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [isSplitPreview, renderPreview]);

  function applyAction(action: MarkdownAction) {
    const textarea = textareaRef.current;
    if (!textarea || disabled) return;
    const next = action.run(textarea);
    if (next !== null) onChange(next);
  }

  function renderPreviewPane() {
    return (
      <div className={styles.markdownPreviewShell} style={{ minHeight }}>
        {previewLoading ? (
          <p className={styles.previewEmpty}>Rendering preview…</p>
        ) : previewError ? (
          <p className={styles.previewEmpty}>Preview unavailable: {previewError}</p>
        ) : previewHtml.trim() ? (
          <div
            className={styles.markdownPreview}
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        ) : (
          <p className={styles.previewEmpty}>Nothing to preview yet.</p>
        )}
      </div>
    );
  }

  return (
    <div className={styles.markdownEditor} data-size={size} data-layout={previewLayout}>
      <div className={styles.markdownToolbar} role="toolbar" aria-label={`${label} toolbar`}>
        <div className={styles.markdownToolbarGroup} aria-label="Formatting tools">
          {markdownActionGroups.map((group) => (
            <div
              key={group.label}
              className={styles.markdownToolbarCluster}
              role="group"
              aria-label={group.label}
            >
              {group.actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className={styles.markdownToolButton}
                  title={action.title}
                  aria-label={action.title}
                  onClick={() => applyAction(action)}
                  disabled={disabled || (!isSplitPreview && mode === "preview")}
                >
                  {action.label}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className={styles.markdownToolbarCluster} role="group" aria-label="Editor view">
          {isSplitPreview ? (
            <button
              type="button"
              className={styles.markdownModeButton}
              onClick={() => void renderPreview()}
              disabled={previewLoading}
              title="Refresh preview"
            >
              {previewLoading ? "Previewing" : "Refresh"}
            </button>
          ) : (
            (["source", "preview"] as const).map((nextMode) => (
              <button
                key={nextMode}
                type="button"
                className={styles.markdownModeButton}
                data-active={mode === nextMode}
                onClick={() => {
                  setMode(nextMode);
                  if (nextMode === "preview") void renderPreview();
                }}
              >
                {nextMode === "source" ? "Source" : "Preview"}
              </button>
            ))
          )}
        </div>
      </div>

      {isSplitPreview ? (
        <div className={styles.markdownSplit}>
          <textarea
            ref={textareaRef}
            className={styles.markdownTextarea}
            aria-label={label}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            spellCheck={false}
            disabled={disabled}
            style={{ minHeight }}
          />
          {renderPreviewPane()}
        </div>
      ) : mode === "source" ? (
        <textarea
          ref={textareaRef}
          className={styles.markdownTextarea}
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          disabled={disabled}
          style={{ minHeight }}
        />
      ) : (
        renderPreviewPane()
      )}
    </div>
  );
}
