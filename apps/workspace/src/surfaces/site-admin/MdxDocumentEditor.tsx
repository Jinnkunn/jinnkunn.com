import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type FocusEvent,
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
import {
  BlockActionMenu,
  BlockGutterHandles,
} from "./block-action-menu";
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
  PublicationsEntryEditableBlock,
  PublicationsProfileLinksEditableBlock,
  TableEditableBlock,
  TeachingEntryEditableBlock,
  TeachingLinksEditableBlock,
  TodoEditableBlock,
  ToggleEditableBlock,
  WorksEntryEditableBlock,
} from "./mdx-block-renderers";
import { RichTextEditableBlock } from "./rich-text-editable-block";
import { useImeComposition } from "./useImeComposition";
import { classifySiteAdminError } from "./api-errors";
import {
  decodeDocumentLoad,
  decodeDocumentSave,
} from "./api-validators";
import { SiteAdminEnvironmentBanner } from "./SiteAdminEnvironmentBanner";
import {
  createMdxBlock,
  duplicateMdxBlock,
  parseMdxBlocks,
  serializeMdxBlocks,
  type MdxBlock,
  type MdxBlockType,
} from "./mdx-blocks";
import { localContent } from "./local-content";
import { useSiteAdmin } from "./state";
import { formatDraftAge, useEditorDraft, type EditorKind } from "./use-editor-draft";
import {
  useConfirmingBack,
  useMdxImageUploadDrop,
  useUnsavedChangesBeforeUnload,
} from "./use-mdx-editor-controller";
import { isBoolean, isString, usePersistentUiState } from "./use-persistent-ui-state";
import type { NormalizedApiResponse } from "./types";
import {
  WorkspaceInspector,
  WorkspaceInspectorHeader,
  WorkspaceInspectorSection,
} from "../../ui/primitives";

type DocumentEditorMode = "blocks" | "source";
type DocumentExitAction = "saved" | "deleted" | "cancel";

type RequestFn = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<NormalizedApiResponse>;

const DOCUMENT_EDITOR_MODES: DocumentEditorMode[] = ["blocks", "source"];

const DOCUMENT_EDITOR_MODE_LABELS: Record<DocumentEditorMode, string> = {
  blocks: "Write",
  source: "MDX",
};

const SLUG_HINTS: Partial<Record<EditorKind, string>> = {
  page: "Each segment 1–60 lowercase chars, separated by '/' (max 4 levels)",
  post: "1–120 chars, lowercase letters / digits / hyphens, no leading or trailing dash",
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
  "teaching-entry": "Teaching entry",
  "publications-entry": "Publication",
  "teaching-links": "Teaching links",
  "publications-profile-links": "Profile links",
  divider: "Divider",
  callout: "Callout",
  code: "Code",
  raw: "Raw MDX",
};


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
    description: "Publication list from content/pages/publications.mdx",
    group: "Data",
    icon: "📚",
    id: "publications-block",
    keywords: ["publications", "papers", "research", "academic"],
    label: "Publications",
    makeBlock: () => createMdxBlock("publications-block"),
  },
  {
    description: "A single publication inside the publications page",
    group: "Data",
    icon: "📑",
    id: "publications-entry",
    keywords: ["publication", "paper", "entry", "research"],
    label: "Publication",
    makeBlock: () => createMdxBlock("publications-entry"),
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
    description: "Teaching activities from content/pages/teaching.mdx",
    group: "Data",
    icon: "🎓",
    id: "teaching-block",
    keywords: ["teaching", "courses", "education", "classes"],
    label: "Teaching",
    makeBlock: () => createMdxBlock("teaching-block"),
  },
  {
    description: "A single teaching activity inside the teaching page",
    group: "Data",
    icon: "🎓",
    id: "teaching-entry",
    keywords: ["teaching", "entry", "course", "class", "term"],
    label: "Teaching entry",
    makeBlock: () => createMdxBlock("teaching-entry"),
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
  body: string;
  form: TForm;
  mode: "create" | "edit";
  readOnly: boolean;
  setForm: Dispatch<SetStateAction<TForm>>;
  setSlug: (slug: string) => void;
  slug: string;
  slugHint: string;
}

export interface MdxDocumentEditorAdapter<TForm> {
  allowBack?: boolean;
  allowDelete?: boolean;
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
  renderDocumentTools?: (props: {
    body: string;
    readOnly: boolean;
    setBody: Dispatch<SetStateAction<string>>;
  }) => ReactNode;
  renderProperties: (props: MdxDocumentPropertiesProps<TForm>) => ReactNode;
  routeBase: string;
  loadDocument?: (input: {
    request: RequestFn;
    slug: string;
  }) => Promise<
    | { ok: true; source: string; version: string }
    | { ok: false; code: string; error: string }
  >;
  saveDocument?: (input: {
    request: RequestFn;
    slug: string;
    source: string;
    version: string;
  }) => Promise<NormalizedApiResponse>;
  setTitle: (form: TForm, title: string) => TForm;
  stayAfterSave?: boolean;
  title?: string;
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

function isBlockVisuallyEmpty(block: MdxBlock): boolean {
  if (isTextEditableBlock(block)) return block.text.trim().length === 0;
  if (block.type === "image") return !block.url;
  if (block.type === "bookmark") return !block.url && !block.title;
  if (block.type === "embed") return !block.url;
  if (block.type === "file") return !block.url && !block.filename;
  if (block.type === "page-link") return !block.pageSlug;
  if (block.type === "table") {
    return !block.tableData?.rows.some((row) => row.some((cell) => cell.trim()));
  }
  if (block.type === "columns" || block.type === "column") {
    return !block.children?.some((child) => !isBlockVisuallyEmpty(child));
  }
  return false;
}

export interface BlocksEditorProps {
  /** Markdown body. The block editor parses this into blocks for editing
   * and serializes back on every change. */
  value: string;
  onChange: (next: string) => void;
  /** Min height for the canvas (matches MarkdownEditor's prop for swap-compat). */
  minHeight?: number;
  readOnly?: boolean;
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
export function BlocksEditor({
  value,
  onChange,
  minHeight,
  readOnly = false,
}: BlocksEditorProps) {
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
      if (readOnly) return;
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
    [blocks, handleBlocksChange, readOnly, request, setError, setMessage],
  );

  return (
    <div
      className="mdx-document-blocks"
      data-drag-active={dragDepth > 0 ? "true" : undefined}
      data-read-only={readOnly ? "true" : undefined}
      data-uploading={uploading ? "true" : undefined}
      style={minHeight ? { minHeight } : undefined}
      onDragEnter={(event: DragEvent<HTMLDivElement>) => {
        if (readOnly) return;
        if (Array.from(event.dataTransfer.types).includes("application/x-mdx-block")) return;
        event.preventDefault();
        setDragDepth((depth) => depth + 1);
      }}
      onDragLeave={() => {
        if (readOnly) return;
        setDragDepth((depth) => Math.max(0, depth - 1));
      }}
      onDrop={(event) => {
        if (readOnly) return;
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
        readOnly={readOnly}
        request={request}
        setError={setError}
        setMessage={setMessage}
      />

      {readOnly ? null : (
        <AssetLibraryPicker
          onSelect={(asset) =>
            appendImageBlock(asset.url, asset.alt || asset.filename || "image")
          }
        />
      )}
    </div>
  );
}

interface EditableBlocksListProps {
  blocks: MdxBlock[];
  depth: number;
  onBlocksChange: (next: MdxBlock[]) => void;
  readOnly?: boolean;
  request: RequestFn;
  setError: (error: string) => void;
  setMessage: (kind: "error" | "success", text: string) => void;
}

function EditableBlocksList({
  blocks,
  depth,
  onBlocksChange,
  readOnly = false,
  request,
  setError,
  setMessage,
}: EditableBlocksListProps) {
  const [draggingBlockId, setDraggingBlockId] = useState("");
  const [dragOverBlockId, setDragOverBlockId] = useState("");
  const [uploadingId, setUploadingId] = useState("");
  const [focusedBlockId, setFocusedBlockId] = useState("");
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
  const enableDrag = !readOnly;

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
    (
      id: string,
      type: MdxBlockType,
      level?: 1 | 2 | 3,
      listStyle?: "bulleted" | "numbered",
    ) => {
      commitBlocks(
        blocks.map((block) => {
          if (block.id !== id) return block;
          const next = replaceBlockType(block, type);
          if (type === "heading" && level) {
            return { ...next, level };
          }
          if (type === "list" && listStyle) {
            return { ...next, listStyle, markers: undefined };
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

  const clearFocusedBlockIfLeaving = useCallback(
    (blockId: string, event: FocusEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
      setFocusedBlockId((current) => (current === blockId ? "" : current));
    },
    [],
  );

  if (blocks.length === 0) {
    // Empty nested list (e.g. an empty toggle body) — show a click-to-add
    // affordance so users have a way in. Only reachable when depth > 0.
    return (
      <div className="mdx-document-blocks-empty">
        <button
          type="button"
          className="mdx-document-blocks-empty__btn"
          disabled={readOnly}
          onClick={() => commitBlocks([createMdxBlock("paragraph")])}
        >
          {readOnly ? "No blocks" : "+ Click to add a block"}
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
          data-kind={block.type}
          data-empty={isBlockVisuallyEmpty(block) ? "true" : undefined}
          data-color={block.color && block.color !== "default" ? block.color : undefined}
          data-drag-over={dragOverBlockId === block.id ? "true" : undefined}
          data-dragging={draggingBlockId === block.id ? "true" : undefined}
          data-controls-open={
            actionMenu?.blockId === block.id ||
            draggingBlockId === block.id ||
            focusedBlockId === block.id
              ? "true"
              : undefined
          }
          key={block.id}
          onFocusCapture={() => setFocusedBlockId(block.id)}
          onBlurCapture={(event) => clearFocusedBlockIfLeaving(block.id, event)}
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
          {readOnly ? null : (
            <BlockGutterHandles
              controlsActive={
                actionMenu?.blockId === block.id ||
                draggingBlockId === block.id ||
                focusedBlockId === block.id
              }
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
          )}

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
            readOnly={readOnly}
          />
        </div>
      ))}

      {actionMenu && !readOnly ? (
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
          onTurnInto={(type, level, listStyle) => {
            changeBlockType(actionMenu.blockId, type, level, listStyle);
            setActionMenu(null);
          }}
        />
      ) : null}
    </>
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
  readOnly = false,
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
  readOnly?: boolean;
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const setRefs = useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node;
      onFocusInput(node);
    },
    [onFocusInput],
  );

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
        readOnly={readOnly}
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
  // Verbatim-text keyboard contract: block-level navigation + a
  // Backspace-at-empty short-circuit. Inline format shortcuts and Enter-
  // to-new-block are intentionally absent — code / raw shouldn't auto-wrap
  // markdown chars and Enter should insert a literal newline.
  const onTextKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (readOnly) return;
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
            disabled={uploading || readOnly}
            onChange={(event) => {
              onUploadImage(event.target.files?.[0] ?? null);
              event.currentTarget.value = "";
            }}
          />
        </label>
        <div className="mdx-document-image-block__fields">
          <input
            aria-label="Image URL"
            readOnly={readOnly}
            value={block.url || ""}
            placeholder="/uploads/image.png"
            onChange={(event) =>
              onPatch((current) => ({ ...current, url: event.target.value }))
            }
          />
          <input
            aria-label="Image alt text"
            readOnly={readOnly}
            value={block.alt || ""}
            placeholder="Alt text"
            onChange={(event) =>
              onPatch((current) => ({ ...current, alt: event.target.value }))
            }
          />
          <input
            aria-label="Image caption"
            readOnly={readOnly}
            value={block.caption || ""}
            placeholder="Caption"
            onChange={(event) =>
              onPatch((current) => ({ ...current, caption: event.target.value }))
            }
          />
          {readOnly ? null : (
            <div className="mdx-document-image-block__asset-picker">
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
            </div>
          )}
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
            readOnly={readOnly}
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
            readOnly={readOnly}
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
            readOnly={readOnly}
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
            readOnly={readOnly}
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
            readOnly={readOnly}
            request={request}
            setError={setError}
            setMessage={setMessage}
          />
        )}
      />
    );
  }

  if (block.type === "teaching-entry") {
    return <TeachingEntryEditableBlock block={block} onPatch={onPatch} />;
  }

  if (block.type === "publications-entry") {
    return <PublicationsEntryEditableBlock block={block} onPatch={onPatch} />;
  }

  if (block.type === "teaching-links") {
    return <TeachingLinksEditableBlock block={block} onPatch={onPatch} />;
  }

  if (block.type === "publications-profile-links") {
    return (
      <PublicationsProfileLinksEditableBlock block={block} onPatch={onPatch} />
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
        description="Publication list from content/pages/publications.mdx"
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
        description="Work entries from content/pages/works.mdx"
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
        description="Teaching activities from content/pages/teaching.mdx"
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
  return (
    <CodeOrRawTextarea
      block={block}
      readOnly={readOnly}
      onPatch={onPatch}
      onTextKeyDown={onTextKeyDown}
      setRefs={setRefs}
    />
  );
}

function CodeOrRawTextarea({
  block,
  readOnly,
  onPatch,
  onTextKeyDown,
  setRefs,
}: {
  block: MdxBlock;
  readOnly: boolean;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  onTextKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  setRefs: (node: HTMLTextAreaElement | null) => void;
}) {
  const ime = useImeComposition(
    useCallback(
      (next: string) => onPatch((current) => ({ ...current, text: next })),
      [onPatch],
    ),
  );
  const placeholder = block.type === "code" ? "Code" : block.type === "raw" ? "Raw MDX" : "";
  return (
    <div className="mdx-document-text-block-shell">
      <textarea
        aria-label={`${BLOCK_TYPE_LABELS[block.type]} block`}
        className={`mdx-document-text-block mdx-document-text-block--${block.type}`}
        ref={setRefs}
        rows={block.type === "code" || block.type === "raw" ? 6 : Math.max(3, block.text.split("\n").length + 1)}
        value={block.text}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={ime.onChange}
        onCompositionStart={ime.onCompositionStart}
        onCompositionEnd={ime.onCompositionEnd}
        onKeyDown={onTextKeyDown}
      />
    </div>
  );
}

function TitleInput({
  "aria-label": ariaLabel,
  value,
  readOnly,
  onChange,
}: {
  "aria-label": string;
  value: string;
  readOnly: boolean;
  onChange: (next: string) => void;
}) {
  const ime = useImeComposition(onChange);
  return (
    <input
      aria-label={ariaLabel}
      className="mdx-document-editor__title"
      value={value}
      placeholder="Untitled"
      readOnly={readOnly}
      onChange={ime.onChange}
      onCompositionStart={ime.onCompositionStart}
      onCompositionEnd={ime.onCompositionEnd}
      required
    />
  );
}

export function MdxDocumentEditor<TForm>({
  adapter,
  mode,
  onExit,
  slug: initialSlug,
}: MdxDocumentEditorProps<TForm>) {
  const {
    bumpContentRevision,
    environment,
    productionReadOnly,
    request,
    setMessage,
    setTopbarSaveAction,
  } = useSiteAdmin();
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
  const [conflict, setConflict] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
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
  const sourcePath = slug.trim() ? adapter.contentPath(slug.trim()) : "Pending slug";
  const statusLabel = loading
    ? "Loading"
    : saving
      ? "Saving"
      : deleting
        ? "Deleting"
        : conflict
          ? "Conflict"
          : dirty
            ? "Unsaved changes"
            : "Saved to source branch";
  const imageDrop = useMdxImageUploadDrop({ request, setError, setMessage });
  const { confirmBack, leaveEditor } = useConfirmingBack({
    dirty,
    initialSlug,
    onExit,
    source,
  });

  const draftKeySlug = mode === "create" ? "" : (initialSlug ?? "");
  const { restorable, clearDraft, dismissRestore, saveDraftNow } = useEditorDraft(
    adapter.kind,
    draftKeySlug,
    body,
    form,
    !loading,
    dirty,
  );

  useEffect(() => {
    if (mode !== "edit" || !initialSlug) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      setConflict(false);
      let loadedSource = "";
      let loadedVersion = "";
      if (adapter.loadDocument) {
        const custom = await adapter.loadDocument({ request, slug: initialSlug });
        if (cancelled) return;
        setLoading(false);
        if (!custom.ok) {
          const msg = `${custom.code}: ${custom.error}`;
          setError(msg);
          setMessage("error", `Load ${adapter.titleNoun} failed: ${msg}`);
          return;
        }
        loadedSource = custom.source;
        loadedVersion = custom.version;
      } else {
        // Phase 5a — local-first: try the SQLite mirror primed by
        // useLocalSync. The local row's `body_text` is the same MDX
        // string the server returns as `source`, and the `sha` matches
        // what the server returns as `version` (Phase #2 sha alignment).
        // On hit we open instantly and skip HTTP entirely. The mirror
        // refreshes every 30s in the background; the next save's
        // optimistic-lock check catches any actual D1 divergence.
        let localHit: { source: string; version: string } | null = null;
        try {
          const row = await localContent.getFile(adapter.contentPath(initialSlug));
          if (row && !row.is_binary && row.body_text != null) {
            localHit = { source: row.body_text, version: row.sha };
          }
        } catch {
          // local read failed (mirror missing / DB locked) — fall through
          // to the HTTP path so the editor still opens.
        }
        if (localHit) {
          if (cancelled) return;
          loadedSource = localHit.source;
          loadedVersion = localHit.version;
          setLoading(false);
        } else {
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
          const decoded = decodeDocumentLoad(response.data);
          if (!decoded) {
            setMessage(
              "error",
              `Load ${adapter.titleNoun} failed: response missing source/version fields.`,
            );
            return;
          }
          loadedSource = decoded.source;
          loadedVersion = decoded.version;
        }
      }
      const parsed = adapter.parseSource(loadedSource);
      const nextBody = parsed.body.replace(/^\n+/, "");
      setForm(parsed.form);
      setBody(nextBody);
      setLastSavedSource(adapter.buildSource(parsed.form, nextBody));
      setVersion(loadedVersion);
      setConflict(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter, initialSlug, mode, reloadNonce, request, setMessage]);

  useUnsavedChangesBeforeUnload(dirty, saving, deleting);

  const canSave = useMemo(
    () => adapter.canSave({ body, form, mode, slug }),
    [adapter, body, form, mode, slug],
  );

  const copyCurrentSource = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(source);
      setMessage("success", "Current MDX copied.");
    } catch {
      setMessage("warn", "Could not copy current MDX. Use Source mode if you need to copy manually.");
    }
  }, [setMessage, source]);

  const save = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      if (!canSave || saving) return;
      if (productionReadOnly) {
        setMessage("warn", environment.helpText);
        return;
      }
      if (conflict) {
        setMessage("warn", `${adapter.titleNoun} is in conflict state. Reload latest before saving.`);
        return;
      }
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
          const info = classifySiteAdminError(response, {
            action: `Create ${adapter.titleNoun}`,
            subject: adapter.titleNoun,
          });
          setError(info.detail);
          setMessage(info.category === "read_only" ? "warn" : "error", info.banner);
          return;
        }
        setLastSavedSource(nextSource);
        clearDraft();
        setMessage(
          "success",
          `${adapter.titleNoun} created in source branch. Publish staging separately.`,
        );
        bumpContentRevision();
        if (!adapter.stayAfterSave) onExit("saved", slug.trim());
        return;
      }

      const currentSlug = initialSlug ?? slug;
      const response = adapter.saveDocument
        ? await adapter.saveDocument({
            request,
            slug: currentSlug,
            source: nextSource,
            version,
          })
        : await request(
            `${adapter.routeBase}/${encodeURIComponent(currentSlug)}`,
            "PATCH",
            { source: nextSource, version },
          );
      setSaving(false);
      if (!response.ok) {
        const info = classifySiteAdminError(response, {
          action: `Update ${adapter.titleNoun}`,
          subject: adapter.titleNoun,
        });
        if (info.category === "conflict") {
          setConflict(true);
        }
        setError(info.detail);
        setMessage(
          info.category === "conflict" || info.category === "read_only"
            ? "warn"
            : "error",
          info.banner,
        );
        return;
      }
      const saved = decodeDocumentSave(response.data);
      if (saved.version) setVersion(saved.version);
      else if (saved.fileSha) setVersion(saved.fileSha);
      setLastSavedSource(nextSource);
      setConflict(false);
      clearDraft();
      setMessage(
        "success",
        `${adapter.titleNoun} saved to source branch. Publish staging separately.`,
      );
      bumpContentRevision();
      if (!adapter.stayAfterSave) onExit("saved", currentSlug);
    },
    [
      adapter,
      body,
      bumpContentRevision,
      canSave,
      clearDraft,
      conflict,
      environment.helpText,
      form,
      initialSlug,
      mode,
      onExit,
      productionReadOnly,
      request,
      saving,
      setMessage,
      slug,
      version,
    ],
  );

  useEffect(() => {
    setTopbarSaveAction({
      dirty,
      disabled:
        !canSave ||
        saving ||
        loading ||
        imageDrop.uploading ||
        conflict ||
        productionReadOnly,
      label: saving
        ? "Saving..."
        : mode === "create"
          ? `Create ${adapter.titleNoun}`
          : `Save ${adapter.titleNoun}`,
      onSave: () => {
        void save();
      },
      saving,
      title: productionReadOnly
        ? environment.helpText
        : conflict
          ? "Reload latest before saving this document."
          : undefined,
    });
    return () => setTopbarSaveAction(null);
  }, [
    adapter.titleNoun,
    canSave,
    conflict,
    dirty,
    environment.helpText,
    imageDrop.uploading,
    loading,
    mode,
    productionReadOnly,
    save,
    saving,
    setTopbarSaveAction,
  ]);

  const remove = useCallback(async () => {
    if (adapter.allowDelete === false) return;
    if (productionReadOnly) {
      setMessage("warn", environment.helpText);
      return;
    }
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
      const info = classifySiteAdminError(response, {
        action: `Delete ${adapter.titleNoun}`,
        subject: adapter.titleNoun,
      });
      setError(info.detail);
      setMessage(info.category === "read_only" ? "warn" : "error", info.banner);
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
    environment.helpText,
    initialSlug,
    mode,
    onExit,
    productionReadOnly,
    request,
    setMessage,
    version,
  ]);

  const title = mode === "create"
    ? `New ${adapter.titleNoun}`
    : (adapter.title ?? `Edit ${adapter.titleNoun}: ${initialSlug ?? ""}`);
  const formId = `${adapter.kind}-document-editor-form`;

  return (
    <section className="surface-card mdx-document-editor-card">
      <header className="mdx-document-editor__topbar">
        <div className="mdx-document-editor__context">
          <h1 className="mdx-document-editor__context-title">
            {title}
          </h1>
          <div className="mdx-document-editor__context-meta">
            <p className="mdx-document-editor__crumb">
              {mode === "create" ? "New draft" : initialSlug}
            </p>
            <span className={`editor-state ${dirty ? "editor-state--dirty" : "editor-state--clean"}`}>
              {dirty ? "Unsaved changes" : "Saved to source branch"}
            </span>
          </div>
        </div>
        <div className="mdx-document-editor__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setPropertiesOpen((open) => !open)}
            disabled={saving || deleting}
            aria-expanded={propertiesOpen}
          >
            Options
          </button>
          {adapter.allowBack !== false && (
            <button
              type="button"
              className={confirmBack ? "btn btn--danger" : "btn btn--ghost"}
              onClick={leaveEditor}
              disabled={saving || deleting}
            >
              {confirmBack ? "Discard changes" : "Back"}
            </button>
          )}
          {mode === "edit" && adapter.allowDelete !== false && (
            <button
              type="button"
              className={confirmDelete ? "btn btn--danger btn--confirming" : "btn btn--danger"}
              onClick={() => {
                if (confirmDelete) void remove();
                else setConfirmDelete(true);
              }}
              disabled={saving || deleting || loading || !version || productionReadOnly}
            >
              {deleting ? "Deleting…" : confirmDelete ? "Click again to confirm" : "Delete"}
            </button>
          )}
          <button
            type="submit"
            form={formId}
            className="btn btn--primary"
            disabled={!canSave || saving || loading || imageDrop.uploading || conflict || productionReadOnly}
          >
            {saving ? "Saving…" : mode === "create" ? "Create" : "Save"}
          </button>
        </div>
      </header>

      {conflict && (
        <div className="editor-conflict" role="alert">
          <span>
            Remote content changed. Reload latest to continue editing this{" "}
            {adapter.titleNoun.toLowerCase()}. Your current edit is preserved
            as a local draft before reload.
          </span>
          <button
            type="button"
            className="btn btn--ghost draft-restore__btn"
            onClick={() => void copyCurrentSource()}
            disabled={loading || saving}
          >
            Copy current MDX
          </button>
          <button
            type="button"
            className="btn btn--secondary draft-restore__btn"
            onClick={() => {
              saveDraftNow();
              setReloadNonce((value) => value + 1);
            }}
            disabled={loading || saving}
          >
            Reload latest
          </button>
        </div>
      )}

      <SiteAdminEnvironmentBanner actionLabel="edit content" />

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
          data-read-only={productionReadOnly ? "true" : undefined}
        >
          <div className="mdx-document-editor__toolbar" aria-label="Document editor mode">
            <div className="home-builder__segmented mdx-document-editor__mode-switch">
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
            <span className="mdx-document-editor__mode-hint">
              {editorMode === "blocks"
                ? "Visual editor"
                : imageDrop.uploading
                  ? "Uploading image…"
                  : imageDrop.dragDepth > 0
                    ? "Drop to upload"
                    : "Raw MDX"}
            </span>
          </div>

          <div className="mdx-document-editor__layout">
            <main className="mdx-document-editor__canvas">
              <TitleInput
                aria-label={`${adapter.titleNoun} title`}
                value={adapter.getTitle(form)}
                readOnly={productionReadOnly}
                onChange={(next) =>
                  setForm((current) => adapter.setTitle(current, next))
                }
              />

              {adapter.renderDocumentTools ? (
                <div className="mdx-document-editor__document-tools">
                  {adapter.renderDocumentTools({
                    body,
                    readOnly: productionReadOnly,
                    setBody,
                  })}
                </div>
              ) : null}

              {editorMode === "blocks" ? (
                <BlocksEditor
                  value={body}
                  onChange={setBody}
                  readOnly={productionReadOnly}
                />
              ) : (
                <div
                  className="editor-drop-zone mdx-document-editor__source"
                  data-drag-active={
                    !productionReadOnly && imageDrop.dragDepth > 0 ? "true" : undefined
                  }
                  onDragEnter={
                    productionReadOnly ? undefined : imageDrop.onDragEnter
                  }
                  onDragLeave={
                    productionReadOnly ? undefined : imageDrop.onDragLeave
                  }
                >
                  <MarkdownEditor
                    value={body}
                    onChange={setBody}
                    disabled={productionReadOnly}
                    onDrop={productionReadOnly ? undefined : imageDrop.handleDrop}
                    onReady={imageDrop.onEditorReady}
                    minHeight={520}
                  />
                  <span className="mdx-document-editor__hint">
                    Drop an image onto the source editor to upload; a{" "}
                    <code>![alt](/uploads/...)</code> tag is inserted at the cursor.
                  </span>
                  {productionReadOnly ? null : (
                    <AssetLibraryPicker
                      onSelect={(asset) => {
                        const alt = asset.alt || asset.filename || "image";
                        imageDrop.insertAssetImage(asset.url, alt);
                      }}
                    />
                  )}
                </div>
              )}
            </main>

            {propertiesOpen ? (
              <WorkspaceInspector
                className="mdx-document-editor__properties"
                label="Document properties"
              >
                <WorkspaceInspectorHeader
                  className="mdx-document-editor__properties-head"
                  heading={adapter.titleNoun}
                  kicker="Properties"
                  actions={
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => setPropertiesOpen(false)}
                      aria-label="Close properties"
                    >
                      ×
                    </button>
                  }
                />
                <div className="workspace-inspector__body">
                  {adapter.renderProperties({
                    body,
                    form,
                    mode,
                    readOnly: productionReadOnly,
                    setForm,
                    setSlug,
                    slug,
                    slugHint: SLUG_HINTS[adapter.kind] ?? "",
                  })}
                  <WorkspaceInspectorSection heading="Status">
                    <dl className="workspace-inspector__meta">
                      <div>
                        <dt>State</dt>
                        <dd>{statusLabel}</dd>
                      </div>
                      <div>
                        <dt>Source</dt>
                        <dd>
                          <code>{sourcePath}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Version</dt>
                        <dd>
                          <code>{version || "Not saved yet"}</code>
                        </dd>
                      </div>
                    </dl>
                  </WorkspaceInspectorSection>
                </div>
              </WorkspaceInspector>
            ) : null}
          </div>
        </form>
      )}
    </section>
  );
}
