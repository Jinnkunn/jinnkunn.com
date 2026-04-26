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
  getMatchingBlockEditorCommands,
  type BlockEditorCommand,
} from "./block-editor";
import { BlockPopover } from "./block-popover";
import {
  BookmarkEditableBlock,
  ColumnEditableBlock,
  ColumnsEditableBlock,
  DataBlockEditableBlock,
  EmbedEditableBlock,
  FeaturedPagesBlockEditableBlock,
  FileEditableBlock,
  HeroBlockEditableBlock,
  LinkListBlockEditableBlock,
  NewsEntryEditableBlock,
  PageLinkEditableBlock,
  TableEditableBlock,
  TodoEditableBlock,
  ToggleEditableBlock,
  WorksEntryEditableBlock,
} from "./mdx-block-renderers";
import { RichTextEditableBlock } from "./rich-text-editable-block";
import {
  createMdxBlock,
  duplicateMdxBlock,
  MDX_BLOCK_COLORS,
  parseMdxBlocks,
  serializeMdxBlocks,
  type MdxBlock,
  type MdxBlockColor,
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
  todo: "To-do list",
  toggle: "Toggle",
  table: "Table",
  bookmark: "Bookmark",
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
  column: "Column",
  "news-entry": "News entry",
  "works-entry": "Works entry",
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
  // Basic — text-bearing blocks for paragraphs, headings, lists, and quotes.
  {
    description: "Plain paragraph text",
    group: "Basic",
    icon: "T",
    id: "text",
    keywords: ["text", "paragraph", "plain"],
    label: "Text",
    makeBlock: () => createMdxBlock("paragraph"),
  },
  {
    description: "Large section heading",
    group: "Basic",
    icon: "H₁",
    id: "heading1",
    keywords: ["h1", "heading1", "title"],
    label: "Heading 1",
    makeBlock: () => ({ ...createMdxBlock("heading"), level: 1, text: "" }),
  },
  {
    description: "Medium section heading",
    group: "Basic",
    icon: "H₂",
    id: "heading2",
    keywords: ["h2", "heading", "heading2"],
    label: "Heading 2",
    makeBlock: () => ({ ...createMdxBlock("heading"), level: 2, text: "" }),
  },
  {
    description: "Small section heading",
    group: "Basic",
    icon: "H₃",
    id: "heading3",
    keywords: ["h3", "heading3", "subheading"],
    label: "Heading 3",
    makeBlock: () => ({ ...createMdxBlock("heading"), level: 3, text: "" }),
  },
  {
    description: "Quote or excerpt",
    group: "Basic",
    icon: "❝",
    id: "quote",
    keywords: ["quote", "blockquote"],
    label: "Quote",
    makeBlock: () => createMdxBlock("quote"),
  },
  {
    description: "Bulleted or numbered list",
    group: "Basic",
    icon: "•",
    id: "list",
    keywords: ["list", "bullet", "bulleted", "numbered"],
    label: "List",
    makeBlock: () => createMdxBlock("list"),
  },
  {
    description: "Checkbox list with completion",
    group: "Basic",
    icon: "☑",
    id: "todo",
    keywords: ["todo", "task", "check", "checkbox", "checklist"],
    label: "To-do list",
    makeBlock: () => createMdxBlock("todo"),
  },
  {
    description: "Collapsible section with hidden content",
    group: "Basic",
    icon: "▸",
    id: "toggle",
    keywords: ["toggle", "collapse", "details", "expand"],
    label: "Toggle",
    makeBlock: () => createMdxBlock("toggle"),
  },
  // Media — uploads and platform-hosted media.
  {
    description: "Upload or paste an image",
    group: "Media",
    icon: "▢",
    id: "image",
    keywords: ["image", "img", "photo", "media"],
    label: "Image",
    makeBlock: () => createMdxBlock("image"),
  },
  {
    description: "YouTube or Vimeo video",
    group: "Media",
    icon: "▶",
    id: "video",
    keywords: ["video", "youtube", "vimeo"],
    label: "Video",
    makeBlock: () => ({ ...createMdxBlock("embed"), embedKind: "youtube" }),
  },
  {
    description: "Uploaded file attachment",
    group: "Media",
    icon: "⇩",
    id: "file",
    keywords: ["file", "upload", "attachment", "pdf"],
    label: "File",
    makeBlock: () => createMdxBlock("file"),
  },
  // Embeds — third-party content and links.
  {
    description: "Link preview card",
    group: "Embeds",
    icon: "⌐",
    id: "bookmark",
    keywords: ["bookmark", "link", "url", "preview"],
    label: "Bookmark",
    makeBlock: () => createMdxBlock("bookmark"),
  },
  {
    description: "Iframe embed (CodePen, Loom, Figma, …)",
    group: "Embeds",
    icon: "⌬",
    id: "embed",
    keywords: ["embed", "iframe"],
    label: "Embed",
    makeBlock: () => ({ ...createMdxBlock("embed"), embedKind: "iframe" }),
  },
  {
    description: "Link to another page in this site",
    group: "Embeds",
    icon: "→",
    id: "page-link",
    keywords: ["page", "link", "internal"],
    label: "Page link",
    makeBlock: () => createMdxBlock("page-link"),
  },
  // Data — typed JSON sources (news, publications, …) embedded as views.
  // Configure the query inline; entries live in their canonical content/*.json
  // and render via matching server components.
  {
    description: "Latest news entries from content/pages/news.mdx",
    group: "Data",
    icon: "📰",
    id: "news-block",
    keywords: ["news", "updates", "feed"],
    label: "News",
    makeBlock: () => createMdxBlock("news-block"),
  },
  {
    description: "A single dated entry inside the news page",
    group: "Data",
    icon: "🗞",
    id: "news-entry",
    keywords: ["news", "entry", "post", "dated", "feed-item"],
    label: "News entry",
    makeBlock: () => createMdxBlock("news-entry"),
  },
  {
    description: "Publication list from content/publications.json",
    group: "Data",
    icon: "📚",
    id: "publications-block",
    keywords: ["publications", "papers", "research", "academic"],
    label: "Publications",
    makeBlock: () => createMdxBlock("publications-block"),
  },
  {
    description: "Recent + past work entries from content/pages/works.mdx",
    group: "Data",
    icon: "💼",
    id: "works-block",
    keywords: ["works", "experience", "jobs", "projects", "career"],
    label: "Works",
    makeBlock: () => createMdxBlock("works-block"),
  },
  {
    description: "A single role / position inside the works page",
    group: "Data",
    icon: "🧑‍💼",
    id: "works-entry",
    keywords: ["works", "entry", "role", "job", "position"],
    label: "Works entry",
    makeBlock: () => createMdxBlock("works-entry"),
  },
  {
    description: "Teaching activities from content/teaching.json",
    group: "Data",
    icon: "🎓",
    id: "teaching-block",
    keywords: ["teaching", "courses", "education", "classes"],
    label: "Teaching",
    makeBlock: () => createMdxBlock("teaching-block"),
  },
  // Layout — structural blocks and advanced.
  {
    description: "Side-by-side columns (Notion-style)",
    group: "Layout",
    icon: "▥",
    id: "columns",
    keywords: ["columns", "column", "split", "side", "grid", "two", "three"],
    label: "Columns",
    makeBlock: () => createMdxBlock("columns"),
  },
  {
    description: "Profile image + headline (home-hero CSS)",
    group: "Layout",
    icon: "✶",
    id: "hero-block",
    keywords: ["hero", "intro", "profile", "headline", "landing"],
    label: "Hero",
    makeBlock: () => createMdxBlock("hero-block"),
  },
  {
    description: "Stack, grid, or inline row of links",
    group: "Layout",
    icon: "🔗",
    id: "link-list-block",
    keywords: ["links", "list", "buttons", "navigation"],
    label: "Link list",
    makeBlock: () => createMdxBlock("link-list-block"),
  },
  {
    description: "Card grid linking to other pages on the site",
    group: "Layout",
    icon: "🗂",
    id: "featured-pages-block",
    keywords: ["featured", "cards", "pages", "grid"],
    label: "Featured pages",
    makeBlock: () => createMdxBlock("featured-pages-block"),
  },
  {
    description: "Markdown table",
    group: "Layout",
    icon: "▦",
    id: "table",
    keywords: ["table", "grid", "matrix", "spreadsheet"],
    label: "Table",
    makeBlock: () => createMdxBlock("table"),
  },
  {
    description: "Visual separator",
    group: "Layout",
    icon: "—",
    id: "divider",
    keywords: ["divider", "hr", "line"],
    label: "Divider",
    makeBlock: () => createMdxBlock("divider"),
  },
  {
    description: "Highlighted note",
    group: "Layout",
    icon: "⚐",
    id: "callout",
    keywords: ["callout", "note", "tip"],
    label: "Callout",
    makeBlock: () => createMdxBlock("callout"),
  },
  {
    description: "Fenced code block",
    group: "Layout",
    icon: "{}",
    id: "code",
    keywords: ["code", "snippet"],
    label: "Code",
    makeBlock: () => createMdxBlock("code"),
  },
  {
    description: "Advanced MDX",
    group: "Layout",
    icon: "◇",
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

export interface BlocksEditorProps {
  /** Markdown body. The block editor parses this into blocks for editing
   * and serializes back on every change. */
  value: string;
  onChange: (next: string) => void;
  /** Min height for the canvas (matches MarkdownEditor's prop for swap-compat). */
  minHeight?: number;
  /** Optional inline placeholder shown when the body is empty. (Future
   * enhancement — not yet wired into the canvas paint.) */
  placeholder?: string;
}

/** Standalone Notion-style block editor. Same canvas used by
 * `MdxDocumentEditor` in "blocks" mode, but consumable on its own:
 * pass `value` (markdown) and `onChange`, and we own the rest
 * (block parsing/serialization, slash menu, drag-reorder, image
 * upload). Errors surface through the global site-admin message
 * banner, so callers don't need to plumb them. */
export function BlocksEditor({ value, onChange, minHeight }: BlocksEditorProps) {
  const { request, setMessage } = useSiteAdmin();
  // Local error sink — block-internal helpers expect a setError callback,
  // but inline use cases don't have a document-level error banner. Funnel
  // these through the global message banner instead so users still see them.
  const setError = useCallback(
    (error: string) => {
      if (error) setMessage("error", error);
    },
    [setMessage],
  );
  const [blocks, setBlocks] = useState<MdxBlock[]>(() => parseMdxBlocks(value));
  const [dragDepth, setDragDepth] = useState(0);
  const [uploading, setUploading] = useState(false);
  const lastEmittedBodyRef = useRef(value);

  useEffect(() => {
    if (value === lastEmittedBodyRef.current) return;
    lastEmittedBodyRef.current = value;
    // External body updates come from draft restore/source mode; the block
    // canvas keeps local IDs so focused blocks do not remount on every keystroke.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBlocks(parseMdxBlocks(value));
  }, [value]);

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
      style={minHeight ? { minHeight } : undefined}
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
  // The map holds whichever focusable element a block registered: <input>
  // / <textarea> for textarea-path blocks, the contenteditable HTMLElement
  // for TipTap-path blocks. The focus effect below only requires `.focus()`
  // — the textarea-only `setSelectionRange` call is opt-in so contenteditable
  // nodes don't blow up.
  const blockInputRefs = useRef(
    new Map<string, HTMLInputElement | HTMLTextAreaElement | HTMLElement>(),
  );
  const focusSeqRef = useRef(0);

  // Drag-reorder is enabled at every depth; HTML5 DnD scopes by parent
  // because each EditableBlocksList instance owns its own draggingBlockId
  // state, and the dataTransfer payload only matches when both source and
  // drop target live in the same list.
  const enableDrag = true;

  const registerBlockInput = useCallback(
    (
      blockId: string,
      node: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null,
    ) => {
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
    // setSelectionRange is textarea/input only. For contenteditable
    // (TipTap path) the browser places the caret naturally on focus.
    if (
      "value" in node &&
      "setSelectionRange" in node &&
      typeof (node as HTMLTextAreaElement).setSelectionRange === "function"
    ) {
      const length = (node as HTMLTextAreaElement).value.length;
      (node as HTMLTextAreaElement).setSelectionRange(length, length);
    }
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
          + Click to add a block
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
          data-color={block.color && block.color !== "default" ? block.color : undefined}
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
            onDuplicate={() => duplicateBlockById(block.id)}
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
          onSetColor={(color) => {
            patchBlock(actionMenu.blockId, (b) => ({ ...b, color }));
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
  onSetColor: (color: MdxBlockColor) => void;
  onTurnInto: (type: MdxBlockType) => void;
}

type ActionMenuPanel = "main" | "turnInto" | "color";

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
  onSetColor,
  onTurnInto,
}: BlockActionMenuProps) {
  const [panel, setPanel] = useState<ActionMenuPanel>("main");

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
      {panel === "turnInto" ? (
        <div className="block-popover__section" role="menu" aria-label="Turn into">
          <button
            type="button"
            className="block-popover__item block-popover__item--back"
            onClick={() => setPanel("main")}
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
      ) : panel === "color" ? (
        <div className="block-popover__section" role="menu" aria-label="Color">
          <button
            type="button"
            className="block-popover__item block-popover__item--back"
            onClick={() => setPanel("main")}
          >
            ← Color
          </button>
          {MDX_BLOCK_COLORS.map((color) => (
            <button
              type="button"
              key={color}
              className="block-popover__item block-popover__item--swatch"
              data-color={color}
              onClick={() => onSetColor(color)}
              aria-current={
                (block?.color ?? "default") === color ? "true" : undefined
              }
            >
              <span
                className="block-popover__swatch"
                data-color={color}
                aria-hidden="true"
              />
              <span style={{ textTransform: "capitalize" }}>{color}</span>
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
            onClick={() => setPanel("turnInto")}
          >
            <span>Turn into</span>
            <span aria-hidden="true">›</span>
          </button>
          <button
            type="button"
            className="block-popover__item"
            onClick={() => setPanel("color")}
          >
            <span>Color</span>
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
  onDuplicate,
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
  onDuplicate: () => void;
  onFocusInput: (
    node: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null,
  ) => void;
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
  // RichTextEditableBlock renders the slash menu internally when this list
  // is non-empty. Computed only for paragraph; heading / quote / callout /
  // list intentionally don't trigger the slash matcher even if their text
  // happens to start with "/".
  const slashCommands =
    block.type === "paragraph" ? getMatchingSlashCommands(block.text) : [];

  // Text-bearing blocks (paragraph, heading, quote, callout, list) render
  // through the TipTap-based WYSIWYG path so that **bold**, *italic*,
  // `code`, ~~strike~~, and [links](url) appear formatted inline rather
  // than as raw markdown chars. Todo + toggle still ride dedicated
  // components in mdx-block-renderers (todo wraps each item in a row,
  // toggle has its own chrome plus its summary now uses RichTextInput).
  if (
    block.type === "paragraph" ||
    block.type === "heading" ||
    block.type === "quote" ||
    block.type === "callout" ||
    block.type === "list"
  ) {
    return (
      <RichTextEditableBlock
        block={block}
        slashCommands={slashCommands}
        onChooseSlashCommand={onChooseSlashCommand}
        onDuplicate={onDuplicate}
        onFocusInput={onFocusInput as (node: HTMLElement | null) => void}
        onInsertParagraphAfter={onInsertParagraphAfter}
        onMoveDown={onMoveDown}
        onMoveUp={onMoveUp}
        onPatch={onPatch}
        onRemoveEmpty={onRemoveEmpty}
        onSlashCommand={onSlashCommand}
        onTurnInto={onTurnInto}
        request={request}
      />
    );
  }

  // The textarea path now only serves `code` / `raw` blocks (verbatim text
  // with no inline marks) plus a defensive catch-all for any future block
  // type that lacks a dedicated renderer. All formattable blocks
  // (paragraph, heading, quote, callout, list) and per-item containers
  // (todo, toggle) live in TipTap-backed components — the inline format
  // toolbar, mention picker, slash menu, mirror-div caret coords, and
  // toggle-wrap helpers all moved with them.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const setRefs = useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node;
      onFocusInput(node);
    },
    [onFocusInput],
  );

  // Verbatim-text keyboard contract: block-level navigation + a
  // Backspace-at-empty short-circuit. Inline format shortcuts and Enter-
  // to-new-block are intentionally absent — code / raw shouldn't auto-wrap
  // markdown chars and Enter should insert a literal newline.
  const onTextKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
    if (meta && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "d") {
      event.preventDefault();
      onDuplicate();
      return;
    }
    if (
      event.key === "Backspace" &&
      isTextEditableBlock(block) &&
      !event.currentTarget.value.trim() &&
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

  // heading is handled by RichTextEditableBlock above; this branch is
  // intentionally absent so the dispatcher falls through cleanly to the
  // remaining textarea-path block types (list, code, raw, todo, …).

  if (block.type === "divider") {
    return (
      <div className="mdx-document-divider-block" aria-label="Divider block">
        <span />
      </div>
    );
  }

  // list is handled by RichTextEditableBlock above.

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
        renderChildren={(props) => (
          <EditableBlocksList
            blocks={props.blocks}
            depth={props.depth}
            onBlocksChange={props.onBlocksChange}
            request={request}
            setError={setError}
            setMessage={setMessage}
          />
        )}
      />
    );
  }

  if (block.type === "columns") {
    return (
      <ColumnsEditableBlock
        block={block}
        depth={depth}
        onPatch={onPatch}
        renderChildren={(props) => (
          <EditableBlocksList
            blocks={props.blocks}
            depth={props.depth}
            onBlocksChange={props.onBlocksChange}
            request={request}
            setError={setError}
            setMessage={setMessage}
          />
        )}
      />
    );
  }

  if (block.type === "column") {
    // Columns parents render their `<Column>` children inline. This branch
    // only fires if a stray `<Column>` reaches the top level — defensive
    // fallback so the user can still edit (and re-wrap from the slash menu).
    return (
      <ColumnEditableBlock
        block={block}
        depth={depth}
        onPatch={onPatch}
        renderChildren={(props) => (
          <EditableBlocksList
            blocks={props.blocks}
            depth={props.depth}
            onBlocksChange={props.onBlocksChange}
            request={request}
            setError={setError}
            setMessage={setMessage}
          />
        )}
      />
    );
  }

  if (block.type === "news-entry") {
    return (
      <NewsEntryEditableBlock
        block={block}
        depth={depth}
        onPatch={onPatch}
        renderChildren={(props) => (
          <EditableBlocksList
            blocks={props.blocks}
            depth={props.depth}
            onBlocksChange={props.onBlocksChange}
            request={request}
            setError={setError}
            setMessage={setMessage}
          />
        )}
      />
    );
  }

  if (block.type === "works-entry") {
    return (
      <WorksEntryEditableBlock
        block={block}
        depth={depth}
        onPatch={onPatch}
        renderChildren={(props) => (
          <EditableBlocksList
            blocks={props.blocks}
            depth={props.depth}
            onBlocksChange={props.onBlocksChange}
            request={request}
            setError={setError}
            setMessage={setMessage}
          />
        )}
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

  if (block.type === "news-block") {
    return (
      <DataBlockEditableBlock
        block={block}
        onPatch={onPatch}
        label="News"
        icon="📰"
        description="Latest entries from content/pages/news.mdx"
      />
    );
  }

  if (block.type === "publications-block") {
    return (
      <DataBlockEditableBlock
        block={block}
        onPatch={onPatch}
        label="Publications"
        icon="📚"
        description="Publication list from content/publications.json"
      />
    );
  }

  if (block.type === "works-block") {
    return (
      <DataBlockEditableBlock
        block={block}
        onPatch={onPatch}
        label="Works"
        icon="💼"
        description="Work entries from content/works.json"
      />
    );
  }

  if (block.type === "teaching-block") {
    return (
      <DataBlockEditableBlock
        block={block}
        onPatch={onPatch}
        label="Teaching"
        icon="🎓"
        description="Teaching activities from content/teaching.json"
      />
    );
  }

  if (block.type === "hero-block") {
    return <HeroBlockEditableBlock block={block} onPatch={onPatch} />;
  }

  if (block.type === "link-list-block") {
    return <LinkListBlockEditableBlock block={block} onPatch={onPatch} />;
  }

  if (block.type === "featured-pages-block") {
    return <FeaturedPagesBlockEditableBlock block={block} onPatch={onPatch} />;
  }

  // Catch-all textarea render for `code` / `raw` and any future
  // unhandled block type. Verbatim text only — no slash menu / mention
  // picker / inline format toolbar; all of those moved to the TipTap
  // path with the formattable block types.
  const nativePlaceholder = block.type === "code" ? "Code" : block.type === "raw" ? "Raw MDX" : "";
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
    </div>
  );
}

export function MdxDocumentEditor<TForm>({
  adapter,
  mode,
  onExit,
  slug: initialSlug,
}: MdxDocumentEditorProps<TForm>) {
  const { bumpContentRevision, request, setMessage } = useSiteAdmin();
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
        bumpContentRevision();
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
      bumpContentRevision();
      onExit("saved", currentSlug);
    },
    [
      adapter,
      body,
      bumpContentRevision,
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
    bumpContentRevision();
    onExit("deleted", initialSlug);
  }, [
    adapter,
    bumpContentRevision,
    clearDraft,
    initialSlug,
    mode,
    onExit,
    request,
    setMessage,
    version,
  ]);

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
                <BlocksEditor value={body} onChange={setBody} />
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
