import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";

import { AssetLibraryPicker, rememberRecentAsset } from "./AssetLibraryPicker";
import { MarkdownEditor } from "./LazyMarkdownEditor";
import { uploadImageFile } from "./assets-upload";
import {
  createMdxBlock,
  parseMdxBlocks,
  serializeMdxBlocks,
  type MdxBlock,
  type MdxBlockType,
} from "./mdx-blocks";
import { useSiteAdmin } from "./state";
import { formatDraftAge, useEditorDraft, type EditorKind } from "./use-editor-draft";
import {
  useConfirmingBack,
  useMdxImageUploadDrop,
  useUnsavedChangesBeforeUnload,
} from "./use-mdx-editor-controller";
import { isBoolean, isString, usePersistentUiState } from "./use-persistent-ui-state";
import type { NormalizedApiResponse } from "./types";
import { normalizeString } from "./utils";
import { usePreview } from "./use-preview";

type DocumentEditorMode = "blocks" | "source" | "preview";
type DocumentExitAction = "saved" | "deleted" | "cancel";

type RequestFn = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<NormalizedApiResponse>;

const DOCUMENT_EDITOR_MODES: DocumentEditorMode[] = ["blocks", "source", "preview"];

const DOCUMENT_EDITOR_MODE_LABELS: Record<DocumentEditorMode, string> = {
  blocks: "Write",
  source: "Source",
  preview: "Preview",
};

const BLOCK_TYPE_LABELS: Record<MdxBlockType, string> = {
  paragraph: "Text",
  heading: "Heading",
  image: "Image",
  quote: "Quote",
  list: "List",
  divider: "Divider",
  callout: "Callout",
  code: "Code",
  raw: "Raw MDX",
};

function isDocumentEditorMode(value: unknown): value is DocumentEditorMode {
  return isString(value) && DOCUMENT_EDITOR_MODES.includes(value as DocumentEditorMode);
}

export interface MdxDocumentPropertiesProps<TForm> {
  form: TForm;
  mode: "create" | "edit";
  setForm: Dispatch<SetStateAction<TForm>>;
  setSlug: (slug: string) => void;
  slug: string;
  slugHint: string;
}

export interface MdxDocumentEditorAdapter<TForm> {
  buildSource: (form: TForm, body: string) => string;
  canSave: (state: {
    body: string;
    form: TForm;
    mode: "create" | "edit";
    slug: string;
  }) => boolean;
  contentPath: (slug: string) => string;
  createBlankForm: () => TForm;
  defaultBody: string;
  getTitle: (form: TForm) => string;
  kind: EditorKind;
  parseSource: (source: string) => { body: string; form: TForm };
  renderProperties: (props: MdxDocumentPropertiesProps<TForm>) => ReactNode;
  routeBase: string;
  setTitle: (form: TForm, title: string) => TForm;
  titleNoun: string;
}

export interface MdxDocumentEditorProps<TForm> {
  adapter: MdxDocumentEditorAdapter<TForm>;
  mode: "create" | "edit";
  onExit: (action: DocumentExitAction, slug?: string) => void;
  slug?: string;
}

function readSlashCommand(value: string): MdxBlockType | null {
  const command = value.trim().toLowerCase();
  if (command === "/text" || command === "/paragraph") return "paragraph";
  if (command === "/h1" || command === "/h2" || command === "/h3" || command === "/heading") {
    return "heading";
  }
  if (command === "/image") return "image";
  if (command === "/quote") return "quote";
  if (command === "/list" || command === "/bullet" || command === "/bulleted") return "list";
  if (command === "/divider" || command === "/hr") return "divider";
  if (command === "/callout" || command === "/note") return "callout";
  if (command === "/code") return "code";
  if (command === "/raw" || command === "/mdx") return "raw";
  return null;
}

function blockFromSlashCommand(value: string): MdxBlock | null {
  const type = readSlashCommand(value);
  if (!type) return null;
  const block = createMdxBlock(type);
  if (type === "heading") {
    const command = value.trim().toLowerCase();
    if (command === "/h1") return { ...block, level: 1, text: "Heading" };
    if (command === "/h3") return { ...block, level: 3, text: "Heading" };
  }
  return block;
}

function replaceBlockType(block: MdxBlock, type: MdxBlockType): MdxBlock {
  if (block.type === type) return block;
  const next = createMdxBlock(type);
  if (
    type === "paragraph" ||
    type === "heading" ||
    type === "quote" ||
    type === "list" ||
    type === "callout" ||
    type === "code" ||
    type === "raw"
  ) {
    return { ...next, text: block.text };
  }
  if (type === "divider") return next;
  return { ...next, alt: block.text.slice(0, 80), text: "" };
}

function BodyBlockCanvas({
  body,
  onChange,
  request,
  setError,
  setMessage,
}: {
  body: string;
  onChange: (value: string) => void;
  request: RequestFn;
  setError: (error: string) => void;
  setMessage: (kind: "error" | "success", text: string) => void;
}) {
  const [blocks, setBlocks] = useState<MdxBlock[]>(() => parseMdxBlocks(body));
  const [dragDepth, setDragDepth] = useState(0);
  const [draggingBlockId, setDraggingBlockId] = useState("");
  const [dragOverBlockId, setDragOverBlockId] = useState("");
  const [uploadingId, setUploadingId] = useState("");
  const lastEmittedBodyRef = useRef(body);

  useEffect(() => {
    if (body === lastEmittedBodyRef.current) return;
    lastEmittedBodyRef.current = body;
    // External body updates come from draft restore/source mode; the block
    // canvas keeps local IDs so focused blocks do not remount on every keystroke.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBlocks(parseMdxBlocks(body));
  }, [body]);

  const commitBlocks = useCallback(
    (nextBlocks: MdxBlock[]) => {
      const normalized = nextBlocks.length > 0 ? nextBlocks : [createMdxBlock("paragraph")];
      const nextBody = serializeMdxBlocks(normalized);
      setBlocks(normalized);
      lastEmittedBodyRef.current = nextBody;
      onChange(nextBody);
    },
    [onChange],
  );

  const patchBlock = useCallback(
    (id: string, patcher: (block: MdxBlock) => MdxBlock) => {
      commitBlocks(blocks.map((block) => (block.id === id ? patcher(block) : block)));
    },
    [blocks, commitBlocks],
  );

  const insertBlock = useCallback(
    (afterIndex: number, type: MdxBlockType) => {
      const next = blocks.slice();
      next.splice(afterIndex + 1, 0, createMdxBlock(type));
      commitBlocks(next);
    },
    [blocks, commitBlocks],
  );

  const appendImageBlock = useCallback(
    (url: string, alt: string) => {
      commitBlocks([
        ...blocks,
        {
          ...createMdxBlock("image"),
          alt,
          url,
        },
      ]);
    },
    [blocks, commitBlocks],
  );

  const uploadImageIntoBlock = useCallback(
    async (blockId: string, file: File | null) => {
      if (!file || uploadingId) return;
      setUploadingId(blockId);
      const result = await uploadImageFile({ file, request });
      setUploadingId("");
      if (!result.ok) {
        setError(result.error);
        setMessage("error", `Upload failed: ${result.error}`);
        return;
      }
      rememberRecentAsset(result.asset, result.filename);
      patchBlock(blockId, (block) => ({
        ...block,
        alt: block.alt || file.name.replace(/\.[^.]+$/, "") || result.filename,
        url: result.asset.url,
      }));
      setMessage("success", `Uploaded ${result.filename}.`);
    },
    [patchBlock, request, setError, setMessage, uploadingId],
  );

  const uploadDroppedImages = useCallback(
    async (files: File[]) => {
      const nextBlocks = blocks.slice();
      for (const file of files) {
        setUploadingId("drop");
        const result = await uploadImageFile({ file, request });
        setUploadingId("");
        if (!result.ok) {
          setError(result.error);
          setMessage("error", `Upload failed: ${result.error}`);
          continue;
        }
        rememberRecentAsset(result.asset, result.filename);
        nextBlocks.push({
          ...createMdxBlock("image"),
          alt: file.name.replace(/\.[^.]+$/, "") || result.filename,
          url: result.asset.url,
        });
        setMessage("success", `Uploaded ${result.filename}.`);
      }
      commitBlocks(nextBlocks);
    },
    [blocks, commitBlocks, request, setError, setMessage],
  );

  const moveBlock = useCallback(
    (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= blocks.length) return;
      const next = blocks.slice();
      [next[index], next[target]] = [next[target], next[index]];
      commitBlocks(next);
    },
    [blocks, commitBlocks],
  );

  const moveBlockTo = useCallback(
    (draggedId: string, targetId: string) => {
      if (!draggedId || draggedId === targetId) return;
      const from = blocks.findIndex((block) => block.id === draggedId);
      const to = blocks.findIndex((block) => block.id === targetId);
      if (from < 0 || to < 0) return;
      const next = blocks.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      commitBlocks(next);
    },
    [blocks, commitBlocks],
  );

  const removeBlock = useCallback(
    (id: string) => {
      const next = blocks.filter((block) => block.id !== id);
      commitBlocks(next.length > 0 ? next : [createMdxBlock("paragraph")]);
    },
    [blocks, commitBlocks],
  );

  return (
    <div
      className="mdx-document-blocks"
      data-drag-active={dragDepth > 0 ? "true" : undefined}
      onDragEnter={(event: DragEvent<HTMLDivElement>) => {
        if (Array.from(event.dataTransfer.types).includes("application/x-mdx-block")) return;
        event.preventDefault();
        setDragDepth((depth) => depth + 1);
      }}
      onDragLeave={() => setDragDepth((depth) => Math.max(0, depth - 1))}
      onDrop={(event) => {
        if (Array.from(event.dataTransfer.types).includes("application/x-mdx-block")) return;
        event.preventDefault();
        setDragDepth(0);
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length > 0) void uploadDroppedImages(files);
      }}
    >
      <div className="mdx-document-blocks__quick-add" aria-label="Add first block">
        {(Object.keys(BLOCK_TYPE_LABELS) as MdxBlockType[]).map((type) => (
          <button type="button" key={type} onClick={() => insertBlock(-1, type)}>
            + {BLOCK_TYPE_LABELS[type]}
          </button>
        ))}
      </div>

      {blocks.map((block, index) => (
        <div
          className="mdx-document-block"
          data-drag-over={dragOverBlockId === block.id ? "true" : undefined}
          key={block.id}
          onDragOver={(event) => {
            if (!Array.from(event.dataTransfer.types).includes("application/x-mdx-block")) return;
            event.preventDefault();
            setDragOverBlockId(block.id);
          }}
          onDrop={(event) => {
            const draggedId = event.dataTransfer.getData("application/x-mdx-block");
            if (!draggedId) return;
            event.preventDefault();
            event.stopPropagation();
            setDragOverBlockId("");
            moveBlockTo(draggedId, block.id);
          }}
        >
          <div className="mdx-document-block__toolbar">
            <button
              type="button"
              className="mdx-document-block__drag"
              draggable
              onDragStart={(event) => {
                setDraggingBlockId(block.id);
                event.dataTransfer.setData("application/x-mdx-block", block.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => {
                setDraggingBlockId("");
                setDragOverBlockId("");
              }}
              aria-label="Drag block to reorder"
              title={draggingBlockId === block.id ? "Dragging" : "Drag to reorder"}
            >
              ⋮⋮
            </button>
            <select
              aria-label="Block type"
              value={block.type}
              onChange={(event) =>
                patchBlock(block.id, (current) =>
                  replaceBlockType(current, event.target.value as MdxBlockType),
                )
              }
            >
              {(Object.keys(BLOCK_TYPE_LABELS) as MdxBlockType[]).map((type) => (
                <option key={type} value={type}>
                  {BLOCK_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={index === 0}
              onClick={() => moveBlock(index, -1)}
              aria-label="Move block up"
            >
              ↑
            </button>
            <button
              type="button"
              disabled={index === blocks.length - 1}
              onClick={() => moveBlock(index, 1)}
              aria-label="Move block down"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => removeBlock(block.id)}
              aria-label="Remove block"
            >
              ×
            </button>
          </div>

          <EditableBlock
            block={block}
            uploading={uploadingId === block.id}
            onPatch={(patcher) => patchBlock(block.id, patcher)}
            onSlashCommand={(value) => {
              const next = blockFromSlashCommand(value);
              if (next) patchBlock(block.id, () => next);
              return Boolean(next);
            }}
            onConvertType={(type) =>
              patchBlock(block.id, () => createMdxBlock(type))
            }
            onUploadImage={(file) => void uploadImageIntoBlock(block.id, file)}
          />

          <div className="mdx-document-block__insert" aria-label="Add block">
            {(Object.keys(BLOCK_TYPE_LABELS) as MdxBlockType[]).map((type) => (
              <button type="button" key={type} onClick={() => insertBlock(index, type)}>
                + {BLOCK_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        </div>
      ))}

      <AssetLibraryPicker
        onSelect={(asset) =>
          appendImageBlock(asset.url, asset.alt || asset.filename || "image")
        }
      />
    </div>
  );
}

function EditableBlock({
  block,
  onConvertType,
  onPatch,
  onSlashCommand,
  onUploadImage,
  uploading,
}: {
  block: MdxBlock;
  onConvertType: (type: MdxBlockType) => void;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  onSlashCommand: (value: string) => boolean;
  onUploadImage: (file: File | null) => void;
  uploading: boolean;
}) {
  const showSlashMenu = block.type === "paragraph" && block.text.trim().startsWith("/");

  if (block.type === "image") {
    return (
      <div className="mdx-document-image-block">
        <label className="mdx-document-image-block__preview">
          {block.url ? (
            // Tauri workspace preview renders local/admin-uploaded assets.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={block.url} alt={block.alt || "Image"} draggable={false} />
          ) : (
            <span>{uploading ? "Uploading…" : "Choose image"}</span>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif"
            disabled={uploading}
            onChange={(event) => {
              onUploadImage(event.target.files?.[0] ?? null);
              event.currentTarget.value = "";
            }}
          />
        </label>
        <div className="mdx-document-image-block__fields">
          <input
            aria-label="Image URL"
            value={block.url || ""}
            placeholder="/uploads/image.png"
            onChange={(event) =>
              onPatch((current) => ({ ...current, url: event.target.value }))
            }
          />
          <input
            aria-label="Image alt text"
            value={block.alt || ""}
            placeholder="Alt text"
            onChange={(event) =>
              onPatch((current) => ({ ...current, alt: event.target.value }))
            }
          />
          <input
            aria-label="Image caption"
            value={block.caption || ""}
            placeholder="Caption"
            onChange={(event) =>
              onPatch((current) => ({ ...current, caption: event.target.value }))
            }
          />
        </div>
      </div>
    );
  }

  if (block.type === "heading") {
    return (
      <div className="mdx-document-heading-block">
        <select
          aria-label="Heading level"
          value={block.level ?? 2}
          onChange={(event) =>
            onPatch((current) => ({
              ...current,
              level: Number(event.target.value) as 1 | 2 | 3,
            }))
          }
        >
          <option value={1}>H1</option>
          <option value={2}>H2</option>
          <option value={3}>H3</option>
        </select>
        <input
          aria-label="Heading text"
          className={`mdx-document-heading-block__input mdx-document-heading-block__input--h${block.level ?? 2}`}
          value={block.text}
          placeholder="Heading"
          onChange={(event) =>
            onPatch((current) => ({ ...current, text: event.target.value }))
          }
        />
      </div>
    );
  }

  if (block.type === "divider") {
    return (
      <div className="mdx-document-divider-block" aria-label="Divider block">
        <span />
      </div>
    );
  }

  if (block.type === "list") {
    return (
      <div className="mdx-document-list-block">
        <select
          aria-label="List style"
          value={block.listStyle ?? "bulleted"}
          onChange={(event) =>
            onPatch((current) => ({
              ...current,
              markers: undefined,
              listStyle: event.target.value as "bulleted" | "numbered",
            }))
          }
        >
          <option value="bulleted">Bulleted</option>
          <option value="numbered">Numbered</option>
        </select>
        <textarea
          aria-label="List items"
          className="mdx-document-text-block mdx-document-text-block--list"
          rows={Math.max(3, block.text.split("\n").length + 1)}
          value={block.text}
          placeholder="One item per line"
          onChange={(event) =>
            onPatch((current) => ({
              ...current,
              markers: undefined,
              text: event.target.value,
            }))
          }
        />
      </div>
    );
  }

  return (
    <div className="mdx-document-text-block-shell">
      <textarea
        aria-label={`${BLOCK_TYPE_LABELS[block.type]} block`}
        className={`mdx-document-text-block mdx-document-text-block--${block.type}`}
        rows={block.type === "code" || block.type === "raw" ? 6 : Math.max(3, block.text.split("\n").length + 1)}
        value={block.text}
        placeholder={
          block.type === "code"
            ? "Code"
            : block.type === "raw"
              ? "Raw MDX"
              : block.type === "callout"
                ? "Callout"
                : block.type === "quote"
                  ? "Quote"
                  : "Type / for blocks, or start writing…"
        }
        onChange={(event) =>
          onPatch((current) => ({ ...current, text: event.target.value }))
        }
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          const value = event.currentTarget.value;
          if (!value.trim().startsWith("/")) return;
          if (onSlashCommand(value)) event.preventDefault();
        }}
      />
      {showSlashMenu ? (
        <div className="mdx-document-slash-menu" aria-label="Block shortcuts">
          {(Object.keys(BLOCK_TYPE_LABELS) as MdxBlockType[])
            .filter((type) => type !== "raw")
            .map((type) => (
              <button type="button" key={type} onClick={() => onConvertType(type)}>
                {BLOCK_TYPE_LABELS[type]}
              </button>
            ))}
        </div>
      ) : null}
    </div>
  );
}

export function MdxDocumentEditor<TForm>({
  adapter,
  mode,
  onExit,
  slug: initialSlug,
}: MdxDocumentEditorProps<TForm>) {
  const { request, setMessage } = useSiteAdmin();
  const [slug, setSlug] = useState(initialSlug ?? "");
  const [form, setForm] = useState<TForm>(() => adapter.createBlankForm());
  const [body, setBody] = useState(adapter.defaultBody);
  const [lastSavedSource, setLastSavedSource] = useState(() =>
    adapter.buildSource(adapter.createBlankForm(), adapter.defaultBody),
  );
  const [version, setVersion] = useState("");
  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editorMode, setEditorMode] = usePersistentUiState<DocumentEditorMode>(
    `workspace.site-admin.${adapter.kind}-editor.document-mode.v1`,
    "blocks",
    isDocumentEditorMode,
  );
  const [propertiesOpen, setPropertiesOpen] = usePersistentUiState(
    `workspace.site-admin.${adapter.kind}-editor.properties-open.v1`,
    false,
    isBoolean,
  );

  const source = useMemo(() => adapter.buildSource(form, body), [adapter, body, form]);
  const dirty = source !== lastSavedSource || (mode === "create" && Boolean(slug.trim()));
  const preview = usePreview(source, editorMode === "preview", request);
  const imageDrop = useMdxImageUploadDrop({ request, setError, setMessage });
  const { confirmBack, leaveEditor } = useConfirmingBack({
    dirty,
    initialSlug,
    onExit,
    source,
  });

  const draftKeySlug = mode === "create" ? "" : (initialSlug ?? "");
  const { restorable, clearDraft, dismissRestore } = useEditorDraft(
    adapter.kind,
    draftKeySlug,
    body,
    form,
    !loading,
  );

  useEffect(() => {
    if (mode !== "edit" || !initialSlug) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      const response = await request(
        `${adapter.routeBase}/${encodeURIComponent(initialSlug)}`,
        "GET",
      );
      if (cancelled) return;
      setLoading(false);
      if (!response.ok) {
        const msg = `${response.code}: ${response.error}`;
        setError(msg);
        setMessage("error", `Load ${adapter.titleNoun} failed: ${msg}`);
        return;
      }
      const data = (response.data ?? {}) as Record<string, unknown>;
      const loadedSource = typeof data.source === "string" ? data.source : "";
      const parsed = adapter.parseSource(loadedSource);
      const nextBody = parsed.body.replace(/^\n+/, "");
      setForm(parsed.form);
      setBody(nextBody);
      setLastSavedSource(adapter.buildSource(parsed.form, nextBody));
      setVersion(normalizeString(data.version));
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter, initialSlug, mode, request, setMessage]);

  useUnsavedChangesBeforeUnload(dirty, saving, deleting);

  const canSave = useMemo(
    () => adapter.canSave({ body, form, mode, slug }),
    [adapter, body, form, mode, slug],
  );

  const save = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!canSave || saving) return;
      const nextSource = adapter.buildSource(form, body);
      setSaving(true);
      setError("");
      if (mode === "create") {
        const response = await request(adapter.routeBase, "POST", {
          slug: slug.trim(),
          source: nextSource,
        });
        setSaving(false);
        if (!response.ok) {
          setError(`${response.code}: ${response.error}`);
          setMessage(
            "error",
            `Create ${adapter.titleNoun} failed: ${response.code}: ${response.error}`,
          );
          return;
        }
        setLastSavedSource(nextSource);
        clearDraft();
        setMessage("success", `${adapter.titleNoun} created.`);
        onExit("saved", slug.trim());
        return;
      }

      const currentSlug = initialSlug ?? slug;
      const response = await request(
        `${adapter.routeBase}/${encodeURIComponent(currentSlug)}`,
        "PATCH",
        { source: nextSource, version },
      );
      setSaving(false);
      if (!response.ok) {
        setError(`${response.code}: ${response.error}`);
        setMessage(
          "error",
          `Update ${adapter.titleNoun} failed: ${response.code}: ${response.error}`,
        );
        return;
      }
      const data = (response.data ?? {}) as Record<string, unknown>;
      const nextVersion = normalizeString(data.version);
      if (nextVersion) setVersion(nextVersion);
      setLastSavedSource(nextSource);
      clearDraft();
      setMessage("success", `${adapter.titleNoun} saved.`);
      onExit("saved", currentSlug);
    },
    [
      adapter,
      body,
      canSave,
      clearDraft,
      form,
      initialSlug,
      mode,
      onExit,
      request,
      saving,
      setMessage,
      slug,
      version,
    ],
  );

  const remove = useCallback(async () => {
    if (mode !== "edit" || !initialSlug || !version) return;
    setDeleting(true);
    setError("");
    const response = await request(
      `${adapter.routeBase}/${encodeURIComponent(initialSlug)}`,
      "DELETE",
      { version },
    );
    setDeleting(false);
    if (!response.ok) {
      setError(`${response.code}: ${response.error}`);
      setMessage(
        "error",
        `Delete ${adapter.titleNoun} failed: ${response.code}: ${response.error}`,
      );
      return;
    }
    clearDraft();
    setMessage("success", `${adapter.titleNoun} deleted.`);
    onExit("deleted", initialSlug);
  }, [adapter, clearDraft, initialSlug, mode, onExit, request, setMessage, version]);

  const title = mode === "create"
    ? `New ${adapter.titleNoun}`
    : `Edit ${adapter.titleNoun}: ${initialSlug ?? ""}`;
  const formId = `${adapter.kind}-document-editor-form`;

  return (
    <section className="surface-card mdx-document-editor-card">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]">
            {title}
          </h1>
          <div className="editor-meta-row">
            <p className="m-0 text-[12.5px] text-text-muted">
              Writes to <code>{adapter.contentPath(slug || "<slug>")}</code>.
            </p>
            <span className={`editor-state ${dirty ? "editor-state--dirty" : "editor-state--clean"}`}>
              {dirty ? "Unsaved changes" : "Saved"}
            </span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => setPropertiesOpen((open) => !open)}
            disabled={saving || deleting}
            aria-expanded={propertiesOpen}
          >
            Properties
          </button>
          <button
            type="button"
            className={confirmBack ? "btn btn--danger" : "btn btn--secondary"}
            onClick={leaveEditor}
            disabled={saving || deleting}
          >
            {confirmBack ? "Discard changes" : "Back"}
          </button>
          {mode === "edit" && (
            <button
              type="button"
              className={confirmDelete ? "btn btn--danger btn--confirming" : "btn btn--danger"}
              onClick={() => {
                if (confirmDelete) void remove();
                else setConfirmDelete(true);
              }}
              disabled={saving || deleting || loading || !version}
            >
              {deleting ? "Deleting…" : confirmDelete ? "Click again to confirm" : "Delete"}
            </button>
          )}
          <button
            type="submit"
            form={formId}
            className="btn btn--primary"
            disabled={!canSave || saving || loading || imageDrop.uploading}
          >
            {saving ? "Saving…" : mode === "create" ? "Create" : "Save"}
          </button>
        </div>
      </header>

      {error && (
        <p className="m-0 text-[12px] text-[color:var(--color-danger)]">{error}</p>
      )}

      {restorable && !loading && (
        <div className="draft-restore" role="status">
          <span className="draft-restore__label">
            Unsaved draft · {formatDraftAge(restorable.savedAt)}
          </span>
          <button
            type="button"
            className="btn btn--secondary draft-restore__btn"
            onClick={() => {
              setBody(restorable.body);
              setForm(restorable.form);
              dismissRestore();
            }}
          >
            Restore
          </button>
          <button
            type="button"
            className="btn btn--ghost draft-restore__btn"
            onClick={clearDraft}
          >
            Discard
          </button>
        </div>
      )}

      {loading ? (
        <div className="loading-inline" role="status">
          <span className="loading-spinner" aria-hidden="true" />
          <span>Loading {adapter.titleNoun}…</span>
        </div>
      ) : (
        <form
          id={formId}
          onSubmit={save}
          className="mdx-document-editor"
          data-properties-open={propertiesOpen ? "true" : undefined}
        >
          <div className="mdx-document-editor__toolbar" aria-label="Document editor mode">
            <div className="home-builder__segmented">
              {DOCUMENT_EDITOR_MODES.map((item) => (
                <button
                  aria-pressed={editorMode === item}
                  data-active={editorMode === item ? "true" : undefined}
                  key={item}
                  onClick={() => setEditorMode(item)}
                  type="button"
                >
                  {DOCUMENT_EDITOR_MODE_LABELS[item]}
                </button>
              ))}
            </div>
            <span>
              {editorMode === "blocks"
                ? "Block canvas"
                : editorMode === "source"
                  ? imageDrop.uploading
                    ? "Uploading image…"
                    : imageDrop.dragDepth > 0
                      ? "Drop to upload"
                      : "Raw MDX"
                  : preview.loading
                    ? "Rendering preview…"
                    : preview.error
                      ? `Preview error: ${preview.error}`
                      : "Rendered MDX preview"}
            </span>
          </div>

          <div className="mdx-document-editor__layout">
            <main className="mdx-document-editor__canvas">
              <input
                aria-label={`${adapter.titleNoun} title`}
                className="mdx-document-editor__title"
                value={adapter.getTitle(form)}
                placeholder="Untitled"
                onChange={(event) =>
                  setForm((current) => adapter.setTitle(current, event.target.value))
                }
                required
              />

              {editorMode === "blocks" ? (
                <BodyBlockCanvas
                  body={body}
                  onChange={setBody}
                  request={request}
                  setError={setError}
                  setMessage={setMessage}
                />
              ) : editorMode === "source" ? (
                <div
                  className="editor-drop-zone mdx-document-editor__source"
                  data-drag-active={imageDrop.dragDepth > 0 ? "true" : undefined}
                  onDragEnter={imageDrop.onDragEnter}
                  onDragLeave={imageDrop.onDragLeave}
                >
                  <MarkdownEditor
                    value={body}
                    onChange={setBody}
                    onDrop={imageDrop.handleDrop}
                    onReady={imageDrop.onEditorReady}
                    minHeight={520}
                  />
                  <span className="mdx-document-editor__hint">
                    Drop an image onto the source editor to upload; a{" "}
                    <code>![alt](/uploads/...)</code> tag is inserted at the cursor.
                  </span>
                  <AssetLibraryPicker
                    onSelect={(asset) => {
                      const alt = asset.alt || asset.filename || "image";
                      imageDrop.insertAssetImage(asset.url, alt);
                    }}
                  />
                </div>
              ) : (
                <div className="mdx-document-editor__preview">
                  {preview.loading ? (
                    <div className="loading-inline" role="status">
                      <span className="loading-spinner" aria-hidden="true" />
                      <span>Rendering preview…</span>
                    </div>
                  ) : preview.error ? (
                    <p className="m-0 text-[12px] text-[color:var(--color-danger)]">
                      {preview.error}
                    </p>
                  ) : (
                    <div
                      className="notion-root mdx-post__body"
                      dangerouslySetInnerHTML={{ __html: preview.html }}
                    />
                  )}
                </div>
              )}
            </main>

            {propertiesOpen ? (
              <aside className="mdx-document-editor__properties" aria-label="Document properties">
                <div className="mdx-document-editor__properties-head">
                  <div>
                    <span className="home-builder__eyebrow">Properties</span>
                    <strong>{adapter.titleNoun}</strong>
                  </div>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => setPropertiesOpen(false)}
                    aria-label="Close properties"
                  >
                    ×
                  </button>
                </div>
                {adapter.renderProperties({
                  form,
                  mode,
                  setForm,
                  setSlug,
                  slug,
                  slugHint:
                    "1–60 chars, lowercase letters / digits / hyphens, no leading or trailing dash",
                })}
              </aside>
            ) : null}
          </div>
        </form>
      )}
    </section>
  );
}
