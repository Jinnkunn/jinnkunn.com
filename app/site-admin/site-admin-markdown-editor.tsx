"use client";

import { useMemo, useRef, useState } from "react";

import styles from "./site-admin-dashboard.module.css";

type MarkdownEditorSize = "regular" | "compact" | "large";

type MarkdownEditorProps = {
  label?: string;
  value: string;
  onChange: (next: string) => void;
  minHeight?: number;
  placeholder?: string;
  size?: MarkdownEditorSize;
  disabled?: boolean;
};

type MarkdownAction = {
  label: string;
  title: string;
  run: (textarea: HTMLTextAreaElement) => string | null;
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

function stripFrontmatter(source: string) {
  const match = /^---\n[\s\S]*?\n---\n?/.exec(source);
  return match ? source.slice(match[0].length) : source;
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, index) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (/^`[^`]+`$/.test(part)) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      return (
        <a key={index} href={link[2]} target="_blank" rel="noreferrer">
          {link[1]}
        </a>
      );
    }
    return part;
  });
}

function MarkdownPreview({ source }: { source: string }) {
  const blocks = useMemo(() => {
    const body = stripFrontmatter(source).trim();
    if (!body) return [];
    return body.split(/\n{2,}/).map((block) => block.trim());
  }, [source]);

  if (blocks.length === 0) {
    return <p className={styles.previewEmpty}>Nothing to preview yet.</p>;
  }

  return (
    <div className={styles.markdownPreview}>
      {blocks.map((block, index) => {
        if (/^```/.test(block)) {
          const code = block.replace(/^```[a-zA-Z0-9_-]*\n?/, "").replace(/\n?```$/, "");
          return <pre key={index}>{code}</pre>;
        }
        if (/^---+$/.test(block)) {
          return <hr key={index} />;
        }
        const heading = /^(#{1,3})\s+(.+)$/.exec(block);
        if (heading) {
          const level = heading[1].length;
          if (level === 1) return <h1 key={index}>{renderInline(heading[2])}</h1>;
          if (level === 2) return <h2 key={index}>{renderInline(heading[2])}</h2>;
          return <h3 key={index}>{renderInline(heading[2])}</h3>;
        }
        if (block.startsWith("> ")) {
          return <blockquote key={index}>{renderInline(block.replace(/^>\s?/gm, ""))}</blockquote>;
        }
        if (/^- /.test(block)) {
          return (
            <ul key={index}>
              {block.split("\n").map((line, itemIndex) => (
                <li key={itemIndex}>{renderInline(line.replace(/^- /, ""))}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{renderInline(block)}</p>;
      })}
    </div>
  );
}

const markdownActions: MarkdownAction[] = [
  {
    label: "B",
    title: "Bold",
    run: (textarea) => wrapSelection(textarea, "**", "**", "bold text"),
  },
  {
    label: "I",
    title: "Italic",
    run: (textarea) => wrapSelection(textarea, "*", "*", "italic text"),
  },
  {
    label: "`",
    title: "Inline code",
    run: (textarea) => wrapSelection(textarea, "`", "`", "code"),
  },
  {
    label: "H2",
    title: "Heading 2",
    run: (textarea) => linePrefixSelection(textarea, "## ", "Heading"),
  },
  {
    label: "H3",
    title: "Heading 3",
    run: (textarea) => linePrefixSelection(textarea, "### ", "Heading"),
  },
  {
    label: "List",
    title: "Bullet list",
    run: (textarea) => linePrefixSelection(textarea, "- ", "List item"),
  },
  {
    label: ">",
    title: "Quote",
    run: (textarea) => linePrefixSelection(textarea, "> ", "Quote"),
  },
  {
    label: "Link",
    title: "Link",
    run: (textarea) => wrapSelection(textarea, "[", "](https://)", "link text"),
  },
  {
    label: "HR",
    title: "Divider",
    run: (textarea) => insertBlock(textarea, "---\n\n"),
  },
  {
    label: "{}",
    title: "Code block",
    run: (textarea) => insertBlock(textarea, "```\ncode\n```\n\n"),
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
}: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [mode, setMode] = useState<"source" | "preview">("source");

  function applyAction(action: MarkdownAction) {
    const textarea = textareaRef.current;
    if (!textarea || disabled) return;
    const next = action.run(textarea);
    if (next !== null) onChange(next);
  }

  return (
    <div className={styles.markdownEditor} data-size={size}>
      <div className={styles.markdownToolbar} role="toolbar" aria-label={`${label} toolbar`}>
        <div className={styles.markdownToolbarGroup}>
          {markdownActions.map((action) => (
            <button
              key={action.title}
              type="button"
              title={action.title}
              aria-label={action.title}
              onClick={() => applyAction(action)}
              disabled={disabled || mode === "preview"}
            >
              {action.label}
            </button>
          ))}
        </div>
        <div className={styles.markdownToolbarGroup}>
          {(["source", "preview"] as const).map((nextMode) => (
            <button
              key={nextMode}
              type="button"
              data-active={mode === nextMode}
              onClick={() => setMode(nextMode)}
            >
              {nextMode === "source" ? "Source" : "Preview"}
            </button>
          ))}
        </div>
      </div>

      {mode === "source" ? (
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
        <div className={styles.markdownPreviewShell} style={{ minHeight }}>
          <MarkdownPreview source={value} />
        </div>
      )}
    </div>
  );
}
