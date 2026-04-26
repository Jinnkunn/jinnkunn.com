// Per-type editor render branches for MdxBlock. These are the leaf views the
// generic EditableBlock dispatcher (in MdxDocumentEditor.tsx) renders for
// non-text block types (todo, toggle, table, bookmark, embed, file, page-link).
// Toggle nests recursively but receives an EditableBlocksList renderer via
// `renderChildren` so this file does not depend on its parent.

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { rememberRecentAsset } from "./AssetLibraryPicker";
import { uploadGenericFile } from "./assets-upload";
import {
  createMdxBlock,
  type MdxBlock,
  type MdxEmbedKind,
  type MdxLinkItem,
} from "./mdx-blocks";
import type { NormalizedApiResponse } from "./types";

type RequestFn = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<NormalizedApiResponse>;

export type BlockRendererRequestFn = RequestFn;

// ---------- Todo ----------

export interface TodoEditableBlockProps {
  block: MdxBlock;
  onFocusInput: (node: HTMLInputElement | HTMLTextAreaElement | null) => void;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  onRemoveEmpty: () => void;
}

export function TodoEditableBlock({
  block,
  onFocusInput,
  onPatch,
  onRemoveEmpty,
}: TodoEditableBlockProps) {
  const lines = block.text.split("\n");
  const checked = new Set(block.checkedLines ?? []);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const focusLine = (idx: number, position: "start" | "end" = "end") => {
    requestAnimationFrame(() => {
      const node = inputRefs.current[idx];
      if (!node) return;
      node.focus();
      const pos = position === "end" ? node.value.length : 0;
      node.setSelectionRange(pos, pos);
    });
  };

  const updateLines = (
    nextLines: string[],
    nextChecked: number[],
    focusIdx?: number,
    focusPosition?: "start" | "end",
  ) => {
    onPatch((current) => ({
      ...current,
      text: nextLines.join("\n"),
      checkedLines: nextChecked,
    }));
    if (focusIdx !== undefined) focusLine(focusIdx, focusPosition);
  };

  const toggleChecked = (idx: number) => {
    const next = checked.has(idx)
      ? Array.from(checked).filter((i) => i !== idx)
      : [...checked, idx].sort((a, b) => a - b);
    onPatch((current) => ({ ...current, checkedLines: next }));
  };

  const handleLineKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    idx: number,
  ) => {
    const node = event.currentTarget;
    if (event.key === "Enter") {
      event.preventDefault();
      if (!node.value && lines.length > 1) {
        const nextLines = lines.filter((_, i) => i !== idx);
        const nextChecked = Array.from(checked)
          .filter((i) => i !== idx)
          .map((i) => (i > idx ? i - 1 : i));
        updateLines(nextLines, nextChecked, Math.max(0, idx - 1), "end");
        return;
      }
      const nextLines = [...lines.slice(0, idx + 1), "", ...lines.slice(idx + 1)];
      const nextChecked = Array.from(checked).map((i) => (i > idx ? i + 1 : i));
      updateLines(nextLines, nextChecked, idx + 1, "start");
      return;
    }
    if (event.key === "Backspace" && !node.value && node.selectionStart === 0) {
      event.preventDefault();
      if (lines.length === 1) {
        onRemoveEmpty();
        return;
      }
      const nextLines = lines.filter((_, i) => i !== idx);
      const nextChecked = Array.from(checked)
        .filter((i) => i !== idx)
        .map((i) => (i > idx ? i - 1 : i));
      updateLines(nextLines, nextChecked, Math.max(0, idx - 1), "end");
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
          <input
            ref={(node) => {
              inputRefs.current[idx] = node;
              if (idx === 0) onFocusInput(node);
            }}
            className="mdx-document-todo-block__input"
            data-checked={checked.has(idx) ? "true" : undefined}
            value={line}
            placeholder="To-do"
            onChange={(event) => {
              const nextLines = lines.slice();
              nextLines[idx] = event.target.value;
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
  onFocusInput: (node: HTMLInputElement | HTMLTextAreaElement | null) => void;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  onRemoveEmpty: () => void;
  renderChildren: (props: ToggleChildrenRenderProps) => ReactNode;
}

export function ToggleEditableBlock({
  block,
  depth,
  onFocusInput,
  onPatch,
  onRemoveEmpty,
  renderChildren,
}: ToggleEditableBlockProps) {
  const isOpen = block.open ?? true;
  const children = block.children ?? [];

  const toggleOpen = () => {
    onPatch((current) => ({ ...current, open: !(current.open ?? true) }));
  };

  const handleSummaryKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (!isOpen) {
        onPatch((current) => ({ ...current, open: true }));
      }
      if (children.length === 0) {
        onPatch((current) => ({
          ...current,
          open: true,
          children: [createMdxBlock("paragraph")],
        }));
      }
      return;
    }
    if (event.key === "Backspace" && !event.currentTarget.value) {
      if (children.length === 0) {
        event.preventDefault();
        onRemoveEmpty();
      }
    }
  };

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
        <input
          ref={onFocusInput}
          className="mdx-document-toggle-block__summary"
          value={block.text}
          placeholder="Toggle"
          onChange={(event) =>
            onPatch((current) => ({ ...current, text: event.target.value }))
          }
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

export function TableEditableBlock({ block, onPatch }: TableEditableBlockProps) {
  const data = block.tableData ?? { rows: [["", ""], ["", ""]], headerRow: true };
  const rows = data.rows;
  const colCount = rows[0]?.length ?? 0;

  const updateData = (next: MdxBlock["tableData"]) => {
    onPatch((current) => ({ ...current, tableData: next }));
  };

  const setCell = (rowIdx: number, colIdx: number, value: string) => {
    const nextRows = rows.map((row) => row.slice());
    nextRows[rowIdx][colIdx] = value;
    updateData({ ...data, rows: nextRows });
  };

  const addRow = () => {
    const blank = new Array(colCount).fill("");
    updateData({ ...data, rows: [...rows, blank] });
  };

  const addColumn = () => {
    const nextRows = rows.map((row) => [...row, ""]);
    const nextAlign = data.align ? [...data.align, "left" as const] : undefined;
    updateData({ ...data, rows: nextRows, align: nextAlign });
  };

  const removeRow = (idx: number) => {
    if (rows.length <= 1) return;
    updateData({ ...data, rows: rows.filter((_, i) => i !== idx) });
  };

  const removeColumn = (idx: number) => {
    if (colCount <= 1) return;
    const nextRows = rows.map((row) => row.filter((_, i) => i !== idx));
    const nextAlign = data.align?.filter((_, i) => i !== idx);
    updateData({ ...data, rows: nextRows, align: nextAlign });
  };

  const setAlign = (colIdx: number, value: "left" | "center" | "right") => {
    const nextAlign = (data.align ?? new Array(colCount).fill("left" as const)).slice();
    nextAlign[colIdx] = value;
    updateData({ ...data, align: nextAlign });
  };

  const handleCellKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    rowIdx: number,
    colIdx: number,
  ) => {
    if (event.key === "Tab" && !event.shiftKey) {
      const isLastCell = rowIdx === rows.length - 1 && colIdx === colCount - 1;
      if (isLastCell) {
        event.preventDefault();
        addRow();
      }
    }
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
                      onChange={(event) => setCell(rowIdx, colIdx, event.target.value)}
                      onKeyDown={(event) => handleCellKeyDown(event, rowIdx, colIdx)}
                      placeholder={rowIdx === 0 ? "Header" : ""}
                    />
                  </td>
                ))}
                <td className="mdx-document-table-block__row-actions">
                  <button
                    type="button"
                    onClick={() => removeRow(rowIdx)}
                    disabled={rows.length <= 1}
                    aria-label="Remove row"
                    title="Remove row"
                  >
                    −
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mdx-document-table-block__col-controls">
        {Array.from({ length: colCount }).map((_, colIdx) => (
          <div key={colIdx} className="mdx-document-table-block__col-control">
            <select
              value={data.align?.[colIdx] ?? "left"}
              onChange={(event) =>
                setAlign(colIdx, event.target.value as "left" | "center" | "right")
              }
              aria-label={`Column ${colIdx + 1} alignment`}
            >
              <option value="left">←</option>
              <option value="center">↔</option>
              <option value="right">→</option>
            </select>
            <button
              type="button"
              onClick={() => removeColumn(colIdx)}
              disabled={colCount <= 1}
              aria-label={`Remove column ${colIdx + 1}`}
              title="Remove column"
            >
              −
            </button>
          </div>
        ))}
      </div>
      <div className="mdx-document-table-block__actions">
        <button type="button" onClick={addRow}>
          + Row
        </button>
        <button type="button" onClick={addColumn}>
          + Column
        </button>
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

export function BookmarkEditableBlock({
  block,
  onPatch,
  request,
  setMessage,
}: BookmarkEditableBlockProps) {
  const [fetching, setFetching] = useState(false);
  const url = block.url ?? "";

  const fetchMeta = async () => {
    if (!url.trim()) {
      setMessage("error", "Enter a URL first.");
      return;
    }
    setFetching(true);
    const response = await request("/api/site-admin/og-fetch", "POST", {
      url: url.trim(),
    });
    setFetching(false);
    if (!response.ok) {
      setMessage("error", `Bookmark fetch failed: ${response.code}: ${response.error}`);
      return;
    }
    const data = (response.data ?? {}) as Record<string, unknown>;
    onPatch((current) => ({
      ...current,
      title: typeof data.title === "string" ? data.title : current.title,
      description:
        typeof data.description === "string" ? data.description : current.description,
      image: typeof data.image === "string" ? data.image : current.image,
      provider: typeof data.provider === "string" ? data.provider : current.provider,
    }));
    setMessage("success", "Bookmark metadata fetched.");
  };

  return (
    <div className="mdx-document-bookmark-block">
      <div className="mdx-document-bookmark-block__row">
        <input
          aria-label="Bookmark URL"
          value={url}
          placeholder="https://example.com"
          onChange={(event) =>
            onPatch((current) => ({ ...current, url: event.target.value }))
          }
        />
        <button type="button" onClick={fetchMeta} disabled={fetching || !url.trim()}>
          {fetching ? "Fetching…" : "Fetch metadata"}
        </button>
      </div>
      <div className="mdx-document-bookmark-block__preview">
        {block.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={block.image} alt={block.title || "Bookmark thumbnail"} />
        ) : null}
        <div className="mdx-document-bookmark-block__fields">
          <input
            aria-label="Bookmark title"
            value={block.title ?? ""}
            placeholder="Title"
            onChange={(event) =>
              onPatch((current) => ({ ...current, title: event.target.value }))
            }
          />
          <textarea
            aria-label="Bookmark description"
            value={block.description ?? ""}
            placeholder="Description"
            rows={2}
            onChange={(event) =>
              onPatch((current) => ({ ...current, description: event.target.value }))
            }
          />
          <input
            aria-label="Bookmark provider"
            value={block.provider ?? ""}
            placeholder="example.com"
            onChange={(event) =>
              onPatch((current) => ({ ...current, provider: event.target.value }))
            }
          />
          <input
            aria-label="Bookmark thumbnail URL"
            value={block.image ?? ""}
            placeholder="Image URL (optional)"
            onChange={(event) =>
              onPatch((current) => ({ ...current, image: event.target.value }))
            }
          />
        </div>
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

export function EmbedEditableBlock({ block, onPatch }: EmbedEditableBlockProps) {
  const kind = block.embedKind ?? "iframe";
  const url = block.url ?? "";
  const previewSrc = previewSrcForEmbed(kind, url);

  return (
    <div className="mdx-document-embed-block">
      <div className="mdx-document-embed-block__row">
        <select
          aria-label="Embed kind"
          value={kind}
          onChange={(event) =>
            onPatch((current) => ({
              ...current,
              embedKind: event.target.value as MdxEmbedKind,
            }))
          }
        >
          {(Object.keys(EMBED_KIND_LABELS) as MdxEmbedKind[]).map((value) => (
            <option key={value} value={value}>
              {EMBED_KIND_LABELS[value]}
            </option>
          ))}
        </select>
        <input
          aria-label="Embed URL"
          value={url}
          placeholder="https://…"
          onChange={(event) =>
            onPatch((current) => ({ ...current, url: event.target.value }))
          }
        />
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

export function FileEditableBlock({
  block,
  onPatch,
  request,
  setError,
  setMessage,
}: FileEditableBlockProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleUpload = async (file: File | null) => {
    if (!file || uploading) return;
    setUploading(true);
    setProgress(0);
    // Naive faux-progress timer; the underlying fetch is one-shot, but a
    // visual signal lets users know the click landed for large uploads.
    const ticker = window.setInterval(() => {
      setProgress((p) => Math.min(p + 5, 90));
    }, 150);
    const result = await uploadGenericFile({ file, request });
    window.clearInterval(ticker);
    setProgress(100);
    setUploading(false);
    if (!result.ok) {
      setError(result.error);
      const friendly =
        result.error.startsWith("unsupported file type")
          ? `Cannot upload "${file.name}" — this file type is not allowed.`
          : result.error.startsWith("file too large")
            ? `"${file.name}" is too large. Limit is 25 MB.`
            : `Upload failed: ${result.error}`;
      setMessage("error", friendly);
      return;
    }
    rememberRecentAsset(result.asset, result.filename);
    onPatch((current) => ({
      ...current,
      url: result.asset.url,
      filename: file.name,
      size: file.size,
      mimeType: file.type,
    }));
    setMessage("success", `Uploaded ${result.filename}.`);
  };

  return (
    <div className="mdx-document-file-block">
      <label className="mdx-document-file-block__upload">
        <input
          type="file"
          disabled={uploading}
          onChange={(event) => {
            void handleUpload(event.target.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}
        />
        <span>{uploading ? `Uploading… ${progress}%` : "Choose file"}</span>
      </label>
      <div className="mdx-document-file-block__fields">
        <input
          aria-label="File URL"
          value={block.url ?? ""}
          placeholder="/uploads/file.pdf"
          onChange={(event) =>
            onPatch((current) => ({ ...current, url: event.target.value }))
          }
        />
        <input
          aria-label="File name"
          value={block.filename ?? ""}
          placeholder="file.pdf"
          onChange={(event) =>
            onPatch((current) => ({ ...current, filename: event.target.value }))
          }
        />
        {block.size ? (
          <span className="mdx-document-file-block__meta">
            {formatBytes(block.size)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ---------- PageLink ----------

interface AdminPageEntry {
  slug: string;
  title: string;
  parent?: string;
}

export interface PageLinkEditableBlockProps {
  block: MdxBlock;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  request: RequestFn;
}

export function PageLinkEditableBlock({
  block,
  onPatch,
  request,
}: PageLinkEditableBlockProps) {
  const [pages, setPages] = useState<AdminPageEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await request("/api/site-admin/pages", "GET");
      if (cancelled) return;
      if (!response.ok) return;
      const raw = response.data;
      const list: AdminPageEntry[] = [];
      const items = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as Record<string, unknown> | null)?.items)
          ? ((raw as Record<string, unknown>).items as unknown[])
          : [];
      for (const entry of items) {
        if (!entry || typeof entry !== "object") continue;
        const obj = entry as Record<string, unknown>;
        const slug = typeof obj.slug === "string" ? obj.slug : "";
        if (!slug) continue;
        const title = typeof obj.title === "string" ? obj.title : slug;
        // Treat slug segments separated by "/" as a tree (e.g.
        // "docs/intro" → parent="docs"). The actual admin pages API today
        // returns flat slugs but this stays compatible if it grows.
        const parent = slug.includes("/")
          ? slug.split("/").slice(0, -1).join("/")
          : undefined;
        list.push({ slug, title, parent });
      }
      setPages(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [request]);

  const filtered = query
    ? pages.filter(
        (p) =>
          p.slug.toLowerCase().includes(query.toLowerCase()) ||
          p.title.toLowerCase().includes(query.toLowerCase()),
      )
    : pages;

  // Tree view: only show top-level entries when no search active; clicking
  // a parent expands its children inline. With search active, show flat
  // results so deep matches are reachable in one shot.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (slug: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const tree: AdminPageEntry[] = query
    ? filtered
    : filtered.filter((p) => !p.parent || expanded.has(p.parent));

  const current = pages.find((p) => p.slug === block.pageSlug);
  const childCount = (slug: string) => pages.filter((p) => p.parent === slug).length;

  return (
    <div className="mdx-document-page-link-block">
      <button
        type="button"
        className="mdx-document-page-link-block__current"
        onClick={() => setOpen((prev) => !prev)}
      >
        <strong>{current?.title ?? block.pageSlug ?? "Choose a page"}</strong>
        <span>{block.pageSlug ? `/pages/${block.pageSlug}` : "Click to pick"}</span>
      </button>
      {open ? (
        <div className="mdx-document-page-link-block__picker">
          <input
            autoFocus
            value={query}
            placeholder="Search pages…"
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="mdx-document-page-link-block__list">
            {tree.length === 0 ? (
              <span className="mdx-document-page-link-block__empty">No pages found.</span>
            ) : (
              tree.map((page) => {
                const kids = childCount(page.slug);
                const indent = page.parent ? page.parent.split("/").length : 0;
                return (
                  <div
                    className="mdx-document-page-link-block__row"
                    key={page.slug}
                    style={{ paddingLeft: `${indent * 12}px` }}
                  >
                    {kids > 0 && !query ? (
                      <button
                        type="button"
                        className="mdx-document-page-link-block__expand"
                        onClick={() => toggleExpand(page.slug)}
                        aria-label={expanded.has(page.slug) ? "Collapse" : "Expand"}
                      >
                        {expanded.has(page.slug) ? "▾" : "▸"}
                      </button>
                    ) : (
                      <span className="mdx-document-page-link-block__expand-spacer" />
                    )}
                    <button
                      type="button"
                      className="mdx-document-page-link-block__pick"
                      onClick={() => {
                        onPatch((cur) => ({ ...cur, pageSlug: page.slug }));
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      <strong>{page.title}</strong>
                      <span>/{page.slug}</span>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}
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
  /** Aria label for the limit input — defaults to `${label} block limit`. */
  limitAriaLabel?: string;
}

export function DataBlockEditableBlock({
  block,
  onPatch,
  label,
  icon,
  description,
  limitAriaLabel,
}: DataBlockEditableBlockProps) {
  const limitValue = block.limit !== undefined ? String(block.limit) : "";
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
      <label className="mdx-document-data-block__row">
        <span>Limit</span>
        <input
          aria-label={limitAriaLabel ?? `${label} block limit`}
          type="number"
          min={1}
          step={1}
          placeholder="All"
          value={limitValue}
          onChange={(event) => {
            const raw = event.target.value.trim();
            const next = raw === "" ? undefined : Math.max(1, Math.trunc(Number(raw)));
            onPatch((current) => ({
              ...current,
              limit: Number.isFinite(next as number) ? (next as number) : undefined,
            }));
          }}
        />
      </label>
    </div>
  );
}

// ---------- Hero block ----------
// Inline-config block (no external data source). Lifted from the Home
// builder's hero section so a hero can be inserted into any page —
// e.g. a custom landing page that wraps marketing copy. All fields
// live on the tag itself; the public component renders into the same
// `home-hero` markup as the Home page so existing styles apply.

const HERO_IMAGE_POSITIONS = ["right", "left", "top", "none"] as const;
const HERO_TEXT_ALIGNS = ["left", "center", "right"] as const;

export interface HeroBlockEditableBlockProps {
  block: MdxBlock;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
}

export function HeroBlockEditableBlock({
  block,
  onPatch,
}: HeroBlockEditableBlockProps) {
  const imagePosition = block.imagePosition ?? "right";
  const textAlign = block.textAlign ?? "left";
  return (
    <div className="mdx-document-hero-block">
      <div className="mdx-document-data-block__head">
        <span className="mdx-document-data-block__icon" aria-hidden="true">
          ✶
        </span>
        <div className="mdx-document-data-block__heading">
          <strong>Hero</strong>
          <span>Profile image + headline. Renders with the home-hero CSS.</span>
        </div>
      </div>
      <div className="mdx-document-hero-block__grid">
        <label className="mdx-document-hero-block__field">
          <span>Title</span>
          <input
            value={block.title ?? ""}
            placeholder="Welcome"
            onChange={(event) =>
              onPatch((current) => ({ ...current, title: event.target.value }))
            }
          />
        </label>
        <label className="mdx-document-hero-block__field">
          <span>Subtitle</span>
          <input
            value={block.subtitle ?? ""}
            placeholder="Optional one-liner under the title"
            onChange={(event) =>
              onPatch((current) => ({ ...current, subtitle: event.target.value }))
            }
          />
        </label>
        <label className="mdx-document-hero-block__field">
          <span>Image URL</span>
          <input
            value={block.url ?? ""}
            placeholder="/uploads/profile.jpg"
            onChange={(event) =>
              onPatch((current) => ({ ...current, url: event.target.value }))
            }
          />
        </label>
        <label className="mdx-document-hero-block__field">
          <span>Image alt</span>
          <input
            value={block.alt ?? ""}
            placeholder="Profile photo"
            onChange={(event) =>
              onPatch((current) => ({ ...current, alt: event.target.value }))
            }
          />
        </label>
        <label className="mdx-document-hero-block__field">
          <span>Image position</span>
          <select
            value={imagePosition}
            onChange={(event) =>
              onPatch((current) => ({
                ...current,
                imagePosition: event.target.value as MdxBlock["imagePosition"],
              }))
            }
          >
            {HERO_IMAGE_POSITIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="mdx-document-hero-block__field">
          <span>Text align</span>
          <select
            value={textAlign}
            onChange={(event) =>
              onPatch((current) => ({
                ...current,
                textAlign: event.target.value as MdxBlock["textAlign"],
              }))
            }
          >
            {HERO_TEXT_ALIGNS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

// ---------- Link list block ----------
// Inline-config block for a row/grid/stack of links. Items live as a
// JSON-encoded array on the tag (`<LinkListBlock items='[…]' />`) so
// no parser-level child-JSX support is needed; the editor card owns
// the item-row UI for adding / removing / reordering links.

const LINK_LIST_LAYOUTS = ["stack", "grid", "inline"] as const;

export interface LinkListBlockEditableBlockProps {
  block: MdxBlock;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
}

function patchItems(
  items: MdxLinkItem[] | undefined,
  index: number,
  patch: Partial<MdxLinkItem>,
): MdxLinkItem[] {
  const list = items ? items.slice() : [];
  if (index < 0 || index >= list.length) return list;
  list[index] = { ...list[index], ...patch };
  return list;
}

export function LinkListBlockEditableBlock({
  block,
  onPatch,
}: LinkListBlockEditableBlockProps) {
  const items = block.linkItems ?? [];
  const layout = block.linkLayout ?? "stack";

  const addItem = () =>
    onPatch((current) => ({
      ...current,
      linkItems: [...(current.linkItems ?? []), { label: "", href: "" }],
    }));

  const removeItem = (index: number) =>
    onPatch((current) => ({
      ...current,
      linkItems: (current.linkItems ?? []).filter((_, i) => i !== index),
    }));

  const moveItem = (index: number, direction: -1 | 1) =>
    onPatch((current) => {
      const list = (current.linkItems ?? []).slice();
      const target = index + direction;
      if (target < 0 || target >= list.length) return current;
      [list[index], list[target]] = [list[target], list[index]];
      return { ...current, linkItems: list };
    });

  const updateItem = (index: number, patch: Partial<MdxLinkItem>) =>
    onPatch((current) => ({
      ...current,
      linkItems: patchItems(current.linkItems, index, patch),
    }));

  return (
    <div className="mdx-document-link-list-block">
      <div className="mdx-document-data-block__head">
        <span className="mdx-document-data-block__icon" aria-hidden="true">
          🔗
        </span>
        <div className="mdx-document-data-block__heading">
          <strong>Link list</strong>
          <span>Stack, grid, or inline row of links.</span>
        </div>
      </div>
      <div className="mdx-document-link-list-block__row">
        <label className="mdx-document-hero-block__field">
          <span>Title</span>
          <input
            value={block.title ?? ""}
            placeholder="Optional heading"
            onChange={(event) =>
              onPatch((current) => ({ ...current, title: event.target.value }))
            }
          />
        </label>
        <label className="mdx-document-hero-block__field">
          <span>Layout</span>
          <select
            value={layout}
            onChange={(event) =>
              onPatch((current) => ({
                ...current,
                linkLayout: event.target.value as MdxBlock["linkLayout"],
              }))
            }
          >
            {LINK_LIST_LAYOUTS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ul className="mdx-document-link-list-block__items" role="list">
        {items.length === 0 ? (
          <li className="mdx-document-link-list-block__empty">
            No links yet. Click &ldquo;Add link&rdquo; below.
          </li>
        ) : (
          items.map((item, index) => (
            <li key={index} className="mdx-document-link-list-block__item">
              <input
                aria-label={`Link ${index + 1} label`}
                value={item.label}
                placeholder="Label"
                onChange={(event) =>
                  updateItem(index, { label: event.target.value })
                }
              />
              <input
                aria-label={`Link ${index + 1} URL`}
                value={item.href}
                placeholder="/path or https://"
                onChange={(event) =>
                  updateItem(index, { href: event.target.value })
                }
              />
              <div className="mdx-document-link-list-block__item-actions">
                <button
                  type="button"
                  aria-label="Move up"
                  disabled={index === 0}
                  onClick={() => moveItem(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={index === items.length - 1}
                  onClick={() => moveItem(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label="Remove link"
                  onClick={() => removeItem(index)}
                >
                  ×
                </button>
              </div>
            </li>
          ))
        )}
      </ul>

      <div>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={addItem}
        >
          + Add link
        </button>
      </div>
    </div>
  );
}

// ---------- Featured pages block ----------
// Same item-array pattern as LinkListBlock with two extra dimensions:
// each item carries an optional description (rendered as a card body)
// and the layout has a fixed columns count (2 or 3) instead of a free
// layout string.

const FEATURED_COLUMNS = [2, 3] as const;

export interface FeaturedPagesBlockEditableBlockProps {
  block: MdxBlock;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
}

export function FeaturedPagesBlockEditableBlock({
  block,
  onPatch,
}: FeaturedPagesBlockEditableBlockProps) {
  const items = block.linkItems ?? [];
  const columns = block.columns ?? 2;

  const addItem = () =>
    onPatch((current) => ({
      ...current,
      linkItems: [...(current.linkItems ?? []), { label: "", href: "" }],
    }));

  const removeItem = (index: number) =>
    onPatch((current) => ({
      ...current,
      linkItems: (current.linkItems ?? []).filter((_, i) => i !== index),
    }));

  const moveItem = (index: number, direction: -1 | 1) =>
    onPatch((current) => {
      const list = (current.linkItems ?? []).slice();
      const target = index + direction;
      if (target < 0 || target >= list.length) return current;
      [list[index], list[target]] = [list[target], list[index]];
      return { ...current, linkItems: list };
    });

  const updateItem = (index: number, patch: Partial<MdxLinkItem>) =>
    onPatch((current) => ({
      ...current,
      linkItems: patchItems(current.linkItems, index, patch),
    }));

  return (
    <div className="mdx-document-link-list-block">
      <div className="mdx-document-data-block__head">
        <span className="mdx-document-data-block__icon" aria-hidden="true">
          🗂
        </span>
        <div className="mdx-document-data-block__heading">
          <strong>Featured pages</strong>
          <span>Card grid linking to other pages on the site.</span>
        </div>
      </div>
      <div className="mdx-document-link-list-block__row">
        <label className="mdx-document-hero-block__field">
          <span>Title</span>
          <input
            value={block.title ?? ""}
            placeholder="Optional heading"
            onChange={(event) =>
              onPatch((current) => ({ ...current, title: event.target.value }))
            }
          />
        </label>
        <label className="mdx-document-hero-block__field">
          <span>Columns</span>
          <select
            value={String(columns)}
            onChange={(event) =>
              onPatch((current) => ({
                ...current,
                columns: Number(event.target.value) as 2 | 3,
              }))
            }
          >
            {FEATURED_COLUMNS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ul className="mdx-document-link-list-block__items" role="list">
        {items.length === 0 ? (
          <li className="mdx-document-link-list-block__empty">
            No cards yet. Click &ldquo;Add card&rdquo; below.
          </li>
        ) : (
          items.map((item, index) => (
            <li key={index} className="mdx-document-link-list-block__item mdx-document-link-list-block__item--featured">
              <input
                aria-label={`Card ${index + 1} label`}
                value={item.label}
                placeholder="Title"
                onChange={(event) =>
                  updateItem(index, { label: event.target.value })
                }
              />
              <input
                aria-label={`Card ${index + 1} URL`}
                value={item.href}
                placeholder="/path or https://"
                onChange={(event) =>
                  updateItem(index, { href: event.target.value })
                }
              />
              <input
                aria-label={`Card ${index + 1} description`}
                value={item.description ?? ""}
                placeholder="Optional description"
                onChange={(event) =>
                  updateItem(index, {
                    description: event.target.value || undefined,
                  })
                }
              />
              <div className="mdx-document-link-list-block__item-actions">
                <button
                  type="button"
                  aria-label="Move up"
                  disabled={index === 0}
                  onClick={() => moveItem(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={index === items.length - 1}
                  onClick={() => moveItem(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label="Remove card"
                  onClick={() => removeItem(index)}
                >
                  ×
                </button>
              </div>
            </li>
          ))
        )}
      </ul>

      <div>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={addItem}
        >
          + Add card
        </button>
      </div>
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

export function ColumnsEditableBlock({
  block,
  depth,
  onPatch,
  renderChildren,
}: ColumnsEditableBlockProps) {
  const count: 2 | 3 = (block.columns ?? 2) >= 3 ? 3 : 2;
  const gap = block.columnsGap ?? "standard";
  const align = block.columnsAlign ?? "start";
  const variant = block.columnsVariant ?? "";
  const columns = block.children ?? [];

  const setCount = (next: 2 | 3) => {
    onPatch((current) => {
      const nextChildren = (current.children ?? []).slice();
      while (nextChildren.length < next) nextChildren.push(createMdxBlock("column"));
      return { ...current, columns: next, children: nextChildren.slice(0, next) };
    });
  };

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
      <div className="mdx-document-columns-block__toolbar">
        <label>
          <span>Columns</span>
          <select
            value={count}
            onChange={(event) => setCount(Number(event.target.value) as 2 | 3)}
            aria-label="Column count"
          >
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
        <label>
          <span>Gap</span>
          <select
            value={gap}
            onChange={(event) =>
              onPatch((current) => ({
                ...current,
                columnsGap: event.target.value as "compact" | "standard" | "loose",
              }))
            }
            aria-label="Column gap"
          >
            <option value="compact">Compact</option>
            <option value="standard">Standard</option>
            <option value="loose">Loose</option>
          </select>
        </label>
        <label>
          <span>Align</span>
          <select
            value={align}
            onChange={(event) =>
              onPatch((current) => ({
                ...current,
                columnsAlign: event.target.value as "start" | "center",
              }))
            }
            aria-label="Vertical alignment"
          >
            <option value="start">Top</option>
            <option value="center">Middle</option>
          </select>
        </label>
        <label>
          <span>Variant</span>
          <select
            value={variant}
            onChange={(event) => {
              const value = event.target.value;
              onPatch((current) => ({
                ...current,
                columnsVariant: value === "classicIntro" ? "classicIntro" : undefined,
              }));
            }}
            aria-label="Column variant"
          >
            <option value="">Default</option>
            <option value="classicIntro">Classic Intro</option>
          </select>
        </label>
      </div>
      <div className="mdx-document-columns-block__grid">
        {columns.slice(0, count).map((column, idx) => (
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

export function ColumnEditableBlock({
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
