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
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SetStateAction,
} from "react";

import { AssetLibraryPicker, rememberRecentAsset } from "./AssetLibraryPicker";
import { MarkdownEditor } from "./LazyMarkdownEditor";
import { uploadGenericFile, uploadImageFile } from "./assets-upload";
import {
  BlockEditorCommandMenu,
  getMatchingBlockEditorCommands,
  type BlockEditorCommand,
} from "./block-editor";
import { BlockPopover } from "./block-popover";
import { applyLink, toggleWrap } from "./format-helpers";
import {
  createMdxBlock,
  duplicateMdxBlock,
  parseMdxBlocks,
  serializeMdxBlocks,
  type MdxBlock,
  type MdxBlockType,
  type MdxEmbedKind,
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
  todo: "To-do list",
  toggle: "Toggle",
  table: "Table",
  bookmark: "Bookmark",
  embed: "Embed",
  file: "File",
  "page-link": "Page link",
  divider: "Divider",
  callout: "Callout",
  code: "Code",
  raw: "Raw MDX",
};

// Types that can appear in the "Turn into" submenu, in display order.
// Block types whose data lives outside the `text` field (table, bookmark,
// embed, file, page-link) are intentionally omitted — turning to them from
// a text block would discard meaningful data.
const TURN_INTO_TYPES: MdxBlockType[] = [
  "paragraph",
  "heading",
  "todo",
  "toggle",
  "list",
  "quote",
  "callout",
  "code",
  "divider",
  "image",
  "raw",
];

interface SlashCommand extends BlockEditorCommand {
  makeBlock: () => MdxBlock;
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    description: "Plain paragraph text",
    id: "text",
    keywords: ["text", "paragraph", "plain"],
    label: "Text",
    makeBlock: () => createMdxBlock("paragraph"),
  },
  {
    description: "Large section heading",
    id: "heading1",
    keywords: ["h1", "heading1", "title"],
    label: "Heading 1",
    makeBlock: () => ({ ...createMdxBlock("heading"), level: 1, text: "" }),
  },
  {
    description: "Medium section heading",
    id: "heading2",
    keywords: ["h2", "heading", "heading2"],
    label: "Heading 2",
    makeBlock: () => ({ ...createMdxBlock("heading"), level: 2, text: "" }),
  },
  {
    description: "Small section heading",
    id: "heading3",
    keywords: ["h3", "heading3", "subheading"],
    label: "Heading 3",
    makeBlock: () => ({ ...createMdxBlock("heading"), level: 3, text: "" }),
  },
  {
    description: "Upload or paste an image",
    id: "image",
    keywords: ["image", "img", "photo", "media"],
    label: "Image",
    makeBlock: () => createMdxBlock("image"),
  },
  {
    description: "Quote or excerpt",
    id: "quote",
    keywords: ["quote", "blockquote"],
    label: "Quote",
    makeBlock: () => createMdxBlock("quote"),
  },
  {
    description: "Bulleted or numbered list",
    id: "list",
    keywords: ["list", "bullet", "bulleted", "numbered"],
    label: "List",
    makeBlock: () => createMdxBlock("list"),
  },
  {
    description: "Checkbox list with completion",
    id: "todo",
    keywords: ["todo", "task", "check", "checkbox", "checklist"],
    label: "To-do list",
    makeBlock: () => createMdxBlock("todo"),
  },
  {
    description: "Collapsible section with hidden content",
    id: "toggle",
    keywords: ["toggle", "collapse", "details", "expand"],
    label: "Toggle",
    makeBlock: () => createMdxBlock("toggle"),
  },
  {
    description: "Markdown table",
    id: "table",
    keywords: ["table", "grid", "matrix", "spreadsheet"],
    label: "Table",
    makeBlock: () => createMdxBlock("table"),
  },
  {
    description: "Link preview card",
    id: "bookmark",
    keywords: ["bookmark", "link", "url", "preview"],
    label: "Bookmark",
    makeBlock: () => createMdxBlock("bookmark"),
  },
  {
    description: "YouTube or Vimeo video",
    id: "video",
    keywords: ["video", "youtube", "vimeo"],
    label: "Video",
    makeBlock: () => ({ ...createMdxBlock("embed"), embedKind: "youtube" }),
  },
  {
    description: "Iframe embed (CodePen, Loom, Figma, …)",
    id: "embed",
    keywords: ["embed", "iframe"],
    label: "Embed",
    makeBlock: () => ({ ...createMdxBlock("embed"), embedKind: "iframe" }),
  },
  {
    description: "Uploaded file attachment",
    id: "file",
    keywords: ["file", "upload", "attachment", "pdf"],
    label: "File",
    makeBlock: () => createMdxBlock("file"),
  },
  {
    description: "Link to another page in this site",
    id: "page-link",
    keywords: ["page", "link", "internal"],
    label: "Page link",
    makeBlock: () => createMdxBlock("page-link"),
  },
  {
    description: "Visual separator",
    id: "divider",
    keywords: ["divider", "hr", "line"],
    label: "Divider",
    makeBlock: () => createMdxBlock("divider"),
  },
  {
    description: "Highlighted note",
    id: "callout",
    keywords: ["callout", "note", "tip"],
    label: "Callout",
    makeBlock: () => createMdxBlock("callout"),
  },
  {
    description: "Fenced code block",
    id: "code",
    keywords: ["code", "snippet"],
    label: "Code",
    makeBlock: () => createMdxBlock("code"),
  },
  {
    description: "Advanced MDX",
    id: "raw",
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

function getMatchingSlashCommands(value: string): SlashCommand[] {
  return getMatchingBlockEditorCommands(value, SLASH_COMMANDS, { requireSlash: true });
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
    type === "todo" ||
    type === "callout" ||
    type === "code" ||
    type === "raw"
  ) {
    return { ...next, text: block.text };
  }
  if (type === "toggle") {
    // Use the source block's text as the toggle summary; preserve any
    // existing children only if we're already a toggle (handled by the
    // early return above).
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
    block.type === "todo" ||
    block.type === "callout" ||
    block.type === "code" ||
    block.type === "raw" ||
    block.type === "toggle"
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
  const [uploading, setUploading] = useState(false);
  const lastEmittedBodyRef = useRef(body);

  useEffect(() => {
    if (body === lastEmittedBodyRef.current) return;
    lastEmittedBodyRef.current = body;
    // External body updates come from draft restore/source mode; the block
    // canvas keeps local IDs so focused blocks do not remount on every keystroke.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBlocks(parseMdxBlocks(body));
  }, [body]);

  const handleBlocksChange = useCallback(
    (nextBlocks: MdxBlock[]) => {
      const normalized = nextBlocks.length > 0 ? nextBlocks : [createMdxBlock("paragraph")];
      const nextBody = serializeMdxBlocks(normalized);
      setBlocks(normalized);
      lastEmittedBodyRef.current = nextBody;
      onChange(nextBody);
    },
    [onChange],
  );

  const appendImageBlock = useCallback(
    (url: string, alt: string) => {
      handleBlocksChange([
        ...blocks,
        {
          ...createMdxBlock("image"),
          alt,
          url,
        },
      ]);
    },
    [blocks, handleBlocksChange],
  );

  const uploadDroppedImages = useCallback(
    async (files: File[]) => {
      const nextBlocks = blocks.slice();
      for (const file of files) {
        setUploading(true);
        const result = await uploadImageFile({ file, request });
        setUploading(false);
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
      handleBlocksChange(nextBlocks);
    },
    [blocks, handleBlocksChange, request, setError, setMessage],
  );

  return (
    <div
      className="mdx-document-blocks"
      data-drag-active={dragDepth > 0 ? "true" : undefined}
      data-uploading={uploading ? "true" : undefined}
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
      <EditableBlocksList
        blocks={blocks}
        depth={0}
        onBlocksChange={handleBlocksChange}
        request={request}
        setError={setError}
        setMessage={setMessage}
      />

      <AssetLibraryPicker
        onSelect={(asset) =>
          appendImageBlock(asset.url, asset.alt || asset.filename || "image")
        }
      />
    </div>
  );
}

interface EditableBlocksListProps {
  blocks: MdxBlock[];
  depth: number;
  onBlocksChange: (next: MdxBlock[]) => void;
  request: RequestFn;
  setError: (error: string) => void;
  setMessage: (kind: "error" | "success", text: string) => void;
}

function EditableBlocksList({
  blocks,
  depth,
  onBlocksChange,
  request,
  setError,
  setMessage,
}: EditableBlocksListProps) {
  const [draggingBlockId, setDraggingBlockId] = useState("");
  const [dragOverBlockId, setDragOverBlockId] = useState("");
  const [uploadingId, setUploadingId] = useState("");
  const [focusRequest, setFocusRequest] = useState<{ id: string; seq: number } | null>(null);
  const [actionMenu, setActionMenu] = useState<{
    anchor: HTMLElement;
    blockId: string;
  } | null>(null);
  const blockInputRefs = useRef(new Map<string, HTMLInputElement | HTMLTextAreaElement>());
  const focusSeqRef = useRef(0);

  const enableDrag = depth === 0;

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

  const commitBlocks = useCallback(
    (nextBlocks: MdxBlock[]) => {
      // Root canvas keeps at least one paragraph; nested lists may be empty.
      const normalized =
        depth === 0 && nextBlocks.length === 0
          ? [createMdxBlock("paragraph")]
          : nextBlocks;
      onBlocksChange(normalized);
    },
    [depth, onBlocksChange],
  );

  const patchBlock = useCallback(
    (id: string, patcher: (block: MdxBlock) => MdxBlock) => {
      commitBlocks(blocks.map((block) => (block.id === id ? patcher(block) : block)));
    },
    [blocks, commitBlocks],
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

  const insertSlashTrigger = useCallback(
    (afterIndex: number) => {
      const block: MdxBlock = { ...createMdxBlock("paragraph"), text: "/" };
      const next = blocks.slice();
      next.splice(afterIndex + 1, 0, block);
      commitBlocks(next);
      requestBlockFocus(block.id);
    },
    [blocks, commitBlocks, requestBlockFocus],
  );

  const duplicateBlockById = useCallback(
    (id: string) => {
      const idx = blocks.findIndex((block) => block.id === id);
      if (idx < 0) return;
      const copy = duplicateMdxBlock(blocks[idx]);
      const next = blocks.slice();
      next.splice(idx + 1, 0, copy);
      commitBlocks(next);
      requestBlockFocus(copy.id);
    },
    [blocks, commitBlocks, requestBlockFocus],
  );

  const changeBlockType = useCallback(
    (id: string, type: MdxBlockType, level?: 1 | 2 | 3) => {
      commitBlocks(
        blocks.map((block) => {
          if (block.id !== id) return block;
          const next = replaceBlockType(block, type);
          if (type === "heading" && level) {
            return { ...next, level };
          }
          return next;
        }),
      );
      requestBlockFocus(id);
    },
    [blocks, commitBlocks, requestBlockFocus],
  );

  const copyBlockLink = useCallback((id: string) => {
    const link = `#block-${id}`;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(link);
    }
  }, []);

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
      if (depth === 0 && next.length === 0) {
        commitBlocks([createMdxBlock("paragraph")]);
        return;
      }
      commitBlocks(next);
    },
    [blocks, commitBlocks, depth],
  );

  const removeEmptyBlock = useCallback(
    (id: string, index: number) => {
      if (depth === 0 && blocks.length <= 1) return;
      const next = blocks.filter((block) => block.id !== id);
      const focusIndex = Math.max(0, Math.min(index - 1, next.length - 1));
      commitBlocks(next);
      requestBlockFocus(next[focusIndex]?.id ?? "");
    },
    [blocks, commitBlocks, depth, requestBlockFocus],
  );

  if (blocks.length === 0) {
    // Empty nested list (e.g. an empty toggle body) — show a click-to-add
    // affordance so users have a way in. Only reachable when depth > 0.
    return (
      <div className="mdx-document-blocks-empty">
        <button
          type="button"
          className="mdx-document-blocks-empty__btn"
          onClick={() => commitBlocks([createMdxBlock("paragraph")])}
        >
          + Add a block
        </button>
      </div>
    );
  }

  return (
    <>
      {blocks.map((block, index) => (
        <div
          className="mdx-document-block"
          data-depth={depth}
          data-drag-over={dragOverBlockId === block.id ? "true" : undefined}
          data-dragging={draggingBlockId === block.id ? "true" : undefined}
          key={block.id}
          onDragOver={
            enableDrag
              ? (event) => {
                  if (!Array.from(event.dataTransfer.types).includes("application/x-mdx-block"))
                    return;
                  event.preventDefault();
                  setDragOverBlockId(block.id);
                }
              : undefined
          }
          onDrop={
            enableDrag
              ? (event) => {
                  const draggedId = event.dataTransfer.getData("application/x-mdx-block");
                  if (!draggedId) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setDragOverBlockId("");
                  moveBlockTo(draggedId, block.id);
                }
              : undefined
          }
        >
          <BlockGutterHandles
            isDragging={draggingBlockId === block.id}
            onAdd={() => insertSlashTrigger(index)}
            onDragStart={(event) => {
              if (!enableDrag) {
                event.preventDefault();
                return;
              }
              setDraggingBlockId(block.id);
              event.dataTransfer.setData("application/x-mdx-block", block.id);
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => {
              setDraggingBlockId("");
              setDragOverBlockId("");
            }}
            onMenu={(anchor) => setActionMenu({ anchor, blockId: block.id })}
          />

          <EditableBlock
            block={block}
            depth={depth}
            request={request}
            setError={setError}
            setMessage={setMessage}
            uploading={uploadingId === block.id}
            onPatch={(patcher) => patchBlock(block.id, patcher)}
            onSlashCommand={(value) => {
              const next = blockFromSlashCommand(value);
              if (!next) return false;
              if (depth > 0 && next.type === "toggle") return false;
              replaceBlock(block.id, next);
              return true;
            }}
            onChooseSlashCommand={(command) => replaceBlock(block.id, command.makeBlock())}
            onFocusInput={(node) => registerBlockInput(block.id, node)}
            onInsertParagraphAfter={() => insertParagraphAfter(index)}
            onRemoveEmpty={() => removeEmptyBlock(block.id, index)}
            onUploadImage={(file) => void uploadImageIntoBlock(block.id, file)}
            onMoveUp={() => moveBlock(index, -1)}
            onMoveDown={() => moveBlock(index, 1)}
            onTurnInto={(type, level) => changeBlockType(block.id, type, level)}
          />
        </div>
      ))}

      {actionMenu ? (
        <BlockActionMenu
          anchor={actionMenu.anchor}
          block={blocks.find((b) => b.id === actionMenu.blockId) ?? null}
          canMoveDown={
            blocks.findIndex((b) => b.id === actionMenu.blockId) <
            blocks.length - 1
          }
          canMoveUp={blocks.findIndex((b) => b.id === actionMenu.blockId) > 0}
          onClose={() => setActionMenu(null)}
          onCopyLink={() => {
            copyBlockLink(actionMenu.blockId);
            setActionMenu(null);
          }}
          onDelete={() => {
            removeBlock(actionMenu.blockId);
            setActionMenu(null);
          }}
          onDuplicate={() => {
            duplicateBlockById(actionMenu.blockId);
            setActionMenu(null);
          }}
          onMoveDown={() => {
            const idx = blocks.findIndex((b) => b.id === actionMenu.blockId);
            if (idx >= 0) moveBlock(idx, 1);
            setActionMenu(null);
          }}
          onMoveUp={() => {
            const idx = blocks.findIndex((b) => b.id === actionMenu.blockId);
            if (idx >= 0) moveBlock(idx, -1);
            setActionMenu(null);
          }}
          onTurnInto={(type) => {
            changeBlockType(actionMenu.blockId, type);
            setActionMenu(null);
          }}
        />
      ) : null}
    </>
  );
}

interface BlockGutterHandlesProps {
  isDragging: boolean;
  onAdd: () => void;
  onDragEnd: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onMenu: (anchor: HTMLElement) => void;
}

function BlockGutterHandles({
  isDragging,
  onAdd,
  onDragEnd,
  onDragStart,
  onMenu,
}: BlockGutterHandlesProps) {
  return (
    <div className="mdx-document-block__gutter" aria-hidden="false">
      <button
        type="button"
        className="mdx-document-block__handle mdx-document-block__handle--add"
        onClick={onAdd}
        aria-label="Add block below"
        title="Click to add a block below"
      >
        +
      </button>
      <button
        type="button"
        className="mdx-document-block__handle mdx-document-block__handle--menu"
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={(event) => onMenu(event.currentTarget)}
        aria-label="Drag to reorder, click for block actions"
        title={isDragging ? "Dragging" : "Drag to reorder · Click for actions"}
      >
        ⋮⋮
      </button>
    </div>
  );
}

interface BlockActionMenuProps {
  anchor: HTMLElement;
  block: MdxBlock | null;
  canMoveDown: boolean;
  canMoveUp: boolean;
  onClose: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
  onTurnInto: (type: MdxBlockType) => void;
}

function BlockActionMenu({
  anchor,
  block,
  canMoveDown,
  canMoveUp,
  onClose,
  onCopyLink,
  onDelete,
  onDuplicate,
  onMoveDown,
  onMoveUp,
  onTurnInto,
}: BlockActionMenuProps) {
  const [turnIntoOpen, setTurnIntoOpen] = useState(false);

  useEffect(() => {
    if (!block) onClose();
  }, [block, onClose]);

  return (
    <BlockPopover
      anchor={anchor}
      ariaLabel="Block actions"
      className="block-popover--menu"
      onClose={onClose}
      open={Boolean(block)}
      placement="bottom-start"
    >
      {turnIntoOpen ? (
        <div className="block-popover__section" role="menu" aria-label="Turn into">
          <button
            type="button"
            className="block-popover__item block-popover__item--back"
            onClick={() => setTurnIntoOpen(false)}
          >
            ← Turn into…
          </button>
          {TURN_INTO_TYPES.map((type) => (
            <button
              type="button"
              className="block-popover__item"
              key={type}
              onClick={() => onTurnInto(type)}
              aria-current={block?.type === type ? "true" : undefined}
            >
              {BLOCK_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      ) : (
        <div className="block-popover__section" role="menu">
          <button type="button" className="block-popover__item" onClick={onDelete}>
            <span>Delete</span>
            <kbd>⌫</kbd>
          </button>
          <button type="button" className="block-popover__item" onClick={onDuplicate}>
            <span>Duplicate</span>
            <kbd>⌘D</kbd>
          </button>
          <button
            type="button"
            className="block-popover__item"
            onClick={() => setTurnIntoOpen(true)}
          >
            <span>Turn into</span>
            <span aria-hidden="true">›</span>
          </button>
          <button type="button" className="block-popover__item" onClick={onCopyLink}>
            <span>Copy link to block</span>
          </button>
          <div className="block-popover__divider" role="separator" />
          <button
            type="button"
            className="block-popover__item"
            disabled={!canMoveUp}
            onClick={onMoveUp}
          >
            <span>Move up</span>
            <kbd>⌘⇧↑</kbd>
          </button>
          <button
            type="button"
            className="block-popover__item"
            disabled={!canMoveDown}
            onClick={onMoveDown}
          >
            <span>Move down</span>
            <kbd>⌘⇧↓</kbd>
          </button>
        </div>
      )}
    </BlockPopover>
  );
}

function EditableBlock({
  block,
  depth,
  onChooseSlashCommand,
  onFocusInput,
  onInsertParagraphAfter,
  onMoveDown,
  onMoveUp,
  onPatch,
  onRemoveEmpty,
  onSlashCommand,
  onTurnInto,
  onUploadImage,
  request,
  setError,
  setMessage,
  uploading,
}: {
  block: MdxBlock;
  depth: number;
  onChooseSlashCommand: (command: SlashCommand) => void;
  onFocusInput: (node: HTMLInputElement | HTMLTextAreaElement | null) => void;
  onInsertParagraphAfter: () => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  onRemoveEmpty: () => void;
  onSlashCommand: (value: string) => boolean;
  onTurnInto: (type: MdxBlockType, level?: 1 | 2 | 3) => void;
  onUploadImage: (file: File | null) => void;
  request: RequestFn;
  setError: (error: string) => void;
  setMessage: (kind: "error" | "success", text: string) => void;
  uploading: boolean;
}) {
  const slashCommands =
    block.type === "paragraph" ? getMatchingSlashCommands(block.text) : [];
  const showSlashMenu = slashCommands.length > 0;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [selection, setSelection] = useState<{ end: number; start: number } | null>(
    null,
  );
  const isFormattableBlock =
    block.type === "paragraph" ||
    block.type === "heading" ||
    block.type === "quote" ||
    block.type === "callout" ||
    block.type === "list";

  // Re-read the current textarea selection after every keystroke / mouse drag
  // so the inline format toolbar shows up only when there's a real range.
  useEffect(() => {
    if (!isFormattableBlock) return;
    const node = textareaRef.current;
    if (!node) return;
    const sync = () => {
      if (document.activeElement !== node) {
        setSelection(null);
        return;
      }
      const { selectionStart, selectionEnd } = node;
      if (selectionStart == null || selectionEnd == null) return;
      if (selectionStart === selectionEnd) {
        setSelection(null);
      } else {
        setSelection({ start: selectionStart, end: selectionEnd });
      }
    };
    document.addEventListener("selectionchange", sync);
    node.addEventListener("blur", sync);
    return () => {
      document.removeEventListener("selectionchange", sync);
      node.removeEventListener("blur", sync);
    };
  }, [block.id, isFormattableBlock]);

  const applyToggleWrap = useCallback(
    (prefix: string, suffix?: string) => {
      const node = textareaRef.current;
      if (!node) return;
      const start = node.selectionStart ?? 0;
      const end = node.selectionEnd ?? start;
      const result = toggleWrap(node.value, start, end, prefix, suffix ?? prefix);
      onPatch((current) => ({ ...current, text: result.text }));
      requestAnimationFrame(() => {
        const fresh = textareaRef.current;
        if (!fresh) return;
        fresh.focus();
        fresh.setSelectionRange(result.selectionStart, result.selectionEnd);
        setSelection(
          result.selectionStart === result.selectionEnd
            ? null
            : { start: result.selectionStart, end: result.selectionEnd },
        );
      });
    },
    [onPatch],
  );

  const applyLinkWrap = useCallback(() => {
    const node = textareaRef.current;
    if (!node) return;
    const url =
      typeof window !== "undefined" ? window.prompt("Link URL", "https://") : null;
    if (!url) return;
    const start = node.selectionStart ?? 0;
    const end = node.selectionEnd ?? start;
    const result = applyLink(node.value, start, end, url);
    onPatch((current) => ({ ...current, text: result.text }));
    requestAnimationFrame(() => {
      const fresh = textareaRef.current;
      if (!fresh) return;
      fresh.focus();
      fresh.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  }, [onPatch]);

  const setRefs = useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node;
      onFocusInput(node);
    },
    [onFocusInput],
  );

  const onTextKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = event.currentTarget.value;
    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.shiftKey && event.key === "ArrowUp") {
      event.preventDefault();
      onMoveUp();
      return;
    }
    if (meta && event.shiftKey && event.key === "ArrowDown") {
      event.preventDefault();
      onMoveDown();
      return;
    }
    if (meta && event.altKey && (event.key === "1" || event.key === "2" || event.key === "3")) {
      event.preventDefault();
      onTurnInto("heading", Number(event.key) as 1 | 2 | 3);
      return;
    }
    if (meta && !event.shiftKey && !event.altKey && isFormattableBlock) {
      const lowered = event.key.toLowerCase();
      if (lowered === "b") {
        event.preventDefault();
        applyToggleWrap("**");
        return;
      }
      if (lowered === "i") {
        event.preventDefault();
        applyToggleWrap("*");
        return;
      }
      if (lowered === "e") {
        event.preventDefault();
        applyToggleWrap("`");
        return;
      }
      if (lowered === "k") {
        event.preventDefault();
        applyLinkWrap();
        return;
      }
    }
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

  if (block.type === "todo") {
    return (
      <TodoEditableBlock
        block={block}
        onFocusInput={onFocusInput}
        onPatch={onPatch}
        onRemoveEmpty={onRemoveEmpty}
      />
    );
  }

  if (block.type === "toggle") {
    return (
      <ToggleEditableBlock
        block={block}
        depth={depth}
        onFocusInput={onFocusInput}
        onPatch={onPatch}
        onRemoveEmpty={onRemoveEmpty}
        request={request}
        setError={setError}
        setMessage={setMessage}
      />
    );
  }

  if (block.type === "table") {
    return <TableEditableBlock block={block} onPatch={onPatch} />;
  }

  if (block.type === "bookmark") {
    return (
      <BookmarkEditableBlock
        block={block}
        onPatch={onPatch}
        request={request}
        setMessage={setMessage}
      />
    );
  }

  if (block.type === "embed") {
    return <EmbedEditableBlock block={block} onPatch={onPatch} />;
  }

  if (block.type === "file") {
    return (
      <FileEditableBlock
        block={block}
        onPatch={onPatch}
        request={request}
        setError={setError}
        setMessage={setMessage}
      />
    );
  }

  if (block.type === "page-link") {
    return (
      <PageLinkEditableBlock block={block} onPatch={onPatch} request={request} />
    );
  }

  const isParagraph = block.type === "paragraph";
  // Paragraph blocks suppress the native placeholder and use an overlay so
  // the hint only appears when the textarea is focused (Notion style).
  const nativePlaceholder = isParagraph
    ? ""
    : block.type === "code"
      ? "Code"
      : block.type === "raw"
        ? "Raw MDX"
        : block.type === "callout"
          ? "Callout"
          : block.type === "quote"
            ? "Quote"
            : "";
  const showOverlayPlaceholder = isParagraph && block.text.length === 0;
  const showInlineToolbar =
    isFormattableBlock && selection !== null && textareaRef.current !== null;

  return (
    <div className="mdx-document-text-block-shell">
      <textarea
        aria-label={`${BLOCK_TYPE_LABELS[block.type]} block`}
        className={`mdx-document-text-block mdx-document-text-block--${block.type}`}
        ref={setRefs}
        rows={block.type === "code" || block.type === "raw" ? 6 : Math.max(3, block.text.split("\n").length + 1)}
        value={block.text}
        placeholder={nativePlaceholder}
        onChange={(event) =>
          onPatch((current) => ({ ...current, text: event.target.value }))
        }
        onKeyDown={onTextKeyDown}
      />
      {showOverlayPlaceholder ? (
        <span className="mdx-document-block__placeholder" aria-hidden="true">
          Type &apos;/&apos; for commands
        </span>
      ) : null}
      {showSlashMenu ? (
        <BlockEditorCommandMenu
          className="mdx-document-slash-menu"
          commands={slashCommands}
          onChoose={onChooseSlashCommand}
        />
      ) : null}
      {showInlineToolbar && textareaRef.current ? (
        <InlineFormatPopover
          anchor={textareaRef.current}
          blockType={block.type}
          onBold={() => applyToggleWrap("**")}
          onClose={() => setSelection(null)}
          onCode={() => applyToggleWrap("`")}
          onItalic={() => applyToggleWrap("*")}
          onLink={applyLinkWrap}
          onStrike={() => applyToggleWrap("~~")}
          onTurnInto={onTurnInto}
        />
      ) : null}
    </div>
  );
}

interface InlineFormatPopoverProps {
  anchor: HTMLElement;
  blockType: MdxBlockType;
  onBold: () => void;
  onClose: () => void;
  onCode: () => void;
  onItalic: () => void;
  onLink: () => void;
  onStrike: () => void;
  onTurnInto: (type: MdxBlockType, level?: 1 | 2 | 3) => void;
}

function InlineFormatPopover({
  anchor,
  blockType,
  onBold,
  onClose,
  onCode,
  onItalic,
  onLink,
  onStrike,
  onTurnInto,
}: InlineFormatPopoverProps) {
  // mousedown on a button would normally steal focus from the textarea and
  // collapse the selection before the click handler runs. Preventing default
  // on mousedown keeps the textarea selection intact.
  const preserveSelection = (event: ReactMouseEvent) => {
    event.preventDefault();
  };

  return (
    <BlockPopover
      anchor={anchor}
      ariaLabel="Inline format"
      className="block-popover--inline"
      onClose={onClose}
      open={true}
      placement="top-start"
    >
      <div className="block-popover__inline" role="toolbar" aria-label="Inline format">
        <button
          type="button"
          className="block-popover__inline-btn"
          aria-label="Bold (⌘B)"
          title="Bold (⌘B)"
          onMouseDown={preserveSelection}
          onClick={onBold}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          className="block-popover__inline-btn"
          aria-label="Italic (⌘I)"
          title="Italic (⌘I)"
          onMouseDown={preserveSelection}
          onClick={onItalic}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          className="block-popover__inline-btn"
          aria-label="Strikethrough"
          title="Strikethrough"
          onMouseDown={preserveSelection}
          onClick={onStrike}
        >
          <s>S</s>
        </button>
        <button
          type="button"
          className="block-popover__inline-btn block-popover__inline-btn--mono"
          aria-label="Inline code (⌘E)"
          title="Inline code (⌘E)"
          onMouseDown={preserveSelection}
          onClick={onCode}
        >
          {"<>"}
        </button>
        <button
          type="button"
          className="block-popover__inline-btn"
          aria-label="Link (⌘K)"
          title="Link (⌘K)"
          onMouseDown={preserveSelection}
          onClick={onLink}
        >
          ⎇
        </button>
        <span className="block-popover__inline-divider" aria-hidden="true" />
        {([1, 2, 3] as const).map((level) => (
          <button
            key={`h${level}`}
            type="button"
            className="block-popover__inline-btn"
            aria-label={`Heading ${level} (⌘⌥${level})`}
            title={`Heading ${level} (⌘⌥${level})`}
            aria-pressed={blockType === "heading" ? "true" : undefined}
            onMouseDown={preserveSelection}
            onClick={() => onTurnInto("heading", level)}
          >
            H{level}
          </button>
        ))}
      </div>
    </BlockPopover>
  );
}

interface TodoEditableBlockProps {
  block: MdxBlock;
  onFocusInput: (node: HTMLInputElement | HTMLTextAreaElement | null) => void;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  onRemoveEmpty: () => void;
}

function TodoEditableBlock({
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
      // Empty line + Enter exits the todo block (drops the line and focuses
      // none — the EditableBlock parent will handle the next-paragraph flow
      // via onRemoveEmpty if appropriate).
      if (!node.value && lines.length > 1) {
        const nextLines = lines.filter((_, i) => i !== idx);
        const nextChecked = Array.from(checked)
          .filter((i) => i !== idx)
          .map((i) => (i > idx ? i - 1 : i));
        updateLines(nextLines, nextChecked, Math.max(0, idx - 1), "end");
        return;
      }
      // Otherwise insert a new empty line after the current one.
      const nextLines = [...lines.slice(0, idx + 1), "", ...lines.slice(idx + 1)];
      const nextChecked = Array.from(checked).map((i) => (i > idx ? i + 1 : i));
      updateLines(nextLines, nextChecked, idx + 1, "start");
      return;
    }
    if (event.key === "Backspace" && !node.value && node.selectionStart === 0) {
      event.preventDefault();
      if (lines.length === 1) {
        // Empty single-line todo: bubble up to the standard remove-empty flow,
        // which converts/removes the block.
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

interface ToggleEditableBlockProps {
  block: MdxBlock;
  depth: number;
  onFocusInput: (node: HTMLInputElement | HTMLTextAreaElement | null) => void;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  onRemoveEmpty: () => void;
  request: RequestFn;
  setError: (error: string) => void;
  setMessage: (kind: "error" | "success", text: string) => void;
}

function ToggleEditableBlock({
  block,
  depth,
  onFocusInput,
  onPatch,
  onRemoveEmpty,
  request,
  setError,
  setMessage,
}: ToggleEditableBlockProps) {
  const isOpen = block.open ?? true;
  const children = block.children ?? [];

  const toggleOpen = () => {
    onPatch((current) => ({ ...current, open: !(current.open ?? true) }));
  };

  const handleSummaryKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      // Enter on summary opens the toggle (if collapsed) and seeds an empty
      // first child if the body is empty.
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
      // Empty summary + no children → the toggle is essentially blank, fold
      // it back into the standard remove-empty flow.
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
          <EditableBlocksList
            blocks={children}
            depth={depth + 1}
            onBlocksChange={(next) => onPatch((current) => ({ ...current, children: next }))}
            request={request}
            setError={setError}
            setMessage={setMessage}
          />
        </div>
      ) : null}
    </div>
  );
}

interface TableEditableBlockProps {
  block: MdxBlock;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
}

function TableEditableBlock({ block, onPatch }: TableEditableBlockProps) {
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

interface BookmarkEditableBlockProps {
  block: MdxBlock;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  request: RequestFn;
  setMessage: (kind: "error" | "success", text: string) => void;
}

function BookmarkEditableBlock({
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

interface EmbedEditableBlockProps {
  block: MdxBlock;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
}

const EMBED_KIND_LABELS: Record<MdxEmbedKind, string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  iframe: "Iframe (CodePen, Loom, …)",
  video: "Direct video file",
};

function EmbedEditableBlock({ block, onPatch }: EmbedEditableBlockProps) {
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

function previewSrcForEmbed(kind: MdxEmbedKind, url: string): string {
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

interface FileEditableBlockProps {
  block: MdxBlock;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  request: RequestFn;
  setError: (error: string) => void;
  setMessage: (kind: "error" | "success", text: string) => void;
}

function FileEditableBlock({
  block,
  onPatch,
  request,
  setError,
  setMessage,
}: FileEditableBlockProps) {
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (file: File | null) => {
    if (!file || uploading) return;
    setUploading(true);
    const result = await uploadGenericFile({ file, request });
    setUploading(false);
    if (!result.ok) {
      setError(result.error);
      setMessage("error", `Upload failed: ${result.error}`);
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
        <span>{uploading ? "Uploading…" : "Choose file"}</span>
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface PageLinkEditableBlockProps {
  block: MdxBlock;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  request: RequestFn;
}

interface AdminPageEntry {
  slug: string;
  title: string;
}

function PageLinkEditableBlock({ block, onPatch, request }: PageLinkEditableBlockProps) {
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
        list.push({ slug, title });
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

  const current = pages.find((p) => p.slug === block.pageSlug);

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
            {filtered.length === 0 ? (
              <span className="mdx-document-page-link-block__empty">No pages found.</span>
            ) : (
              filtered.map((page) => (
                <button
                  key={page.slug}
                  type="button"
                  onClick={() => {
                    onPatch((current) => ({ ...current, pageSlug: page.slug }));
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <strong>{page.title}</strong>
                  <span>/{page.slug}</span>
                </button>
              ))
            )}
          </div>
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
