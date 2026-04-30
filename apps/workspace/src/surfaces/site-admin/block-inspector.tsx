import { useState, type ReactNode } from "react";

import { AssetLibraryPicker, rememberRecentAsset } from "./AssetLibraryPicker";
import { uploadGenericFile } from "./assets-upload";
import {
  EMBED_KIND_LABELS,
  formatBytes,
  previewSrcForEmbed,
} from "./mdx-block-renderers";
import {
  createMdxBlock,
  type MdxBlock,
  type MdxEmbedKind,
} from "./mdx-blocks";
import { LinkItemsEditor } from "./LinkItemsEditor";
import { useImeComposition } from "./useImeComposition";
import type { NormalizedApiResponse } from "./types";
import {
  WorkspaceInspector,
  WorkspaceInspectorHeader,
  WorkspaceInspectorSection,
} from "../../ui/primitives";

type RequestFn = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<NormalizedApiResponse>;

const HERO_IMAGE_POSITIONS = ["right", "left", "top", "none"] as const;
const HERO_TEXT_ALIGNS = ["left", "center", "right"] as const;
const LINK_LIST_LAYOUTS = ["stack", "grid", "inline"] as const;
const FEATURED_COLUMNS = [2, 3] as const;
const COLUMN_COUNTS = [2, 3] as const;
const COLUMN_GAPS = ["compact", "standard", "loose"] as const;
const COLUMN_ALIGNS = ["start", "center"] as const;

const BLOCK_LABELS: Partial<Record<MdxBlock["type"], string>> = {
  image: "Image",
  bookmark: "Bookmark",
  table: "Table",
  embed: "Embed",
  file: "File",
  "page-link": "Page link",
  "news-block": "News",
  "publications-block": "Publications",
  "works-block": "Works",
  "teaching-block": "Teaching",
  "hero-block": "Hero",
  "link-list-block": "Link list",
  "featured-pages-block": "Featured pages",
  columns: "Columns",
  "teaching-links": "Teaching links",
  "publications-profile-links": "Profile links",
  code: "Code",
  raw: "Raw MDX",
};

export function blockHasInspector(block: MdxBlock): boolean {
  return Boolean(BLOCK_LABELS[block.type]);
}

function hostLabel(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url, "https://jinkunchen.com").hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizedTable(block: MdxBlock) {
  const data = block.tableData ?? {
    headerRow: true,
    rows: [
      ["", ""],
      ["", ""],
    ],
  };
  const rows = data.rows.length > 0 ? data.rows : [["", ""]];
  const colCount = Math.max(1, rows[0]?.length ?? 1);
  return {
    ...data,
    rows: rows.map((row) => {
      const next = row.slice(0, colCount);
      while (next.length < colCount) next.push("");
      return next;
    }),
  };
}

function updateTableCell(
  block: MdxBlock,
  rowIndex: number,
  colIndex: number,
  value: string,
): MdxBlock {
  const tableData = normalizedTable(block);
  const rows = tableData.rows.map((row) => row.slice());
  rows[rowIndex][colIndex] = value;
  return { ...block, tableData: { ...tableData, rows } };
}

export function BlockInspector({
  block,
  onClose,
  onPatch,
  onUploadImage,
  readOnly,
  request,
  setError,
  setMessage,
  uploading,
}: {
  block: MdxBlock;
  onClose: () => void;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  onUploadImage: (file: File | null) => void;
  readOnly: boolean;
  request: RequestFn;
  setError: (error: string) => void;
  setMessage: (kind: "error" | "success", text: string) => void;
  uploading: boolean;
}) {
  const [fetchingBookmark, setFetchingBookmark] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [fileProgress, setFileProgress] = useState(0);
  const label = BLOCK_LABELS[block.type] ?? "Block";

  const fetchBookmarkMeta = async () => {
    const url = block.url?.trim() ?? "";
    if (!url) {
      setMessage("error", "Enter a bookmark URL first.");
      return;
    }
    setFetchingBookmark(true);
    const response = await request("/api/site-admin/og-fetch", "POST", { url });
    setFetchingBookmark(false);
    if (!response.ok) {
      const message = `Bookmark fetch failed: ${response.code}: ${response.error}`;
      setError(message);
      setMessage("error", message);
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

  const uploadFile = async (file: File | null) => {
    if (!file || uploadingFile) return;
    setUploadingFile(true);
    setFileProgress(0);
    const ticker = window.setInterval(() => {
      setFileProgress((p) => Math.min(p + 5, 90));
    }, 150);
    const result = await uploadGenericFile({ file, request });
    window.clearInterval(ticker);
    setFileProgress(100);
    setUploadingFile(false);
    if (!result.ok) {
      setError(result.error);
      const friendly = result.error.startsWith("unsupported file type")
        ? `Cannot upload "${file.name}" - this file type is not allowed.`
        : result.error.startsWith("file too large")
          ? `"${file.name}" is too large. Limit is 25 MB.`
          : `Upload failed: ${result.error}`;
      setMessage("error", friendly);
      return;
    }
    rememberRecentAsset(result.asset, result.filename);
    onPatch((current) => ({
      ...current,
      filename: file.name,
      mimeType: file.type,
      size: file.size,
      url: result.asset.url,
    }));
    setMessage("success", `Uploaded ${result.filename}.`);
  };

  return (
    <WorkspaceInspector
      className="mdx-block-inspector"
      label={`${label} block inspector`}
    >
      <WorkspaceInspectorHeader
        heading={label}
        kicker="Block"
        actions={
          <button
            type="button"
            className="btn btn--ghost mdx-block-inspector__close"
            onClick={onClose}
            aria-label="Close block inspector"
          >
            x
          </button>
        }
      />
      <div className="workspace-inspector__body">
        <WorkspaceInspectorSection
          heading="Appearance"
          description="Configure the selected block without putting forms in the writing canvas."
        >
          <InspectorSelect
            label="Color"
            disabled={readOnly}
            value={block.color ?? "default"}
            onChange={(color) =>
              onPatch((current) => ({
                ...current,
                color: color as MdxBlock["color"],
              }))
            }
          >
            {[
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
            ].map((color) => (
              <option key={color} value={color}>
                {color}
              </option>
            ))}
          </InspectorSelect>
        </WorkspaceInspectorSection>

        <TypeSpecificInspector
          block={block}
          fetchingBookmark={fetchingBookmark}
          fileProgress={fileProgress}
          onFetchBookmarkMeta={fetchBookmarkMeta}
          onPatch={onPatch}
          onUploadFile={(file) => void uploadFile(file)}
          onUploadImage={onUploadImage}
          readOnly={readOnly}
          setMessage={setMessage}
          uploading={uploading}
          uploadingFile={uploadingFile}
        />
      </div>
    </WorkspaceInspector>
  );
}

function TypeSpecificInspector({
  block,
  fetchingBookmark,
  fileProgress,
  onFetchBookmarkMeta,
  onPatch,
  onUploadFile,
  onUploadImage,
  readOnly,
  setMessage,
  uploading,
  uploadingFile,
}: {
  block: MdxBlock;
  fetchingBookmark: boolean;
  fileProgress: number;
  onFetchBookmarkMeta: () => void;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  onUploadFile: (file: File | null) => void;
  onUploadImage: (file: File | null) => void;
  readOnly: boolean;
  setMessage: (kind: "error" | "success", text: string) => void;
  uploading: boolean;
  uploadingFile: boolean;
}) {
  if (block.type === "image") {
    return (
      <WorkspaceInspectorSection heading="Image">
        <InspectorFileButton
          disabled={readOnly || uploading}
          label={uploading ? "Uploading..." : "Upload image"}
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif"
          onChange={onUploadImage}
        />
        <InspectorTextField
          label="URL"
          disabled={readOnly}
          value={block.url ?? ""}
          placeholder="/uploads/image.png"
          onChange={(value) => onPatch((current) => ({ ...current, url: value }))}
        />
        <InspectorTextField
          label="Alt text"
          disabled={readOnly}
          value={block.alt ?? ""}
          placeholder="Describe the image"
          onChange={(value) => onPatch((current) => ({ ...current, alt: value }))}
        />
        <InspectorTextField
          label="Caption"
          disabled={readOnly}
          value={block.caption ?? ""}
          placeholder="Optional caption"
          onChange={(value) =>
            onPatch((current) => ({ ...current, caption: value }))
          }
        />
        {readOnly ? null : (
          <AssetLibraryPicker
            currentUrl={block.url}
            onSelect={(asset) => {
              onPatch((current) => ({
                ...current,
                alt: current.alt || asset.alt || asset.filename || "image",
                url: asset.url,
              }));
              setMessage("success", "Image asset selected.");
            }}
          />
        )}
      </WorkspaceInspectorSection>
    );
  }

  if (block.type === "bookmark") {
    return (
      <WorkspaceInspectorSection heading="Bookmark">
        <div className="mdx-block-inspector__inline-action">
          <InspectorTextField
            label="URL"
            disabled={readOnly}
            value={block.url ?? ""}
            placeholder="https://example.com"
            onChange={(value) =>
              onPatch((current) => ({ ...current, url: value }))
            }
          />
          <button
            type="button"
            className="btn btn--secondary"
            disabled={readOnly || fetchingBookmark || !block.url?.trim()}
            onClick={onFetchBookmarkMeta}
          >
            {fetchingBookmark ? "Fetching..." : "Fetch"}
          </button>
        </div>
        <InspectorTextField
          label="Title"
          disabled={readOnly}
          value={block.title ?? ""}
          placeholder="Bookmark title"
          onChange={(value) => onPatch((current) => ({ ...current, title: value }))}
        />
        <InspectorTextField
          label="Description"
          disabled={readOnly}
          multiline
          value={block.description ?? ""}
          placeholder="Short description"
          onChange={(value) =>
            onPatch((current) => ({ ...current, description: value }))
          }
        />
        <InspectorTextField
          label="Provider"
          disabled={readOnly}
          value={block.provider ?? ""}
          placeholder={hostLabel(block.url) || "example.com"}
          onChange={(value) =>
            onPatch((current) => ({ ...current, provider: value }))
          }
        />
        <InspectorTextField
          label="Thumbnail URL"
          disabled={readOnly}
          value={block.image ?? ""}
          placeholder="/uploads/thumbnail.png"
          onChange={(value) => onPatch((current) => ({ ...current, image: value }))}
        />
      </WorkspaceInspectorSection>
    );
  }

  if (block.type === "table") {
    return <TableInspector block={block} onPatch={onPatch} readOnly={readOnly} />;
  }

  if (block.type === "embed") {
    const kind = block.embedKind ?? "iframe";
    const previewSrc = previewSrcForEmbed(kind, block.url ?? "");
    return (
      <WorkspaceInspectorSection heading="Embed">
        <InspectorSelect
          label="Kind"
          disabled={readOnly}
          value={kind}
          onChange={(value) =>
            onPatch((current) => ({
              ...current,
              embedKind: value as MdxEmbedKind,
            }))
          }
        >
          {(Object.keys(EMBED_KIND_LABELS) as MdxEmbedKind[]).map((value) => (
            <option key={value} value={value}>
              {EMBED_KIND_LABELS[value]}
            </option>
          ))}
        </InspectorSelect>
        <InspectorTextField
          label="URL"
          disabled={readOnly}
          value={block.url ?? ""}
          placeholder="https://..."
          onChange={(value) => onPatch((current) => ({ ...current, url: value }))}
        />
        {previewSrc ? (
          <p className="mdx-block-inspector__hint">Preview source is ready.</p>
        ) : (
          <p className="mdx-block-inspector__hint">Paste a URL to preview the embed.</p>
        )}
      </WorkspaceInspectorSection>
    );
  }

  if (block.type === "file") {
    return (
      <WorkspaceInspectorSection heading="File">
        <InspectorFileButton
          disabled={readOnly || uploadingFile}
          label={uploadingFile ? `Uploading... ${fileProgress}%` : "Upload file"}
          accept="*"
          onChange={onUploadFile}
        />
        <InspectorTextField
          label="URL"
          disabled={readOnly}
          value={block.url ?? ""}
          placeholder="/uploads/file.pdf"
          onChange={(value) => onPatch((current) => ({ ...current, url: value }))}
        />
        <InspectorTextField
          label="Filename"
          disabled={readOnly}
          value={block.filename ?? ""}
          placeholder="file.pdf"
          onChange={(value) =>
            onPatch((current) => ({ ...current, filename: value }))
          }
        />
        {block.size ? (
          <p className="mdx-block-inspector__hint">{formatBytes(block.size)}</p>
        ) : null}
      </WorkspaceInspectorSection>
    );
  }

  if (block.type === "page-link") {
    return (
      <WorkspaceInspectorSection heading="Page link">
        <InspectorTextField
          label="Page slug"
          disabled={readOnly}
          value={block.pageSlug ?? ""}
          placeholder="teaching/archive"
          onChange={(value) =>
            onPatch((current) => ({ ...current, pageSlug: value }))
          }
        />
        <InspectorTextField
          label="Label"
          disabled={readOnly}
          value={block.title ?? ""}
          placeholder="Optional display label"
          onChange={(value) => onPatch((current) => ({ ...current, title: value }))}
        />
      </WorkspaceInspectorSection>
    );
  }

  if (
    block.type === "news-block" ||
    block.type === "publications-block" ||
    block.type === "works-block" ||
    block.type === "teaching-block"
  ) {
    return (
      <WorkspaceInspectorSection heading="Data source">
        <InspectorTextField
          label="Limit"
          disabled={readOnly}
          value={block.limit !== undefined ? String(block.limit) : ""}
          placeholder="All"
          type="number"
          onChange={(value) => {
            const raw = value.trim();
            const next = raw === "" ? undefined : Math.max(1, Math.trunc(Number(raw)));
            onPatch((current) => ({
              ...current,
              limit: Number.isFinite(next as number) ? (next as number) : undefined,
            }));
          }}
        />
      </WorkspaceInspectorSection>
    );
  }

  if (block.type === "hero-block") {
    return (
      <WorkspaceInspectorSection heading="Hero">
        <InspectorTextField
          label="Title"
          disabled={readOnly}
          value={block.title ?? ""}
          placeholder="Welcome"
          onChange={(value) => onPatch((current) => ({ ...current, title: value }))}
        />
        <InspectorTextField
          label="Subtitle"
          disabled={readOnly}
          value={block.subtitle ?? ""}
          placeholder="Optional one-liner"
          onChange={(value) =>
            onPatch((current) => ({ ...current, subtitle: value }))
          }
        />
        <InspectorTextField
          label="Image URL"
          disabled={readOnly}
          value={block.url ?? ""}
          placeholder="/uploads/profile.jpg"
          onChange={(value) => onPatch((current) => ({ ...current, url: value }))}
        />
        <InspectorTextField
          label="Image alt"
          disabled={readOnly}
          value={block.alt ?? ""}
          placeholder="Profile photo"
          onChange={(value) => onPatch((current) => ({ ...current, alt: value }))}
        />
        <InspectorSelect
          label="Image position"
          disabled={readOnly}
          value={block.imagePosition ?? "right"}
          onChange={(value) =>
            onPatch((current) => ({
              ...current,
              imagePosition: value as MdxBlock["imagePosition"],
            }))
          }
        >
          {HERO_IMAGE_POSITIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </InspectorSelect>
        <InspectorSelect
          label="Text align"
          disabled={readOnly}
          value={block.textAlign ?? "left"}
          onChange={(value) =>
            onPatch((current) => ({
              ...current,
              textAlign: value as MdxBlock["textAlign"],
            }))
          }
        >
          {HERO_TEXT_ALIGNS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </InspectorSelect>
      </WorkspaceInspectorSection>
    );
  }

  if (block.type === "link-list-block") {
    return (
      <WorkspaceInspectorSection heading="Links">
        <InspectorTextField
          label="Title"
          disabled={readOnly}
          value={block.title ?? ""}
          placeholder="Optional heading"
          onChange={(value) => onPatch((current) => ({ ...current, title: value }))}
        />
        <InspectorSelect
          label="Layout"
          disabled={readOnly}
          value={block.linkLayout ?? "stack"}
          onChange={(value) =>
            onPatch((current) => ({
              ...current,
              linkLayout: value as MdxBlock["linkLayout"],
            }))
          }
        >
          {LINK_LIST_LAYOUTS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </InspectorSelect>
        <LinkItemsEditor
          addLabel="+ Add link"
          disabled={readOnly}
          emptyLabel="No links yet."
          items={block.linkItems ?? []}
          onChange={(items) =>
            onPatch((current) => ({ ...current, linkItems: items }))
          }
          variant="inspector"
        />
      </WorkspaceInspectorSection>
    );
  }

  if (block.type === "featured-pages-block") {
    return (
      <WorkspaceInspectorSection heading="Featured pages">
        <InspectorTextField
          label="Title"
          disabled={readOnly}
          value={block.title ?? ""}
          placeholder="Optional heading"
          onChange={(value) => onPatch((current) => ({ ...current, title: value }))}
        />
        <InspectorSelect
          label="Columns"
          disabled={readOnly}
          value={String(block.columns ?? 2)}
          onChange={(value) =>
            onPatch((current) => ({
              ...current,
              columns: Number(value) as 2 | 3,
            }))
          }
        >
          {FEATURED_COLUMNS.map((value) => (
            <option key={value} value={String(value)}>
              {value}
            </option>
          ))}
        </InspectorSelect>
        <LinkItemsEditor
          addLabel="+ Add card"
          disabled={readOnly}
          emptyLabel="No featured pages yet."
          featured
          items={block.linkItems ?? []}
          onChange={(items) =>
            onPatch((current) => ({ ...current, linkItems: items }))
          }
          variant="inspector"
        />
      </WorkspaceInspectorSection>
    );
  }

  if (block.type === "columns") {
    return (
      <WorkspaceInspectorSection heading="Columns">
        <InspectorSelect
          label="Count"
          disabled={readOnly}
          value={String(block.columns ?? 2)}
          onChange={(value) =>
            onPatch((current) => {
              const count = Number(value) as 2 | 3;
              const children = (current.children ?? []).slice();
              while (children.length < count) {
                children.push(createMdxBlock("column"));
              }
              return { ...current, columns: count, children: children.slice(0, count) };
            })
          }
        >
          {COLUMN_COUNTS.map((value) => (
            <option key={value} value={String(value)}>
              {value}
            </option>
          ))}
        </InspectorSelect>
        <InspectorSelect
          label="Gap"
          disabled={readOnly}
          value={block.columnsGap ?? "standard"}
          onChange={(value) =>
            onPatch((current) => ({
              ...current,
              columnsGap: value as MdxBlock["columnsGap"],
            }))
          }
        >
          {COLUMN_GAPS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </InspectorSelect>
        <InspectorSelect
          label="Align"
          disabled={readOnly}
          value={block.columnsAlign ?? "start"}
          onChange={(value) =>
            onPatch((current) => ({
              ...current,
              columnsAlign: value as MdxBlock["columnsAlign"],
            }))
          }
        >
          {COLUMN_ALIGNS.map((value) => (
            <option key={value} value={value}>
              {value === "start" ? "top" : "middle"}
            </option>
          ))}
        </InspectorSelect>
        <InspectorSelect
          label="Variant"
          disabled={readOnly}
          value={block.columnsVariant ?? ""}
          onChange={(value) =>
            onPatch((current) => ({
              ...current,
              columnsVariant: value === "classicIntro" ? "classicIntro" : undefined,
            }))
          }
        >
          <option value="">default</option>
          <option value="classicIntro">classic intro</option>
        </InspectorSelect>
      </WorkspaceInspectorSection>
    );
  }

  if (block.type === "teaching-links") {
    return (
      <WorkspaceInspectorSection heading="Teaching links">
        <InspectorSelect
          label="Variant"
          disabled={readOnly}
          value={block.teachingLinksVariant ?? "header"}
          onChange={(value) =>
            onPatch((current) => ({
              ...current,
              teachingLinksVariant: value === "footer" ? "footer" : "header",
            }))
          }
        >
          <option value="header">header</option>
          <option value="footer">footer</option>
        </InspectorSelect>
        <LinkItemsEditor
          addLabel="+ Add link"
          disabled={readOnly}
          emptyLabel="No teaching links yet."
          items={block.linkItems ?? []}
          onChange={(items) =>
            onPatch((current) => ({ ...current, linkItems: items }))
          }
          variant="inspector"
        />
      </WorkspaceInspectorSection>
    );
  }

  if (block.type === "publications-profile-links") {
    return (
      <WorkspaceInspectorSection heading="Profile links">
        <LinkItemsEditor
          addLabel="+ Add link"
          disabled={readOnly}
          emptyLabel="No profile links yet."
          items={block.linkItems ?? []}
          onChange={(items) =>
            onPatch((current) => ({ ...current, linkItems: items }))
          }
          variant="inspector"
          withHostname
        />
      </WorkspaceInspectorSection>
    );
  }

  if (block.type === "code" || block.type === "raw") {
    return (
      <WorkspaceInspectorSection heading="Advanced">
        {block.type === "code" ? (
          <InspectorTextField
            label="Language"
            disabled={readOnly}
            value={block.language ?? ""}
            placeholder="ts, jsx, python"
            onChange={(value) =>
              onPatch((current) => ({ ...current, language: value }))
            }
          />
        ) : (
          <p className="mdx-block-inspector__hint">
            Raw MDX is kept as an escape hatch. Prefer regular blocks when the
            content should remain visual-first.
          </p>
        )}
      </WorkspaceInspectorSection>
    );
  }

  return null;
}

function TableInspector({
  block,
  onPatch,
  readOnly,
}: {
  block: MdxBlock;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  readOnly: boolean;
}) {
  const table = normalizedTable(block);
  const colCount = table.rows[0]?.length ?? 1;

  const addRow = () => {
    onPatch((current) => {
      const data = normalizedTable(current);
      return {
        ...current,
        tableData: {
          ...data,
          rows: [...data.rows, new Array(colCount).fill("")],
        },
      };
    });
  };

  const addColumn = () => {
    onPatch((current) => {
      const data = normalizedTable(current);
      return {
        ...current,
        tableData: {
          ...data,
          align: data.align ? [...data.align, "left"] : undefined,
          rows: data.rows.map((row) => [...row, ""]),
        },
      };
    });
  };

  return (
    <WorkspaceInspectorSection heading="Table">
      <label className="mdx-block-inspector__check">
        <input
          type="checkbox"
          disabled={readOnly}
          checked={table.headerRow ?? true}
          onChange={(event) =>
            onPatch((current) => ({
              ...current,
              tableData: {
                ...normalizedTable(current),
                headerRow: event.target.checked,
              },
            }))
          }
        />
        <span>First row is header</span>
      </label>
      <div className="mdx-block-inspector__table">
        {table.rows.map((row, rowIndex) => (
          <div className="mdx-block-inspector__table-row" key={rowIndex}>
            {row.map((cell, colIndex) => (
              <input
                key={colIndex}
                disabled={readOnly}
                aria-label={`Row ${rowIndex + 1}, column ${colIndex + 1}`}
                value={cell}
                placeholder={rowIndex === 0 ? "Header" : ""}
                onChange={(event) =>
                  onPatch((current) =>
                    updateTableCell(current, rowIndex, colIndex, event.target.value),
                  )
                }
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mdx-block-inspector__item-actions">
        <button type="button" className="btn btn--secondary" disabled={readOnly} onClick={addRow}>
          + Row
        </button>
        <button type="button" className="btn btn--secondary" disabled={readOnly} onClick={addColumn}>
          + Column
        </button>
      </div>
    </WorkspaceInspectorSection>
  );
}

function InspectorTextField({
  disabled,
  label,
  multiline = false,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  disabled: boolean;
  label: string;
  multiline?: boolean;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  value: string;
}) {
  const ime = useImeComposition(onChange);
  return (
    <label className="mdx-block-inspector__field">
      <span>{label}</span>
      {multiline ? (
        <textarea
          disabled={disabled}
          rows={3}
          value={value}
          placeholder={placeholder}
          onChange={ime.onChange}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
        />
      ) : (
        <input
          disabled={disabled}
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={ime.onChange}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
        />
      )}
    </label>
  );
}

function InspectorSelect({
  children,
  disabled,
  label,
  onChange,
  value,
}: {
  children: ReactNode;
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="mdx-block-inspector__field">
      <span>{label}</span>
      <select
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

function InspectorFileButton({
  accept,
  disabled,
  label,
  onChange,
}: {
  accept: string;
  disabled: boolean;
  label: string;
  onChange: (file: File | null) => void;
}) {
  return (
    <label className="btn btn--secondary mdx-block-inspector__file">
      <span>{label}</span>
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.files?.[0] ?? null);
          event.currentTarget.value = "";
        }}
      />
    </label>
  );
}
