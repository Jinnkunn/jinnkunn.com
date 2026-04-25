import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
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

const BLOCK_INSERT_TYPES: MdxBlockType[] = [
  "paragraph",
  "heading",
  "image",
  "quote",
  "list",
  "divider",
  "callout",
  "code",
  "raw",
];

interface SlashCommand {
  description: string;
  keywords: string[];
  label: string;
  makeBlock: () => MdxBlock;
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    description: "Plain paragraph text",
    keywords: ["text", "paragraph", "plain"],
    label: "Text",
    makeBlock: () => createMdxBlock("paragraph"),
  },
  {
    description: "Large section heading",
    keywords: ["h1", "heading1", "title"],
    label: "Heading 1",
    makeBlock: () => ({ ...createMdxBlock("heading"), level: 1, text: "" }),
  },
  {
    description: "Medium section heading",
    keywords: ["h2", "heading", "heading2"],
    label: "Heading 2",
    makeBlock: () => ({ ...createMdxBlock("heading"), level: 2, text: "" }),
  },
  {
    description: "Small section heading",
    keywords: ["h3", "heading3", "subheading"],
    label: "Heading 3",
    makeBlock: () => ({ ...createMdxBlock("heading"), level: 3, text: "" }),
  },
  {
    description: "Upload or paste an image",
    keywords: ["image", "img", "photo", "media"],
    label: "Image",
    makeBlock: () => createMdxBlock("image"),
  },
  {
    description: "Quote or excerpt",
    keywords: ["quote", "blockquote"],
    label: "Quote",
    makeBlock: () => createMdxBlock("quote"),
  },
  {
    description: "Bulleted or numbered list",
    keywords: ["list", "bullet", "bulleted", "numbered"],
    label: "List",
    makeBlock: () => createMdxBlock("list"),
  },
  {
    description: "Visual separator",
    keywords: ["divider", "hr", "line"],
    label: "Divider",
    makeBlock: () => createMdxBlock("divider"),
  },
  {
    description: "Highlighted note",
    keywords: ["callout", "note", "tip"],
    label: "Callout",
    makeBlock: () => createMdxBlock("callout"),
  },
  {
    description: "Fenced code block",
    keywords: ["code", "snippet"],
    label: "Code",
    makeBlock: () => createMdxBlock("code"),
  },
  {
    description: "Advanced MDX",
    keywords: ["raw", "mdx", "html"],
    label: "Raw MDX",
    makeBlock: () => createMdxBlock("raw"),
  },
];

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

function normalizeSlashQuery(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed.startsWith("/")) return null;
  return trimmed.slice(1).replace(/\s+/g, "");
}

function getMatchingSlashCommands(value: string): SlashCommand[] {
  const query = normalizeSlashQuery(value);
  if (query === null) return [];
  if (!query) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(
    (command) =>
      command.label.toLowerCase().replace(/\s+/g, "").includes(query) ||
      command.keywords.some((keyword) => keyword.includes(query)),
  );
}

function blockFromSlashCommand(value: string): MdxBlock | null {
  return getMatchingSlashCommands(value)[0]?.makeBlock() ?? null;
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

function isTextEditableBlock(block: MdxBlock): boolean {
  return (
    block.type === "paragraph" ||
    block.type === "heading" ||
    block.type === "quote" ||
    block.type === "list" ||
    block.type === "callout" ||
    block.type === "code" ||
    block.type === "raw"
  );
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
  const [focusRequest, setFocusRequest] = useState<{ id: string; seq: number } | null>(null);
  const lastEmittedBodyRef = useRef(body);
  const blockInputRefs = useRef(new Map<string, HTMLInputElement | HTMLTextAreaElement>());
  const focusSeqRef = useRef(0);

  const registerBlockInput = useCallback(
    (blockId: string, node: HTMLInputElement | HTMLTextAreaElement | null) => {
      if (node) blockInputRefs.current.set(blockId, node);
      else blockInputRefs.current.delete(blockId);
    },
    [],
  );

  const requestBlockFocus = useCallback((id: string) => {
    if (!id) return;
    focusSeqRef.current += 1;
    setFocusRequest({ id, seq: focusSeqRef.current });
  }, []);

  useEffect(() => {
    if (!focusRequest) return;
    const node = blockInputRefs.current.get(focusRequest.id);
    if (!node) return;
    node.focus();
    const length = node.value.length;
    node.setSelectionRange(length, length);
  }, [blocks, focusRequest]);

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
      const block = createMdxBlock(type);
      const next = blocks.slice();
      next.splice(afterIndex + 1, 0, block);
      commitBlocks(next);
      requestBlockFocus(block.id);
    },
    [blocks, commitBlocks, requestBlockFocus],
  );

  const replaceBlock = useCallback(
    (id: string, nextBlock: MdxBlock) => {
      commitBlocks(blocks.map((block) => (block.id === id ? nextBlock : block)));
      requestBlockFocus(nextBlock.id);
    },
    [blocks, commitBlocks, requestBlockFocus],
  );

  const insertParagraphAfter = useCallback(
    (index: number) => {
      const block = createMdxBlock("paragraph");
      const next = blocks.slice();
      next.splice(index + 1, 0, block);
      commitBlocks(next);
      requestBlockFocus(block.id);
    },
    [blocks, commitBlocks, requestBlockFocus],
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

  const removeEmptyBlock = useCallback(
    (id: string, index: number) => {
      if (blocks.length <= 1) return;
      const next = blocks.filter((block) => block.id !== id);
      const focusIndex = Math.max(0, Math.min(index - 1, next.length - 1));
      commitBlocks(next);
      requestBlockFocus(next[focusIndex]?.id ?? "");
    },
    [blocks, commitBlocks, requestBlockFocus],
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
        {BLOCK_INSERT_TYPES.map((type) => (
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
              if (next) replaceBlock(block.id, next);
              return Boolean(next);
            }}
            onChooseSlashCommand={(command) => replaceBlock(block.id, command.makeBlock())}
            onConvertType={(type) => replaceBlock(block.id, createMdxBlock(type))}
            onFocusInput={(node) => registerBlockInput(block.id, node)}
            onInsertParagraphAfter={() => insertParagraphAfter(index)}
            onRemoveEmpty={() => removeEmptyBlock(block.id, index)}
            onUploadImage={(file) => void uploadImageIntoBlock(block.id, file)}
          />

          <div className="mdx-document-block__insert" aria-label="Add block">
            {BLOCK_INSERT_TYPES.map((type) => (
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
  onChooseSlashCommand,
  onConvertType,
  onFocusInput,
  onInsertParagraphAfter,
  onPatch,
  onRemoveEmpty,
  onSlashCommand,
  onUploadImage,
  uploading,
}: {
  block: MdxBlock;
  onChooseSlashCommand: (command: SlashCommand) => void;
  onConvertType: (type: MdxBlockType) => void;
  onFocusInput: (node: HTMLInputElement | HTMLTextAreaElement | null) => void;
  onInsertParagraphAfter: () => void;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  onRemoveEmpty: () => void;
  onSlashCommand: (value: string) => boolean;
  onUploadImage: (file: File | null) => void;
  uploading: boolean;
}) {
  const slashCommands =
    block.type === "paragraph" ? getMatchingSlashCommands(block.text) : [];
  const showSlashMenu = slashCommands.length > 0;

  const onTextKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = event.currentTarget.value;
    if (event.key === "Enter" && value.trim().startsWith("/")) {
      if (onSlashCommand(value)) event.preventDefault();
      return;
    }
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      block.type !== "code" &&
      block.type !== "raw" &&
      block.type !== "list"
    ) {
      event.preventDefault();
      onInsertParagraphAfter();
      return;
    }
    if (
      event.key === "Backspace" &&
      isTextEditableBlock(block) &&
      !value.trim() &&
      event.currentTarget.selectionStart === 0 &&
      event.currentTarget.selectionEnd === 0
    ) {
      event.preventDefault();
      onRemoveEmpty();
    }
  };

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
          ref={onFocusInput}
          value={block.text}
          placeholder="Heading"
          onChange={(event) =>
            onPatch((current) => ({ ...current, text: event.target.value }))
          }
          onKeyDown={onTextKeyDown}
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
          ref={onFocusInput}
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
          onKeyDown={onTextKeyDown}
        />
      </div>
    );
  }

  return (
    <div className="mdx-document-text-block-shell">
      <textarea
        aria-label={`${BLOCK_TYPE_LABELS[block.type]} block`}
        className={`mdx-document-text-block mdx-document-text-block--${block.type}`}
        ref={onFocusInput}
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
        onKeyDown={onTextKeyDown}
      />
      {showSlashMenu ? (
        <SlashCommandMenu
          commands={slashCommands}
          onChoose={onChooseSlashCommand}
          onConvertType={onConvertType}
        />
      ) : null}
    </div>
  );
}

function SlashCommandMenu({
  commands,
  onChoose,
  onConvertType,
}: {
  commands: SlashCommand[];
  onChoose: (command: SlashCommand) => void;
  onConvertType: (type: MdxBlockType) => void;
}) {
  return (
    <div className="mdx-document-slash-menu" aria-label="Block shortcuts">
      {commands.map((command) => (
        <button type="button" key={command.label} onClick={() => onChoose(command)}>
          <strong>{command.label}</strong>
          <span>{command.description}</span>
        </button>
      ))}
      {commands.length === 0 ? (
        <button type="button" onClick={() => onConvertType("paragraph")}>
          <strong>Text</strong>
          <span>Start with a plain paragraph</span>
        </button>
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
