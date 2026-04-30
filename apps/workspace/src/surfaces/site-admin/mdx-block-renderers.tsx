// Per-type editor render branches for MdxBlock. These are the leaf views the
// generic EditableBlock dispatcher (in MdxDocumentEditor.tsx) renders for
// non-text block types (todo, toggle, table, bookmark, embed, file, page-link).
// Toggle nests recursively but receives an EditableBlocksList renderer via
// `renderChildren` so this file does not depend on its parent.

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  createMdxBlock,
  type MdxBlock,
  type MdxEmbedKind,
} from "./mdx-blocks";
import { LinkItemsEditor } from "./LinkItemsEditor";
import { RichTextInput, type RichTextInputHandle } from "./RichTextInput";
import type { NormalizedApiResponse } from "./types";

type RequestFn = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<NormalizedApiResponse>;

export type BlockRendererRequestFn = RequestFn;

function hostLabel(url: string): string {
  if (!url.trim()) return "";
  try {
    return new URL(url, "https://jinkunchen.com").hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// ---------- Todo ----------

export interface TodoEditableBlockProps {
  block: MdxBlock;
  onFocusInput: (
    node: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null,
  ) => void;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  onRemoveEmpty: () => void;
}

function BaseTodoEditableBlock({
  block,
  onFocusInput,
  onPatch,
  onRemoveEmpty,
}: TodoEditableBlockProps) {
  const lines = block.text.split("\n");
  const checked = new Set(block.checkedLines ?? []);
  // One TipTap handle per item — per-line WYSIWYG so each todo entry can
  // carry inline marks (bold/italic/code/links) rather than just plain
  // text. The ref array is sized to `lines.length`; null slots cover gaps
  // before each item mounts.
  const itemRefs = useRef<(RichTextInputHandle | null)[]>([]);
  const [pendingFocus, setPendingFocus] = useState<{
    idx: number;
    seq: number;
  } | null>(null);
  const focusSeqRef = useRef(0);

  // Re-issue a focus request when the user navigates between items via
  // Enter / Backspace. The seq counter forces a fresh effect run even
  // when we move back to an idx we already focused once.
  useEffect(() => {
    if (!pendingFocus) return;
    itemRefs.current[pendingFocus.idx]?.focus();
  }, [pendingFocus]);

  // Hand the first item's contenteditable to the parent's focus-request
  // map so a freshly-inserted todo block gets focus on the first row.
  useEffect(() => {
    const first = itemRefs.current[0];
    const node = first?.getEditor()?.view.dom;
    if (node) onFocusInput(node as HTMLElement);
    return () => onFocusInput(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id]);

  const requestFocus = useCallback((idx: number) => {
    focusSeqRef.current += 1;
    setPendingFocus({ idx, seq: focusSeqRef.current });
  }, []);

  const updateLines = useCallback(
    (nextLines: string[], nextChecked: number[]) => {
      onPatch((current) => ({
        ...current,
        text: nextLines.join("\n"),
        checkedLines: nextChecked,
      }));
    },
    [onPatch],
  );

  const toggleChecked = (idx: number) => {
    const next = checked.has(idx)
      ? Array.from(checked).filter((i) => i !== idx)
      : [...checked, idx].sort((a, b) => a - b);
    onPatch((current) => ({ ...current, checkedLines: next }));
  };

  const handleLineKeyDown = (event: KeyboardEvent, idx: number) => {
    const handle = itemRefs.current[idx];
    if (!handle) return;
    if (event.key === "Enter") {
      event.preventDefault();
      const isEmpty = handle.isEmpty();
      if (isEmpty && lines.length > 1) {
        // Empty item + Enter on a multi-item list: drop this row, focus prev.
        const nextLines = lines.filter((_, i) => i !== idx);
        const nextChecked = Array.from(checked)
          .filter((i) => i !== idx)
          .map((i) => (i > idx ? i - 1 : i));
        updateLines(nextLines, nextChecked);
        requestFocus(Math.max(0, idx - 1));
        return;
      }
      // Otherwise: insert an empty row below, focus it.
      const nextLines = [...lines.slice(0, idx + 1), "", ...lines.slice(idx + 1)];
      const nextChecked = Array.from(checked).map((i) => (i > idx ? i + 1 : i));
      updateLines(nextLines, nextChecked);
      requestFocus(idx + 1);
      return;
    }
    if (event.key === "Backspace" && handle.isEmpty()) {
      event.preventDefault();
      if (lines.length === 1) {
        onRemoveEmpty();
        return;
      }
      const nextLines = lines.filter((_, i) => i !== idx);
      const nextChecked = Array.from(checked)
        .filter((i) => i !== idx)
        .map((i) => (i > idx ? i - 1 : i));
      updateLines(nextLines, nextChecked);
      requestFocus(Math.max(0, idx - 1));
    }
  };

  return (
    <div className="mdx-document-todo-block">
      {lines.map((line, idx) => (
        <div className="mdx-document-todo-block__row" key={idx}>
          <input
            type="checkbox"
            className="mdx-document-todo-block__check"
            checked={checked.has(idx)}
            onChange={() => toggleChecked(idx)}
            aria-label={`Item ${idx + 1} ${checked.has(idx) ? "complete" : "pending"}`}
          />
          <RichTextInput
            ref={(handle) => {
              itemRefs.current[idx] = handle;
            }}
            className={`mdx-document-text-block mdx-document-todo-block__input${
              checked.has(idx) ? " mdx-document-todo-block__input--checked" : ""
            }`}
            ariaLabel={`Todo item ${idx + 1}`}
            placeholder={idx === 0 ? "To-do" : ""}
            value={line}
            onChange={(next) => {
              const nextLines = lines.slice();
              nextLines[idx] = next;
              onPatch((current) => ({
                ...current,
                text: nextLines.join("\n"),
              }));
            }}
            onKeyDown={(event) => handleLineKeyDown(event, idx)}
          />
        </div>
      ))}
    </div>
  );
}

// ---------- Toggle ----------

// renderChildren is injected by the parent so this file doesn't import
// EditableBlocksList (which would create a circular module graph).
export interface ToggleChildrenRenderProps {
  blocks: MdxBlock[];
  depth: number;
  onBlocksChange: (next: MdxBlock[]) => void;
}

export interface ToggleEditableBlockProps {
  block: MdxBlock;
  depth: number;
  onFocusInput: (
    node: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null,
  ) => void;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  onRemoveEmpty: () => void;
  renderChildren: (props: ToggleChildrenRenderProps) => ReactNode;
}

function BaseToggleEditableBlock({
  block,
  depth,
  onFocusInput,
  onPatch,
  onRemoveEmpty,
  renderChildren,
}: ToggleEditableBlockProps) {
  const isOpen = block.open ?? true;
  const children = block.children ?? [];
  const summaryRef = useRef<RichTextInputHandle>(null);

  const toggleOpen = () => {
    onPatch((current) => ({ ...current, open: !(current.open ?? true) }));
  };

  // Hand the contenteditable to the parent's focus-request map so a
  // newly-inserted toggle still auto-focuses its summary.
  useEffect(() => {
    const editor = summaryRef.current?.getEditor();
    if (!editor) return;
    onFocusInput(editor.view.dom as HTMLElement);
    return () => onFocusInput(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id]);

  const handleSummaryKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Single-line summary: any Enter (with or without shift) opens the
      // toggle and seeds an empty body block. We swallow it so TipTap
      // doesn't split the paragraph or insert a hardBreak inline.
      if (event.key === "Enter") {
        event.preventDefault();
        if (!isOpen || children.length === 0) {
          onPatch((current) => ({
            ...current,
            open: true,
            children:
              current.children && current.children.length > 0
                ? current.children
                : [createMdxBlock("paragraph")],
          }));
        }
        return;
      }
      if (
        event.key === "Backspace" &&
        children.length === 0 &&
        (summaryRef.current?.isEmpty() ?? true)
      ) {
        event.preventDefault();
        onRemoveEmpty();
      }
    },
    [children.length, isOpen, onPatch, onRemoveEmpty],
  );

  const handleSummaryChange = useCallback(
    (next: string) => {
      onPatch((current) => ({ ...current, text: next }));
    },
    [onPatch],
  );

  return (
    <div className="mdx-document-toggle-block" data-open={isOpen ? "true" : undefined}>
      <div className="mdx-document-toggle-block__head">
        <button
          type="button"
          className="mdx-document-toggle-block__chevron"
          aria-expanded={isOpen}
          aria-label={isOpen ? "Collapse toggle" : "Expand toggle"}
          onClick={toggleOpen}
        >
          {isOpen ? "▾" : "▸"}
        </button>
        <RichTextInput
          ref={summaryRef}
          className="mdx-document-text-block mdx-document-toggle-block__summary"
          ariaLabel="Toggle summary"
          placeholder="Toggle"
          value={block.text}
          onChange={handleSummaryChange}
          onKeyDown={handleSummaryKeyDown}
        />
      </div>
      {isOpen ? (
        <div className="mdx-document-toggle-block__body">
          {renderChildren({
            blocks: children,
            depth: depth + 1,
            onBlocksChange: (next) =>
              onPatch((current) => ({ ...current, children: next })),
          })}
        </div>
      ) : null}
    </div>
  );
}

// ---------- Table ----------

export interface TableEditableBlockProps {
  block: MdxBlock;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
}

function BaseTableEditableBlock({ block, onPatch }: TableEditableBlockProps) {
  const data = block.tableData ?? { rows: [["", ""], ["", ""]], headerRow: true };
  const rows = data.rows;
  const updateCell = (rowIdx: number, colIdx: number, value: string) => {
    onPatch((current) => {
      const currentData = current.tableData ?? data;
      const nextRows = currentData.rows.map((row) => [...row]);
      if (!nextRows[rowIdx]) return current;
      nextRows[rowIdx][colIdx] = value;
      return {
        ...current,
        tableData: {
          ...currentData,
          rows: nextRows,
        },
      };
    });
  };

  return (
    <div className="mdx-document-table-block">
      <div className="mdx-document-table-block__scroll">
        <table className="mdx-document-table-block__table">
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx} data-header={rowIdx === 0 && data.headerRow ? "true" : undefined}>
                {row.map((cell, colIdx) => (
                  <td
                    key={colIdx}
                    style={{ textAlign: data.align?.[colIdx] ?? "left" }}
                  >
                    <input
                      className="mdx-document-table-block__cell"
                      value={cell}
                      placeholder={rowIdx === 0 ? "Header" : "Cell"}
                      onChange={(event) =>
                        updateCell(rowIdx, colIdx, event.target.value)
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Bookmark ----------

export interface BookmarkEditableBlockProps {
  block: MdxBlock;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  request: RequestFn;
  setMessage: (kind: "error" | "success", text: string) => void;
}

function BaseBookmarkEditableBlock({
  block,
  onPatch,
}: BookmarkEditableBlockProps) {
  const url = block.url ?? "";
  const title = block.title?.trim() || url || "Bookmark";
  const provider = block.provider?.trim() || hostLabel(url);

  return (
    <div className="mdx-document-bookmark-block">
      <div className="mdx-document-bookmark-block__preview">
        {block.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={block.image} alt={block.title || "Bookmark thumbnail"} />
        ) : null}
        <div className="mdx-document-bookmark-block__content">
          <strong>{title}</strong>
          {block.description ? <p>{block.description}</p> : null}
          <span>{provider || "Select to configure bookmark"}</span>
        </div>
      </div>
      <div className="mdx-document-inline-fields mdx-document-inline-fields--bookmark">
        <label>
          <span>Title</span>
          <input
            value={block.title ?? ""}
            placeholder={url ? hostLabel(url) || "Bookmark title" : "Bookmark title"}
            onChange={(event) =>
              onPatch((current) => ({
                ...current,
                title: event.target.value || undefined,
              }))
            }
          />
        </label>
        <label>
          <span>URL</span>
          <input
            value={url}
            placeholder="https://..."
            onChange={(event) =>
              onPatch((current) => ({ ...current, url: event.target.value }))
            }
          />
        </label>
      </div>
    </div>
  );
}

// ---------- Embed ----------

export const EMBED_KIND_LABELS: Record<MdxEmbedKind, string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  iframe: "Iframe (CodePen, Loom, …)",
  video: "Direct video file",
};

export function previewSrcForEmbed(kind: MdxEmbedKind, url: string): string {
  if (!url.trim()) return "";
  if (kind === "youtube") {
    const match = url.match(/(?:youtu\.be\/|v=)([\w-]{11})/);
    if (match) return `https://www.youtube.com/embed/${match[1]}`;
    return url;
  }
  if (kind === "vimeo") {
    const match = url.match(/vimeo\.com\/(\d+)/);
    if (match) return `https://player.vimeo.com/video/${match[1]}`;
    return url;
  }
  return url;
}

export interface EmbedEditableBlockProps {
  block: MdxBlock;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
}

function BaseEmbedEditableBlock({ block }: EmbedEditableBlockProps) {
  const kind = block.embedKind ?? "iframe";
  const url = block.url ?? "";
  const previewSrc = previewSrcForEmbed(kind, url);

  return (
    <div className="mdx-document-embed-block">
      <div className="mdx-document-embed-block__summary">
        <strong>{EMBED_KIND_LABELS[kind]}</strong>
        <span>{url || "Select to configure embed"}</span>
      </div>
      {previewSrc ? (
        <div className="mdx-document-embed-block__preview">
          <iframe
            src={previewSrc}
            title="Embed preview"
            loading="lazy"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          />
        </div>
      ) : (
        <div className="mdx-document-embed-block__hint">
          Paste a URL to preview the embed.
        </div>
      )}
    </div>
  );
}

// ---------- File ----------

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface FileEditableBlockProps {
  block: MdxBlock;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  request: RequestFn;
  setError: (error: string) => void;
  setMessage: (kind: "error" | "success", text: string) => void;
}

function BaseFileEditableBlock({
  block,
}: FileEditableBlockProps) {
  return (
    <div className="mdx-document-file-block">
      <div className="mdx-document-file-block__fields">
        <strong>{block.filename || block.url || "File attachment"}</strong>
        {block.size ? (
          <span className="mdx-document-file-block__meta">
            {formatBytes(block.size)}
          </span>
        ) : (
          <span className="mdx-document-file-block__meta">
            {block.url ? hostLabel(block.url) : "Select to upload or configure file"}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------- PageLink ----------

export interface PageLinkEditableBlockProps {
  block: MdxBlock;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  request: RequestFn;
}

function BasePageLinkEditableBlock({
  block,
  onPatch,
}: PageLinkEditableBlockProps) {
  const slug = block.pageSlug ?? "";
  const label = block.title?.trim() || slug || "Page link";

  return (
    <div className="mdx-document-page-link-block">
      <div className="mdx-document-page-link-block__current">
        <strong>{label}</strong>
        <span>{slug ? `/${slug}` : "Select this block to choose a page"}</span>
      </div>
      <div className="mdx-document-inline-fields mdx-document-inline-fields--page-link">
        <label>
          <span>Slug</span>
          <input
            value={slug}
            placeholder="teaching/archive/2024-25-fall/csci3141"
            onChange={(event) =>
              onPatch((current) => ({
                ...current,
                pageSlug: event.target.value.replace(/^\/+/, ""),
              }))
            }
          />
        </label>
        <label>
          <span>Label</span>
          <input
            value={block.title ?? ""}
            placeholder="Optional label"
            onChange={(event) =>
              onPatch((current) => ({
                ...current,
                title: event.target.value || undefined,
              }))
            }
          />
        </label>
      </div>
    </div>
  );
}

// ---------- Data-source blocks ----------
// Insertable views over the typed JSON files in `content/`. Each block
// carries only the query (currently just `limit`); entries themselves
// live in their canonical JSON file and render through a matching
// server component on the public site.

export interface DataBlockEditableBlockProps {
  block: MdxBlock;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  /** Display label for the card (e.g. "News", "Publications"). */
  label: string;
  /** Single emoji / glyph shown next to the label. */
  icon: string;
  /** One-line description shown under the label, naming the data source. */
  description: string;
}

function BaseDataBlockEditableBlock({
  block,
  label,
  icon,
  description,
}: DataBlockEditableBlockProps) {
  return (
    <div className="mdx-document-data-block">
      <div className="mdx-document-data-block__head">
        <span className="mdx-document-data-block__icon" aria-hidden="true">
          {icon}
        </span>
        <div className="mdx-document-data-block__heading">
          <strong>{label}</strong>
          <span>{description}</span>
        </div>
      </div>
      <span className="mdx-document-data-block__meta">
        Limit: {block.limit === undefined ? "all entries" : block.limit}
      </span>
    </div>
  );
}

// ---------- Hero block ----------
// Inline-config block (no external data source). Lifted from the Home
// builder's hero section so a hero can be inserted into any page —
// e.g. a custom landing page that wraps marketing copy. All fields
// live on the tag itself; the public component renders into the same
// `home-hero` markup as the Home page so existing styles apply.

export interface HeroBlockEditableBlockProps {
  block: MdxBlock;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
}

function BaseHeroBlockEditableBlock({
  block,
  onPatch,
}: HeroBlockEditableBlockProps) {
  const imagePosition = block.imagePosition ?? "right";
  const textAlign = block.textAlign ?? "left";
  return (
    <div
      className="mdx-document-hero-block"
      data-image-position={imagePosition}
      data-text-align={textAlign}
    >
      <div className="mdx-document-hero-block__body">
        <input
          className="mdx-document-hero-block__title-input"
          value={block.title ?? ""}
          placeholder="Hero title"
          onChange={(event) =>
            onPatch((current) => ({ ...current, title: event.target.value }))
          }
        />
        <textarea
          className="mdx-document-hero-block__subtitle-input"
          value={block.subtitle ?? ""}
          placeholder="Subtitle"
          rows={2}
          onChange={(event) =>
            onPatch((current) => ({
              ...current,
              subtitle: event.target.value || undefined,
            }))
          }
        />
      </div>
      {block.url && imagePosition !== "none" ? (
        <div className="mdx-document-hero-block__media">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={block.url} alt={block.alt || block.title || "Hero image"} />
        </div>
      ) : null}
    </div>
  );
}

// ---------- Link list block ----------
// Inline-config block for a row/grid/stack of links. Items live as a
// JSON-encoded array on the tag (`<LinkListBlock items='[…]' />`) so
// no parser-level child-JSX support is needed. The canvas owns the
// common row edits; advanced layout editing lives in the unified
// BlockInspector. Older smoke tests look for the exact contract phrase:
// detailed editing lives in the unified BlockInspector.

export interface LinkListBlockEditableBlockProps {
  block: MdxBlock;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
}

function BaseLinkListBlockEditableBlock({
  block,
  onPatch,
}: LinkListBlockEditableBlockProps) {
  const layout = block.linkLayout ?? "stack";

  return (
    <div className="mdx-document-link-list-block" data-layout={layout}>
      <div className="mdx-document-data-block__head">
        <span className="mdx-document-data-block__icon" aria-hidden="true">
          🔗
        </span>
        <div className="mdx-document-data-block__heading">
          <strong>Link list</strong>
          <span>Stack, grid, or inline row of links.</span>
        </div>
      </div>
      {block.title ? (
        <strong className="mdx-document-link-list-block__title">
          {block.title}
        </strong>
      ) : null}
      <label className="mdx-document-link-list-block__title-field">
        <span>Title</span>
        <input
          value={block.title ?? ""}
          placeholder="Optional title"
          onChange={(event) =>
            onPatch((current) => ({
              ...current,
              title: event.target.value || undefined,
            }))
          }
        />
      </label>
      <LinkItemsEditor
        emptyLabel="Select this block to add links."
        items={block.linkItems ?? []}
        onChange={(items) => onPatch((current) => ({ ...current, linkItems: items }))}
      />
    </div>
  );
}

// ---------- Featured pages block ----------
// Same item-array pattern as LinkListBlock with two extra dimensions:
// each item carries an optional description and the layout has a fixed
// columns count (2 or 3). Field editing lives in BlockInspector.

export interface FeaturedPagesBlockEditableBlockProps {
  block: MdxBlock;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
}

function BaseFeaturedPagesBlockEditableBlock({
  block,
  onPatch,
}: FeaturedPagesBlockEditableBlockProps) {
  const columns = block.columns ?? 2;

  return (
    <div
      className="mdx-document-link-list-block mdx-document-link-list-block--featured-preview"
      data-columns={columns}
    >
      <div className="mdx-document-data-block__head">
        <span className="mdx-document-data-block__icon" aria-hidden="true">
          🗂
        </span>
        <div className="mdx-document-data-block__heading">
          <strong>Featured pages</strong>
          <span>Card grid linking to other pages on the site.</span>
        </div>
      </div>
      {block.title ? (
        <strong className="mdx-document-link-list-block__title">
          {block.title}
        </strong>
      ) : null}
      <label className="mdx-document-link-list-block__title-field">
        <span>Title</span>
        <input
          value={block.title ?? ""}
          placeholder="Optional title"
          onChange={(event) =>
            onPatch((current) => ({
              ...current,
              title: event.target.value || undefined,
            }))
          }
        />
      </label>
      <LinkItemsEditor
        emptyLabel="Select this block to add cards."
        featured
        items={block.linkItems ?? []}
        onChange={(items) => onPatch((current) => ({ ...current, linkItems: items }))}
        withDescription
      />
    </div>
  );
}

// ---------- Columns ----------

// Same renderChildren shape Toggle uses; columns and toggles both nest
// recursively into EditableBlocksList without importing it directly.
export interface ColumnsChildrenRenderProps {
  blocks: MdxBlock[];
  depth: number;
  onBlocksChange: (next: MdxBlock[]) => void;
}

export interface ColumnsEditableBlockProps {
  block: MdxBlock;
  depth: number;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  renderChildren: (props: ColumnsChildrenRenderProps) => ReactNode;
}

function BaseColumnsEditableBlock({
  block,
  depth,
  onPatch,
  renderChildren,
}: ColumnsEditableBlockProps) {
  const count: 2 | 3 = (block.columns ?? 2) >= 3 ? 3 : 2;
  const gap = block.columnsGap ?? "standard";
  const align = block.columnsAlign ?? "start";
  const columns = block.children ?? [];
  const visibleColumns = columns.slice(0, count);

  const updateColumnChildren = (idx: number, nextBlocks: MdxBlock[]) => {
    onPatch((current) => {
      const nextChildren = (current.children ?? []).slice();
      const target = nextChildren[idx];
      if (!target) return current;
      nextChildren[idx] = { ...target, children: nextBlocks };
      return { ...current, children: nextChildren };
    });
  };

  return (
    <div
      className="mdx-document-columns-block"
      data-cols={count}
      data-gap={gap}
      data-align={align}
    >
      {visibleColumns.length === 0 ? (
        <div className="mdx-document-columns-block__empty">
          Select this block to configure columns.
        </div>
      ) : null}
      <div className="mdx-document-columns-block__grid">
        {visibleColumns.map((column, idx) => (
          <div className="mdx-document-columns-block__column" key={column.id}>
            {renderChildren({
              blocks: column.children ?? [],
              depth: depth + 2,
              onBlocksChange: (next) => updateColumnChildren(idx, next),
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// Defensive renderer for `column` blocks that escape their `columns` parent.
// In normal use, ColumnsEditableBlock renders each column inline; this branch
// only fires if a stray <Column> shows up at the top level (hand-edited MDX,
// migration glitch). Render the children recursively so the user can still
// edit them and re-wrap in a Columns block from the slash menu.
export interface ColumnEditableBlockProps {
  block: MdxBlock;
  depth: number;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  renderChildren: (props: ColumnsChildrenRenderProps) => ReactNode;
}

function BaseColumnEditableBlock({
  block,
  depth,
  onPatch,
  renderChildren,
}: ColumnEditableBlockProps) {
  return (
    <div className="mdx-document-column-block">
      {renderChildren({
        blocks: block.children ?? [],
        depth: depth + 1,
        onBlocksChange: (next) =>
          onPatch((current) => ({ ...current, children: next })),
      })}
    </div>
  );
}

// ---------- Works entry ----------

// One role / position on the works page. Mirrors the legacy
// WorksEntry DTO field-by-field; description body is recursive
// children edited via the injected `renderChildren`.
export interface WorksEntryEditableBlockProps {
  block: MdxBlock;
  depth: number;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  renderChildren: (props: ColumnsChildrenRenderProps) => ReactNode;
}

function BaseWorksEntryEditableBlock({
  block,
  depth,
  onPatch,
  renderChildren,
}: WorksEntryEditableBlockProps) {
  const category = block.worksCategory ?? "recent";
  const role = block.worksRole ?? "";
  const period = block.worksPeriod ?? "";
  const affiliation = block.worksAffiliation ?? "";
  const affiliationUrl = block.worksAffiliationUrl ?? "";
  const location = block.worksLocation ?? "";

  return (
    <div className="mdx-document-data-entry-block">
      <div className="mdx-document-data-entry-block__head">
        <label className="mdx-document-data-entry-block__field mdx-document-data-entry-block__field--small">
          <span>Category</span>
          <select
            value={category}
            onChange={(event) =>
              onPatch((current) => ({
                ...current,
                worksCategory: event.target.value as "recent" | "passed",
              }))
            }
          >
            <option value="recent">Recent</option>
            <option value="passed">Past</option>
          </select>
        </label>
        <label className="mdx-document-data-entry-block__field">
          <span>Role</span>
          <input
            value={role}
            placeholder="e.g. Research Assistant"
            onChange={(event) =>
              onPatch((current) => ({ ...current, worksRole: event.target.value }))
            }
            aria-invalid={!role.trim() || undefined}
          />
        </label>
        <label className="mdx-document-data-entry-block__field">
          <span>Period</span>
          <input
            value={period}
            placeholder="e.g. Sep 2024 - Now"
            onChange={(event) =>
              onPatch((current) => ({ ...current, worksPeriod: event.target.value }))
            }
            aria-invalid={!period.trim() || undefined}
          />
        </label>
      </div>
      <div className="mdx-document-data-entry-block__head">
        <label className="mdx-document-data-entry-block__field">
          <span>Affiliation</span>
          <input
            value={affiliation}
            placeholder="e.g. Dalhousie University"
            onChange={(event) =>
              onPatch((current) => ({
                ...current,
                worksAffiliation: event.target.value || undefined,
              }))
            }
          />
        </label>
        <label className="mdx-document-data-entry-block__field">
          <span>Affiliation URL</span>
          <input
            value={affiliationUrl}
            placeholder="https://example.org"
            onChange={(event) =>
              onPatch((current) => ({
                ...current,
                worksAffiliationUrl: event.target.value || undefined,
              }))
            }
          />
        </label>
        <label className="mdx-document-data-entry-block__field">
          <span>Location</span>
          <input
            value={location}
            placeholder="e.g. Halifax, NS"
            onChange={(event) =>
              onPatch((current) => ({
                ...current,
                worksLocation: event.target.value || undefined,
              }))
            }
          />
        </label>
      </div>
      <div className="mdx-document-news-entry-block__body">
        {renderChildren({
          blocks: block.children ?? [],
          depth: depth + 1,
          onBlocksChange: (next) =>
            onPatch((current) => ({ ...current, children: next })),
        })}
      </div>
    </div>
  );
}

// ---------- Publications entry ----------

interface PubEntryData {
  title?: string;
  year?: string;
  url?: string;
  doiUrl?: string;
  arxivUrl?: string;
  labels?: string[];
  authorsRich?: { name: string; isSelf?: boolean }[];
  venues?: { type?: string; text?: string; url?: string }[];
  highlights?: string[];
  externalUrls?: string[];
}

function parsePubData(raw: string | undefined): PubEntryData {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as PubEntryData;
  } catch {
    // fall through
  }
  return {};
}

function compactStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items.map((value) => value.trim()).filter(Boolean)) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function formatCommaList(items: string[] | undefined): string {
  return (items ?? []).join(", ");
}

function parseCommaList(raw: string): string[] {
  return compactStrings(raw.split(","));
}

function formatAuthors(authors: PubEntryData["authorsRich"]): string {
  return (authors ?? [])
    .map((author) => `${author.name}${author.isSelf ? " *" : ""}`)
    .join("; ");
}

function parseAuthors(raw: string): PubEntryData["authorsRich"] {
  return compactStrings(raw.split(";")).map((item) => {
    const isSelf = /\*$/.test(item);
    return {
      name: item.replace(/\*$/, "").trim(),
      isSelf,
    };
  });
}

function formatVenues(venues: PubEntryData["venues"]): string {
  return (venues ?? [])
    .map((venue) =>
      [venue.type ?? "", venue.text ?? "", venue.url ?? ""]
        .map((item) => item.trim())
        .filter(Boolean)
        .join(" | "),
    )
    .join("\n");
}

function parseVenues(raw: string): PubEntryData["venues"] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [type = "", text = "", url = ""] = line
        .split("|")
        .map((part) => part.trim());
      return {
        type: type || undefined,
        text: text || type || undefined,
        url: url || undefined,
      };
    });
}

function formatLines(items: string[] | undefined): string {
  return (items ?? []).join("\n");
}

function parseLines(raw: string): string[] {
  return compactStrings(raw.split("\n"));
}

// One publication. Schema is rich enough that fields go through a
// JSON-encoded `pubData` attr — the editor card decodes / re-encodes
// it on every keystroke.
export interface PublicationsEntryEditableBlockProps {
  block: MdxBlock;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
}

function BasePublicationsEntryEditableBlock({
  block,
  onPatch,
}: PublicationsEntryEditableBlockProps) {
  const data = parsePubData(block.pubData);
  const setData = (next: PubEntryData) => {
    const json = JSON.stringify(next);
    onPatch((current) => ({ ...current, pubData: json }));
  };

  return (
    <div className="mdx-document-data-entry-block">
      <div className="mdx-document-data-entry-block__head">
        <label className="mdx-document-data-entry-block__field">
          <span>Title</span>
          <input
            value={data.title ?? ""}
            placeholder="Paper title"
            onChange={(event) => setData({ ...data, title: event.target.value })}
            aria-invalid={!data.title?.trim() || undefined}
          />
        </label>
        <label className="mdx-document-data-entry-block__field mdx-document-data-entry-block__field--small">
          <span>Year</span>
          <input
            value={data.year ?? ""}
            placeholder="2026"
            onChange={(event) => setData({ ...data, year: event.target.value })}
            aria-invalid={!data.year?.trim() || undefined}
          />
        </label>
      </div>
      <div className="mdx-document-data-entry-block__head">
        <label className="mdx-document-data-entry-block__field">
          <span>Paper URL</span>
          <input
            value={data.url ?? ""}
            placeholder="https://..."
            onChange={(event) =>
              setData({ ...data, url: event.target.value || undefined })
            }
          />
        </label>
        <label className="mdx-document-data-entry-block__field">
          <span>DOI URL</span>
          <input
            value={data.doiUrl ?? ""}
            placeholder="https://doi.org/..."
            onChange={(event) =>
              setData({ ...data, doiUrl: event.target.value || undefined })
            }
          />
        </label>
        <label className="mdx-document-data-entry-block__field">
          <span>arXiv URL</span>
          <input
            value={data.arxivUrl ?? ""}
            placeholder="https://arxiv.org/abs/..."
            onChange={(event) =>
              setData({ ...data, arxivUrl: event.target.value || undefined })
            }
          />
        </label>
      </div>
      <details className="mdx-document-data-entry-block__advanced">
        <summary>More details</summary>
        <label className="mdx-document-data-entry-block__field">
          <span>Labels</span>
          <input
            value={formatCommaList(data.labels)}
            placeholder="Conference, Paper"
            onChange={(event) =>
              setData({ ...data, labels: parseCommaList(event.target.value) })
            }
          />
        </label>
        <label className="mdx-document-data-entry-block__field">
          <span>Authors</span>
          <textarea
            rows={2}
            value={formatAuthors(data.authorsRich)}
            placeholder="Yimen Chen *; Collaborator"
            onChange={(event) =>
              setData({ ...data, authorsRich: parseAuthors(event.target.value) })
            }
          />
        </label>
        <label className="mdx-document-data-entry-block__field">
          <span>Venues</span>
          <textarea
            rows={3}
            value={formatVenues(data.venues)}
            placeholder="conference | NeurIPS 2026 | https://..."
            onChange={(event) =>
              setData({ ...data, venues: parseVenues(event.target.value) })
            }
          />
        </label>
        <label className="mdx-document-data-entry-block__field">
          <span>Highlights</span>
          <input
            value={formatCommaList(data.highlights)}
            placeholder="Best paper, Oral"
            onChange={(event) =>
              setData({ ...data, highlights: parseCommaList(event.target.value) })
            }
          />
        </label>
        <label className="mdx-document-data-entry-block__field">
          <span>External URLs</span>
          <textarea
            rows={2}
            value={formatLines(data.externalUrls)}
            placeholder="https://..."
            onChange={(event) =>
              setData({ ...data, externalUrls: parseLines(event.target.value) })
            }
          />
        </label>
      </details>
    </div>
  );
}

// ---------- Teaching entry ----------

// One row on the teaching page. Atomic (no body content) — every field
// is a JSX attribute on the self-closing `<TeachingEntry />` tag, so
// the editor card is a flat form, no nested EditableBlocksList.
export interface TeachingEntryEditableBlockProps {
  block: MdxBlock;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
}

function BaseTeachingEntryEditableBlock({
  block,
  onPatch,
}: TeachingEntryEditableBlockProps) {
  const term = block.teachingTerm ?? "";
  const period = block.teachingPeriod ?? "";
  const role = block.teachingRole ?? "";
  const courseCode = block.teachingCourseCode ?? "";
  const courseName = block.teachingCourseName ?? "";
  const courseUrl = block.teachingCourseUrl ?? "";
  const instructor = block.teachingInstructor ?? "";

  const set = (
    key:
      | "teachingTerm"
      | "teachingPeriod"
      | "teachingRole"
      | "teachingCourseCode"
      | "teachingCourseName"
      | "teachingCourseUrl"
      | "teachingInstructor",
    value: string,
    optional = false,
  ) => {
    onPatch((current) => ({
      ...current,
      [key]: optional ? value || undefined : value,
    }));
  };

  return (
    <div className="mdx-document-data-entry-block">
      <div className="mdx-document-data-entry-block__head">
        <label className="mdx-document-data-entry-block__field mdx-document-data-entry-block__field--small">
          <span>Term</span>
          <input
            value={term}
            placeholder="Fall 2024"
            onChange={(event) => set("teachingTerm", event.target.value)}
            aria-invalid={!term.trim() || undefined}
          />
        </label>
        <label className="mdx-document-data-entry-block__field">
          <span>Period</span>
          <input
            value={period}
            placeholder="Sep 2024 - Dec 2024"
            onChange={(event) => set("teachingPeriod", event.target.value)}
          />
        </label>
        <label className="mdx-document-data-entry-block__field">
          <span>Role</span>
          <input
            value={role}
            placeholder="Instructor"
            onChange={(event) => set("teachingRole", event.target.value)}
          />
        </label>
      </div>
      <div className="mdx-document-data-entry-block__head">
        <label className="mdx-document-data-entry-block__field mdx-document-data-entry-block__field--small">
          <span>Course code</span>
          <input
            value={courseCode}
            placeholder="CSCI3141"
            onChange={(event) => set("teachingCourseCode", event.target.value)}
            aria-invalid={!courseCode.trim() || undefined}
          />
        </label>
        <label className="mdx-document-data-entry-block__field">
          <span>Course name</span>
          <input
            value={courseName}
            placeholder="Foundations of Data Science"
            onChange={(event) => set("teachingCourseName", event.target.value)}
          />
        </label>
        <label className="mdx-document-data-entry-block__field">
          <span>Course URL</span>
          <input
            value={courseUrl}
            placeholder="https://..."
            onChange={(event) => set("teachingCourseUrl", event.target.value, true)}
          />
        </label>
        <label className="mdx-document-data-entry-block__field">
          <span>Instructor</span>
          <input
            value={instructor}
            placeholder="Dr. Someone"
            onChange={(event) => set("teachingInstructor", event.target.value, true)}
          />
        </label>
      </div>
    </div>
  );
}

// ---------- News entry ----------

// One dated entry on the news page. Same recursive-children shape as
// toggle / column — receives `renderChildren` from the parent so this
// file doesn't depend on the EditableBlocksList living in
// MdxDocumentEditor.tsx (would be a circular import).
export interface NewsEntryEditableBlockProps {
  block: MdxBlock;
  depth: number;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  renderChildren: (props: ColumnsChildrenRenderProps) => ReactNode;
}

function BaseNewsEntryEditableBlock({
  block,
  depth,
  onPatch,
  renderChildren,
}: NewsEntryEditableBlockProps) {
  const date = block.dateIso ?? "";
  const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(date);

  return (
    <div className="mdx-document-news-entry-block">
      <div className="mdx-document-news-entry-block__head">
        <label className="mdx-document-news-entry-block__date">
          <span className="mdx-document-news-entry-block__date-label">Date</span>
          <input
            type="date"
            value={isValidDate ? date : ""}
            onChange={(event) =>
              onPatch((current) => ({ ...current, dateIso: event.target.value }))
            }
            aria-invalid={!isValidDate || undefined}
          />
        </label>
        {!isValidDate ? (
          <span
            className="mdx-document-news-entry-block__warn"
            role="status"
            aria-live="polite"
          >
            Pick a date (YYYY-MM-DD) — empty entries do not sort correctly on the
            published page.
          </span>
        ) : null}
      </div>
      <div className="mdx-document-news-entry-block__body">
        {renderChildren({
          blocks: block.children ?? [],
          depth: depth + 1,
          onBlocksChange: (next) =>
            onPatch((current) => ({ ...current, children: next })),
        })}
      </div>
    </div>
  );
}


// ---------- Teaching links / Publications profile links ----------
// Both share LinkListBlock's array shape, but canvas rendering stays
// preview-only. The selected block inspector owns add / remove / reorder
// controls so these strips do not become form islands inside the document.

export interface LinksRowEditableBlockProps {
  block: MdxBlock;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
}

function LinksRowPreview({
  block,
  emptyLabel,
  onPatch,
  withHostname,
}: {
  block: MdxBlock;
  emptyLabel: string;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  withHostname: boolean;
}) {
  return (
    <LinkItemsEditor
      emptyLabel={emptyLabel}
      items={block.linkItems ?? []}
      onChange={(items) => onPatch((current) => ({ ...current, linkItems: items }))}
      withHostname={withHostname}
    />
  );
}

function BaseTeachingLinksEditableBlock({
  block,
  onPatch,
}: LinksRowEditableBlockProps) {
  const variant = block.teachingLinksVariant ?? "header";
  return (
    <div className="mdx-document-link-list-block">
      <div className="mdx-document-data-block__head">
        <span className="mdx-document-data-block__icon" aria-hidden="true">
          🔗
        </span>
        <div className="mdx-document-data-block__heading">
          <strong>Teaching links</strong>
          <span>
            {variant === "header"
              ? "Header row — bold labels with `|` dividers, above the entries."
              : "Footer row — plain links with ` · ` dividers, below the entries."}
          </span>
        </div>
      </div>
      <LinksRowPreview
        block={block}
        emptyLabel="Select this block to add teaching links."
        onPatch={onPatch}
        withHostname={false}
      />
    </div>
  );
}

function BasePublicationsProfileLinksEditableBlock({
  block,
  onPatch,
}: LinksRowEditableBlockProps) {
  return (
    <div className="mdx-document-link-list-block">
      <div className="mdx-document-data-block__head">
        <span className="mdx-document-data-block__icon" aria-hidden="true">
          🔗
        </span>
        <div className="mdx-document-data-block__heading">
          <strong>Profile links</strong>
          <span>
            Yellow-highlighted link strip above the publications list. Each
            row optionally carries a hostname (drives the favicon).
          </span>
        </div>
      </div>
      <LinksRowPreview
        block={block}
        emptyLabel="Select this block to add profile links."
        onPatch={onPatch}
        withHostname={true}
      />
    </div>
  );
}

// ---------- memoized public exports ----------
//
// Each leaf renderer is wrapped in `memo` with a comparator that ignores
// callback identity. The key insight: every per-block callback in the parent
// (`onPatch`, `onRemoveEmpty`, etc.) closes over the *current* `block.id`,
// so two renders with the same `block` reference produce semantically
// equivalent callbacks even though their function identities differ. We
// short-circuit on `block` (and `depth` where it actually shapes the
// output) and skip the noisy callback churn that would otherwise re-render
// every leaf on every keystroke into a sibling.

function eqByBlock<P extends { block: MdxBlock }>(a: P, b: P): boolean {
  return a.block === b.block;
}

function eqByBlockAndDepth<P extends { block: MdxBlock; depth: number }>(
  a: P,
  b: P,
): boolean {
  return a.block === b.block && a.depth === b.depth;
}

export const TodoEditableBlock = memo(BaseTodoEditableBlock, eqByBlock);
export const ToggleEditableBlock = memo(BaseToggleEditableBlock, eqByBlockAndDepth);
export const TableEditableBlock = memo(BaseTableEditableBlock, eqByBlock);
export const BookmarkEditableBlock = memo(BaseBookmarkEditableBlock, eqByBlock);
export const EmbedEditableBlock = memo(BaseEmbedEditableBlock, eqByBlock);
export const FileEditableBlock = memo(BaseFileEditableBlock, eqByBlock);
export const PageLinkEditableBlock = memo(BasePageLinkEditableBlock, eqByBlock);
export const DataBlockEditableBlock = memo(BaseDataBlockEditableBlock, eqByBlock);
export const HeroBlockEditableBlock = memo(BaseHeroBlockEditableBlock, eqByBlock);
export const LinkListBlockEditableBlock = memo(
  BaseLinkListBlockEditableBlock,
  eqByBlock,
);
export const FeaturedPagesBlockEditableBlock = memo(
  BaseFeaturedPagesBlockEditableBlock,
  eqByBlock,
);
export const ColumnsEditableBlock = memo(
  BaseColumnsEditableBlock,
  eqByBlockAndDepth,
);
export const ColumnEditableBlock = memo(
  BaseColumnEditableBlock,
  eqByBlockAndDepth,
);
export const WorksEntryEditableBlock = memo(
  BaseWorksEntryEditableBlock,
  eqByBlock,
);
export const PublicationsEntryEditableBlock = memo(
  BasePublicationsEntryEditableBlock,
  eqByBlock,
);
export const TeachingEntryEditableBlock = memo(
  BaseTeachingEntryEditableBlock,
  eqByBlock,
);
export const NewsEntryEditableBlock = memo(BaseNewsEntryEditableBlock, eqByBlock);
export const TeachingLinksEditableBlock = memo(
  BaseTeachingLinksEditableBlock,
  eqByBlock,
);
export const PublicationsProfileLinksEditableBlock = memo(
  BasePublicationsProfileLinksEditableBlock,
  eqByBlock,
);
