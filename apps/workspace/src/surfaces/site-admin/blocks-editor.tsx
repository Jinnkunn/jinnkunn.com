// Standalone Notion-style block editor canvas. Split from
// MdxDocumentEditor.tsx so surfaces that just need the block-editing
// canvas (Notes) don't drag in the document-level chrome (publish flow,
// frontmatter inspector, draft restore, useSiteAdmin context).
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { AssetLibraryPicker, rememberRecentAsset } from "./AssetLibraryPicker";
import { uploadImageFile } from "./assets-upload";
import { BlockInspector, blockHasInspector } from "./block-inspector";
import {
  BlockActionMenu,
  BlockGutterHandles,
} from "./block-action-menu";
import { BLOCK_TYPE_LABELS } from "./editor-block-labels";
import { EditorDiagnosticsPanel } from "./EditorDiagnosticsPanel";
import { collectEditorDiagnostics } from "./editor-diagnostics";
import {
  blockFromSlashCommand,
  getMatchingSlashCommands,
  rememberRecentSlashCommand,
  replaceBlockType,
  type SlashCommand,
} from "./editor-slash-commands";
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
import {
  createMdxBlock,
  duplicateMdxBlock,
  parseMdxBlocks,
  serializeMdxBlocks,
  type MdxBlock,
  type MdxBlockType,
} from "./mdx-blocks";
import {
  findBlockInTree,
  patchBlockInTree,
  reorderSiblings,
} from "./mdx-block-tree";
import { isBlockVisuallyEmpty, isTextEditableBlock } from "./mdx-block-utils";
import type { NormalizedApiResponse } from "./types";
import { useWorkspaceEditorRuntime } from "../../ui/editor-runtime";

export type RequestFn = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<NormalizedApiResponse>;

const MDX_BLOCK_DRAG_TYPE = "application/x-mdx-block";
const STANDARD_TEXT_DRAG_TYPE = "text/plain";

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Debounce window for `serializeMdxBlocks → onChange`. The block array
// is the editing model; serialization back to a markdown string is the
// expensive part (mdx-blocks.ts is ~1800 lines and walks the tree). We
// keep `setBlocks` synchronous so the canvas stays responsive while
// users type, then collapse a burst of edits into one serialize +
// onChange call. 150 ms keeps perceived latency under "next animation
// frame" budget while reducing serializer pressure by ~10x in long
// documents. The downstream autosave / dirty tracker is already debounced
// itself (600 ms in Notes) so this layer is purely about CPU on the
// keystroke path.
const SERIALIZE_DEBOUNCE_MS = 150;

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
  const {
    assetsEnabled = true,
    assetLibraryEnabled = true,
    request,
    uploadAsset,
    setEditorDiagnostics,
    setMessage,
  } = useWorkspaceEditorRuntime();
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
  const [selectedBlockId, setSelectedBlockId] = useState("");
  const blocksRootRef = useRef<HTMLDivElement | null>(null);
  const lastEmittedBodyRef = useRef(value);
  // Debounced-serialize state. `pendingBlocksRef` always holds the most
  // recent block tree the user produced; the timer drains it on idle.
  const pendingBlocksRef = useRef<MdxBlock[] | null>(null);
  const serializeTimerRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const flushPendingSerialize = useCallback(() => {
    if (serializeTimerRef.current !== null) {
      window.clearTimeout(serializeTimerRef.current);
      serializeTimerRef.current = null;
    }
    const pending = pendingBlocksRef.current;
    if (!pending) return;
    pendingBlocksRef.current = null;
    const nextBody = serializeMdxBlocks(pending);
    lastEmittedBodyRef.current = nextBody;
    onChangeRef.current(nextBody);
  }, []);

  useEffect(() => {
    if (value === lastEmittedBodyRef.current) return;
    // External value update — flush any pending serialize first so the
    // user's in-flight typing isn't silently overwritten by an older
    // server snapshot (paranoia: in current call sites parents never
    // re-feed `value` while we're emitting, but defensive flush keeps
    // the contract clean).
    flushPendingSerialize();
    lastEmittedBodyRef.current = value;
    // External body updates come from draft restore/source mode; the block
    // canvas keeps local IDs so focused blocks do not remount on every keystroke.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBlocks(parseMdxBlocks(value));
  }, [flushPendingSerialize, value]);

  // Flush on unmount so callers don't lose the trailing edits when the
  // surface tears down (tab switch, lazy-chunk eviction, …).
  useEffect(() => {
    return () => {
      if (pendingBlocksRef.current) flushPendingSerialize();
    };
  }, [flushPendingSerialize]);

  const handleBlocksChange = useCallback(
    (nextBlocks: MdxBlock[]) => {
      const normalized = nextBlocks.length > 0 ? nextBlocks : [createMdxBlock("paragraph")];
      setBlocks(normalized);
      pendingBlocksRef.current = normalized;
      if (serializeTimerRef.current !== null) {
        window.clearTimeout(serializeTimerRef.current);
      }
      serializeTimerRef.current = window.setTimeout(() => {
        serializeTimerRef.current = null;
        flushPendingSerialize();
      }, SERIALIZE_DEBOUNCE_MS);
    },
    [flushPendingSerialize],
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

  const selectedBlock = useMemo(
    () => (selectedBlockId ? findBlockInTree(blocks, selectedBlockId) : null),
    [blocks, selectedBlockId],
  );
  const diagnostics = useMemo(() => collectEditorDiagnostics(blocks), [blocks]);
  useEffect(() => {
    setEditorDiagnostics(diagnostics);
    return () => setEditorDiagnostics([]);
  }, [diagnostics, setEditorDiagnostics]);
  const inspectorBlock = selectedBlock && blockHasInspector(selectedBlock)
    ? selectedBlock
    : null;

  const patchSelectedBlock = useCallback(
    (patcher: (block: MdxBlock) => MdxBlock) => {
      if (!selectedBlockId || readOnly) return;
      const result = patchBlockInTree(blocks, selectedBlockId, patcher);
      if (result.changed) handleBlocksChange(result.blocks);
    },
    [blocks, handleBlocksChange, readOnly, selectedBlockId],
  );

  const uploadImageIntoSelectedBlock = useCallback(
    async (file: File | null) => {
      if (!file || readOnly || !selectedBlockId) return;
      if (!assetsEnabled) {
        const error = "Image upload is not available in this editor yet. Use an image URL instead.";
        setError(error);
        setMessage("error", error);
        return;
      }
      setUploading(true);
      const result = await uploadImageFile({ file, uploadAsset, request });
      setUploading(false);
      if (!result.ok) {
        setError(result.error);
        setMessage("error", `Upload failed: ${result.error}`);
        return;
      }
      rememberRecentAsset(result.asset, result.filename);
      const alt = file.name.replace(/\.[^.]+$/, "") || result.filename;
      const patch = patchBlockInTree(blocks, selectedBlockId, (block) => ({
        ...block,
        alt: block.alt || alt,
        url: result.asset.url,
      }));
      if (patch.changed) handleBlocksChange(patch.blocks);
      setMessage("success", `Uploaded ${result.filename}.`);
    },
    [
      assetsEnabled,
      blocks,
      handleBlocksChange,
      readOnly,
      request,
      selectedBlockId,
      setError,
      setMessage,
      uploadAsset,
    ],
  );

  const uploadDroppedImages = useCallback(
    async (files: File[]) => {
      if (readOnly) return;
      if (!assetsEnabled) {
        const error = "Image upload is not available in this editor yet. Use an image URL instead.";
        setError(error);
        setMessage("error", error);
        return;
      }
      const nextBlocks = blocks.slice();
      for (const file of files) {
        setUploading(true);
        const result = await uploadImageFile({ file, uploadAsset, request });
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
    [
      assetsEnabled,
      blocks,
      handleBlocksChange,
      readOnly,
      request,
      setError,
      setMessage,
      uploadAsset,
    ],
  );

  const selectDiagnosticBlock = useCallback((blockId: string) => {
    setSelectedBlockId(blockId);
    window.requestAnimationFrame(() => {
      const root = blocksRootRef.current;
      const node = root?.querySelector<HTMLElement>(
        `.mdx-document-block[data-block-id="${cssEscape(blockId)}"]`,
      );
      node?.scrollIntoView({ block: "center", behavior: "smooth" });
      const focusTarget = node?.querySelector<HTMLElement>(
        'textarea, input, [contenteditable="true"], button',
      );
      focusTarget?.focus({ preventScroll: true });
    });
  }, []);

  return (
    <div
      className="mdx-block-editor-shell"
      data-block-inspector-open={inspectorBlock ? "true" : undefined}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !selectedBlockId) return;
        event.stopPropagation();
        setSelectedBlockId("");
      }}
    >
      <div
        className="mdx-document-blocks"
        ref={blocksRootRef}
        data-drag-active={dragDepth > 0 ? "true" : undefined}
        data-read-only={readOnly ? "true" : undefined}
        data-uploading={uploading ? "true" : undefined}
        style={minHeight ? { minHeight } : undefined}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedBlockId("");
        }}
        onDragEnter={(event: DragEvent<HTMLDivElement>) => {
          if (readOnly) return;
          if (Array.from(event.dataTransfer.types).includes(MDX_BLOCK_DRAG_TYPE))
            return;
          event.preventDefault();
          setDragDepth((depth) => depth + 1);
        }}
        onDragLeave={() => {
          if (readOnly) return;
          setDragDepth((depth) => Math.max(0, depth - 1));
        }}
        onDrop={(event) => {
          if (readOnly) return;
          if (Array.from(event.dataTransfer.types).includes(MDX_BLOCK_DRAG_TYPE))
            return;
          event.preventDefault();
          setDragDepth(0);
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (files.length > 0) void uploadDroppedImages(files);
        }}
      >
        <EditorDiagnosticsPanel
          diagnostics={diagnostics}
          onSelectBlock={selectDiagnosticBlock}
        />

        <EditableBlocksList
          blocks={blocks}
          depth={0}
          onBlocksChange={handleBlocksChange}
          onSelectBlock={setSelectedBlockId}
          readOnly={readOnly}
          request={request}
          selectedBlockId={selectedBlockId}
          setError={setError}
          setMessage={setMessage}
        />

        {readOnly || !assetsEnabled || !assetLibraryEnabled ? null : (
          <AssetLibraryPicker
            onSelect={(asset) =>
              appendImageBlock(asset.url, asset.alt || asset.filename || "image")
            }
          />
        )}
      </div>

      {inspectorBlock ? (
        <BlockInspector
          block={inspectorBlock}
          onClose={() => setSelectedBlockId("")}
          onPatch={patchSelectedBlock}
          onUploadImage={(file) => void uploadImageIntoSelectedBlock(file)}
          readOnly={readOnly}
          request={request}
          setError={setError}
          setMessage={setMessage}
          uploading={uploading}
        />
      ) : null}
    </div>
  );
}

interface EditableBlocksListProps {
  blocks: MdxBlock[];
  depth: number;
  onBlocksChange: (next: MdxBlock[]) => void;
  onSelectBlock?: (id: string) => void;
  readOnly?: boolean;
  request: RequestFn;
  selectedBlockId?: string;
  setError: (error: string) => void;
  setMessage: (kind: "error" | "success", text: string) => void;
}

function EditableBlocksList({
  blocks,
  depth,
  onBlocksChange,
  onSelectBlock,
  readOnly = false,
  request,
  selectedBlockId,
  setError,
  setMessage,
}: EditableBlocksListProps) {
  // Pull the surface-level whitelist from the runtime so slash commands
  // stay consistent across nested lists (toggles, columns, …) without
  // prop-drilling through every recursive renderer.
  const { enabledBlockIds } = useWorkspaceEditorRuntime();
  const [draggingBlockId, setDraggingBlockId] = useState("");
  // Drop indicator state — single piece so the visual stays consistent
  // (we never want to highlight one block while pointing the indicator
  // line at another). Position is computed from the pointer's vertical
  // offset against the target's midpoint so dragging up vs. down both
  // commit the user's visual intent rather than the asymmetric "always
  // land at target index" splice behavior.
  const [dragOver, setDragOver] = useState<{
    id: string;
    position: "above" | "below";
  } | null>(null);
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
  // Latest `blocks` snapshot in a ref so the action callbacks below
  // don't have to depend on `blocks`. Without this, every keystroke
  // re-creates patchBlock / replaceBlock / insertParagraphAfter / …
  // which in turn re-renders every BlockRow because their useCallback'd
  // closures rotate. Reading from a ref keeps the parent callbacks
  // referentially stable so memo(BlockRow) actually skips siblings.
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const draggingBlockIdRef = useRef("");
  draggingBlockIdRef.current = draggingBlockId;

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
    // Intentionally only depend on `focusRequest`. The previous version
    // also depended on `blocks` so the effect ran on every keystroke,
    // even when no focus had been requested — that masked a no-op as a
    // 100-block-list `getBoundingClientRect` parade on every key.
  }, [focusRequest]);

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

  // All action callbacks below read from `blocksRef.current` instead of
  // closure-capturing `blocks`. That keeps each useCallback's dep list
  // limited to genuinely stable refs (commitBlocks, requestBlockFocus,
  // depth) so the callbacks themselves are stable across renders. Combined
  // with memo(BlockRow), this stops every sibling from re-rendering when
  // the user types into a single block.
  const patchBlock = useCallback(
    (id: string, patcher: (block: MdxBlock) => MdxBlock) => {
      const current = blocksRef.current;
      commitBlocks(current.map((block) => (block.id === id ? patcher(block) : block)));
    },
    [commitBlocks],
  );

  const replaceBlock = useCallback(
    (id: string, nextBlock: MdxBlock) => {
      const current = blocksRef.current;
      commitBlocks(current.map((block) => (block.id === id ? nextBlock : block)));
      requestBlockFocus(nextBlock.id);
    },
    [commitBlocks, requestBlockFocus],
  );

  const insertParagraphAfter = useCallback(
    (index: number) => {
      const block = createMdxBlock("paragraph");
      const next = blocksRef.current.slice();
      next.splice(index + 1, 0, block);
      commitBlocks(next);
      requestBlockFocus(block.id);
    },
    [commitBlocks, requestBlockFocus],
  );

  const insertBlocksAfter = useCallback(
    (index: number, insertedBlocks: MdxBlock[]) => {
      const normalized = insertedBlocks.length > 0
        ? insertedBlocks
        : [createMdxBlock("paragraph")];
      const next = blocksRef.current.slice();
      next.splice(index + 1, 0, ...normalized);
      commitBlocks(next);
      requestBlockFocus(normalized[0]?.id ?? "");
    },
    [commitBlocks, requestBlockFocus],
  );

  const replaceBlockWithBlocks = useCallback(
    (index: number, insertedBlocks: MdxBlock[]) => {
      const normalized = insertedBlocks.length > 0
        ? insertedBlocks
        : [createMdxBlock("paragraph")];
      const next = blocksRef.current.slice();
      next.splice(index, 1, ...normalized);
      commitBlocks(next);
      requestBlockFocus(normalized[0]?.id ?? "");
    },
    [commitBlocks, requestBlockFocus],
  );

  const insertSlashTrigger = useCallback(
    (afterIndex: number) => {
      const block: MdxBlock = { ...createMdxBlock("paragraph"), text: "/" };
      const next = blocksRef.current.slice();
      next.splice(afterIndex + 1, 0, block);
      commitBlocks(next);
      requestBlockFocus(block.id);
    },
    [commitBlocks, requestBlockFocus],
  );

  const duplicateBlockById = useCallback(
    (id: string) => {
      const current = blocksRef.current;
      const idx = current.findIndex((block) => block.id === id);
      if (idx < 0) return;
      const copy = duplicateMdxBlock(current[idx]);
      const next = current.slice();
      next.splice(idx + 1, 0, copy);
      commitBlocks(next);
      requestBlockFocus(copy.id);
    },
    [commitBlocks, requestBlockFocus],
  );

  const changeBlockType = useCallback(
    (
      id: string,
      type: MdxBlockType,
      level?: 1 | 2 | 3,
      listStyle?: "bulleted" | "numbered",
    ) => {
      const current = blocksRef.current;
      commitBlocks(
        current.map((block) => {
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
    [commitBlocks, requestBlockFocus],
  );

  const copyBlockLink = useCallback((id: string) => {
    const link = `#block-${id}`;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(link);
    }
  }, []);

  // `request` / `setError` / `setMessage` are passed as props from a
  // stable owner (workspace runtime), so it's safe to keep them in the
  // dep list without churning the callback.
  const uploadImageIntoBlockRef = useRef(false);
  const uploadImageIntoBlock = useCallback(
    async (blockId: string, file: File | null) => {
      if (!file || uploadImageIntoBlockRef.current) return;
      uploadImageIntoBlockRef.current = true;
      setUploadingId(blockId);
      const result = await uploadImageFile({ file, request });
      uploadImageIntoBlockRef.current = false;
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
    [patchBlock, request, setError, setMessage],
  );

  const moveBlock = useCallback(
    (index: number, direction: -1 | 1) => {
      const current = blocksRef.current;
      const target = index + direction;
      if (target < 0 || target >= current.length) return;
      const next = current.slice();
      [next[index], next[target]] = [next[target], next[index]];
      commitBlocks(next);
    },
    [commitBlocks],
  );

  const moveBlockTo = useCallback(
    (draggedId: string, targetId: string, position: "above" | "below") => {
      const current = blocksRef.current;
      const next = reorderSiblings(current, draggedId, targetId, position);
      if (next === current) return;
      commitBlocks(next);
    },
    [commitBlocks],
  );

  const removeBlock = useCallback(
    (id: string) => {
      const next = blocksRef.current.filter((block) => block.id !== id);
      if (depth === 0 && next.length === 0) {
        commitBlocks([createMdxBlock("paragraph")]);
        return;
      }
      commitBlocks(next);
    },
    [commitBlocks, depth],
  );

  const removeEmptyBlock = useCallback(
    (id: string, index: number) => {
      const current = blocksRef.current;
      if (depth === 0 && current.length <= 1) return;
      const next = current.filter((block) => block.id !== id);
      const focusIndex = Math.max(0, Math.min(index - 1, next.length - 1));
      commitBlocks(next);
      requestBlockFocus(next[focusIndex]?.id ?? "");
    },
    [commitBlocks, depth, requestBlockFocus],
  );

  const clearFocusedBlockIfLeaving = useCallback(
    (blockId: string, event: FocusEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
      setFocusedBlockId((current) => (current === blockId ? "" : current));
    },
    [],
  );

  // Stable drag-handler bundle. The handlers read draggingBlockIdRef so
  // they don't have to be recreated when draggingBlockId changes; that
  // way each BlockRow gets the same handler reference across its
  // lifetime and memo() can short-circuit cleanly.
  const handleBlockDragStart = useCallback(
    (blockId: string, event: DragEvent<HTMLButtonElement>) => {
      setDraggingBlockId(blockId);
      event.dataTransfer.setData(MDX_BLOCK_DRAG_TYPE, blockId);
      event.dataTransfer.setData(STANDARD_TEXT_DRAG_TYPE, blockId);
      event.dataTransfer.effectAllowed = "move";
      const blockEl =
        event.currentTarget.closest<HTMLElement>(".mdx-document-block");
      if (blockEl) {
        const rect = blockEl.getBoundingClientRect();
        event.dataTransfer.setDragImage(
          blockEl,
          Math.max(0, event.clientX - rect.left),
          Math.max(0, event.clientY - rect.top),
        );
      }
    },
    [],
  );

  const handleBlockDragEnd = useCallback(() => {
    setDraggingBlockId("");
    setDragOver(null);
  }, []);

  const handleBlockDragOver = useCallback(
    (blockId: string, event: DragEvent<HTMLDivElement>) => {
      const types = Array.from(event.dataTransfer.types);
      const draggingId = draggingBlockIdRef.current;
      const hasBlockDrag =
        types.includes(MDX_BLOCK_DRAG_TYPE) ||
        (draggingId !== "" && types.includes(STANDARD_TEXT_DRAG_TYPE));
      if (!hasBlockDrag) return;
      event.preventDefault();
      event.stopPropagation();
      if (draggingId === blockId) {
        setDragOver((current) =>
          current && current.id === blockId ? null : current,
        );
        return;
      }
      event.dataTransfer.dropEffect = "move";
      const rect = event.currentTarget.getBoundingClientRect();
      const position: "above" | "below" =
        event.clientY < rect.top + rect.height / 2 ? "above" : "below";
      setDragOver((current) =>
        current && current.id === blockId && current.position === position
          ? current
          : { id: blockId, position },
      );
    },
    [],
  );

  const handleBlockDragLeave = useCallback(
    (blockId: string, event: DragEvent<HTMLDivElement>) => {
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) return;
      setDragOver((current) =>
        current && current.id === blockId ? null : current,
      );
    },
    [],
  );

  const handleBlockDrop = useCallback(
    (blockId: string, event: DragEvent<HTMLDivElement>) => {
      const draggedId =
        event.dataTransfer.getData(MDX_BLOCK_DRAG_TYPE) ||
        draggingBlockIdRef.current ||
        event.dataTransfer.getData(STANDARD_TEXT_DRAG_TYPE);
      if (!draggedId) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      const position: "above" | "below" =
        event.clientY < rect.top + rect.height / 2 ? "above" : "below";
      setDragOver(null);
      moveBlockTo(draggedId, blockId, position);
    },
    [moveBlockTo],
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
        <BlockRow
          key={block.id}
          block={block}
          depth={depth}
          index={index}
          isSelected={selectedBlockId === block.id}
          isFocused={focusedBlockId === block.id}
          isDragging={draggingBlockId === block.id}
          dragOverPosition={dragOver?.id === block.id ? dragOver.position : null}
          isActionMenuOpen={actionMenu?.blockId === block.id}
          isUploading={uploadingId === block.id}
          enableDrag={enableDrag}
          readOnly={readOnly}
          enabledBlockIds={enabledBlockIds}
          selectedBlockId={selectedBlockId}
          request={request}
          setError={setError}
          setMessage={setMessage}
          onSelectBlock={onSelectBlock}
          setFocusedBlockId={setFocusedBlockId}
          setActionMenu={setActionMenu}
          clearFocusedBlockIfLeaving={clearFocusedBlockIfLeaving}
          onBlockDragStart={handleBlockDragStart}
          onBlockDragEnd={handleBlockDragEnd}
          onBlockDragOver={handleBlockDragOver}
          onBlockDragLeave={handleBlockDragLeave}
          onBlockDrop={handleBlockDrop}
          patchBlock={patchBlock}
          replaceBlock={replaceBlock}
          insertParagraphAfter={insertParagraphAfter}
          insertBlocksAfter={insertBlocksAfter}
          insertSlashTrigger={insertSlashTrigger}
          replaceBlockWithBlocks={replaceBlockWithBlocks}
          removeEmptyBlock={removeEmptyBlock}
          duplicateBlockById={duplicateBlockById}
          changeBlockType={changeBlockType}
          moveBlock={moveBlock}
          uploadImageIntoBlock={uploadImageIntoBlock}
          registerBlockInput={registerBlockInput}
        />
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

// Per-block render boundary. Memoized so unrelated siblings don't
// re-render when one block updates: typing into block X only invalidates
// X's `block` reference (commitBlocks does a shallow map preserving
// other refs) and at most flips one boolean (e.g. selectedBlockId moves
// from Y to X). All other props are parent-stable. memo() short-circuits
// every other row, which is the difference between Notion-feel and a
// list-wide re-render on every keystroke.
interface BlockRowProps {
  block: MdxBlock;
  depth: number;
  index: number;
  isSelected: boolean;
  isFocused: boolean;
  isDragging: boolean;
  dragOverPosition: "above" | "below" | null;
  isActionMenuOpen: boolean;
  isUploading: boolean;
  enableDrag: boolean;
  readOnly: boolean;
  enabledBlockIds: ReadonlySet<string> | undefined;
  selectedBlockId?: string;
  request: RequestFn;
  setError: (error: string) => void;
  setMessage: (kind: "error" | "success", text: string) => void;
  onSelectBlock?: (id: string) => void;
  setFocusedBlockId: (id: string) => void;
  setActionMenu: (
    next: { anchor: HTMLElement; blockId: string } | null,
  ) => void;
  clearFocusedBlockIfLeaving: (
    blockId: string,
    event: FocusEvent<HTMLDivElement>,
  ) => void;
  onBlockDragStart: (blockId: string, event: DragEvent<HTMLButtonElement>) => void;
  onBlockDragEnd: () => void;
  onBlockDragOver: (blockId: string, event: DragEvent<HTMLDivElement>) => void;
  onBlockDragLeave: (blockId: string, event: DragEvent<HTMLDivElement>) => void;
  onBlockDrop: (blockId: string, event: DragEvent<HTMLDivElement>) => void;
  patchBlock: (id: string, patcher: (block: MdxBlock) => MdxBlock) => void;
  replaceBlock: (id: string, nextBlock: MdxBlock) => void;
  insertParagraphAfter: (index: number) => void;
  insertBlocksAfter: (index: number, insertedBlocks: MdxBlock[]) => void;
  insertSlashTrigger: (afterIndex: number) => void;
  replaceBlockWithBlocks: (index: number, insertedBlocks: MdxBlock[]) => void;
  removeEmptyBlock: (id: string, index: number) => void;
  duplicateBlockById: (id: string) => void;
  changeBlockType: (
    id: string,
    type: MdxBlockType,
    level?: 1 | 2 | 3,
    listStyle?: "bulleted" | "numbered",
  ) => void;
  moveBlock: (index: number, direction: -1 | 1) => void;
  uploadImageIntoBlock: (blockId: string, file: File | null) => Promise<void>;
  registerBlockInput: (
    blockId: string,
    node: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null,
  ) => void;
}

const BlockRow = memo(function BlockRow({
  block,
  depth,
  index,
  isSelected,
  isFocused,
  isDragging,
  dragOverPosition,
  isActionMenuOpen,
  isUploading,
  enableDrag,
  readOnly,
  enabledBlockIds,
  selectedBlockId,
  request,
  setError,
  setMessage,
  onSelectBlock,
  setFocusedBlockId,
  setActionMenu,
  clearFocusedBlockIfLeaving,
  onBlockDragStart,
  onBlockDragEnd,
  onBlockDragOver,
  onBlockDragLeave,
  onBlockDrop,
  patchBlock,
  replaceBlock,
  insertParagraphAfter,
  insertBlocksAfter,
  insertSlashTrigger,
  replaceBlockWithBlocks,
  removeEmptyBlock,
  duplicateBlockById,
  changeBlockType,
  moveBlock,
  uploadImageIntoBlock,
  registerBlockInput,
}: BlockRowProps) {
  const blockId = block.id;
  const controlsActive = isActionMenuOpen || isDragging || isFocused;
  // Per-row closures bind blockId/index to the parent's stable handlers.
  // These are recreated on every BlockRow render — but BlockRow only
  // renders when one of its own props actually changes, so the churn is
  // bounded to the single row being edited rather than spread across
  // every sibling.
  const onPatch = useCallback(
    (patcher: (b: MdxBlock) => MdxBlock) => patchBlock(blockId, patcher),
    [blockId, patchBlock],
  );
  const onSlashCommand = useCallback(
    (value: string) => {
      const next = blockFromSlashCommand(value, enabledBlockIds);
      if (!next) return false;
      if (depth > 0 && next.type === "toggle") return false;
      replaceBlock(blockId, next);
      return true;
    },
    [blockId, depth, enabledBlockIds, replaceBlock],
  );
  const onChooseSlashCommand = useCallback(
    (command: SlashCommand) => {
      rememberRecentSlashCommand(command.id);
      replaceBlock(blockId, command.makeBlock());
    },
    [blockId, replaceBlock],
  );
  const onFocusInput = useCallback(
    (node: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null) =>
      registerBlockInput(blockId, node),
    [blockId, registerBlockInput],
  );
  const onInsertParagraphAfterCb = useCallback(
    () => insertParagraphAfter(index),
    [index, insertParagraphAfter],
  );
  const onInsertBlocksAfterCb = useCallback(
    (newBlocks: MdxBlock[]) => insertBlocksAfter(index, newBlocks),
    [index, insertBlocksAfter],
  );
  const onRemoveEmpty = useCallback(
    () => removeEmptyBlock(blockId, index),
    [blockId, index, removeEmptyBlock],
  );
  const onReplaceWithBlocks = useCallback(
    (newBlocks: MdxBlock[]) => replaceBlockWithBlocks(index, newBlocks),
    [index, replaceBlockWithBlocks],
  );
  const onUploadImage = useCallback(
    (file: File | null) => void uploadImageIntoBlock(blockId, file),
    [blockId, uploadImageIntoBlock],
  );
  const onMoveUp = useCallback(() => moveBlock(index, -1), [index, moveBlock]);
  const onMoveDown = useCallback(() => moveBlock(index, 1), [index, moveBlock]);
  const onDuplicate = useCallback(
    () => duplicateBlockById(blockId),
    [blockId, duplicateBlockById],
  );
  const onTurnInto = useCallback(
    (type: MdxBlockType, level?: 1 | 2 | 3) =>
      changeBlockType(blockId, type, level),
    [blockId, changeBlockType],
  );
  const onAdd = useCallback(
    () => insertSlashTrigger(index),
    [index, insertSlashTrigger],
  );
  const onGutterDragStart = useCallback(
    (event: DragEvent<HTMLButtonElement>) => {
      if (!enableDrag) {
        event.preventDefault();
        return;
      }
      onBlockDragStart(blockId, event);
    },
    [blockId, enableDrag, onBlockDragStart],
  );
  const onMenu = useCallback(
    (anchor: HTMLElement) => setActionMenu({ anchor, blockId }),
    [blockId, setActionMenu],
  );

  const handleMouseDownCapture = useCallback(() => {
    onSelectBlock?.(blockId);
  }, [blockId, onSelectBlock]);
  const handleFocusCapture = useCallback(() => {
    setFocusedBlockId(blockId);
    onSelectBlock?.(blockId);
  }, [blockId, onSelectBlock, setFocusedBlockId]);
  const handleBlurCapture = useCallback(
    (event: FocusEvent<HTMLDivElement>) =>
      clearFocusedBlockIfLeaving(blockId, event),
    [blockId, clearFocusedBlockIfLeaving],
  );
  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (readOnly) return;
      event.preventDefault();
      event.stopPropagation();
      setActionMenu({ anchor: event.currentTarget, blockId });
    },
    [blockId, readOnly, setActionMenu],
  );
  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => onBlockDragOver(blockId, event),
    [blockId, onBlockDragOver],
  );
  const handleDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>) => onBlockDragLeave(blockId, event),
    [blockId, onBlockDragLeave],
  );
  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => onBlockDrop(blockId, event),
    [blockId, onBlockDrop],
  );

  return (
    <div
      className="mdx-document-block"
      data-depth={depth}
      data-block-id={blockId}
      data-kind={block.type}
      data-empty={isBlockVisuallyEmpty(block) ? "true" : undefined}
      data-color={block.color && block.color !== "default" ? block.color : undefined}
      data-drag-over={dragOverPosition ? "true" : undefined}
      data-drop-position={dragOverPosition ?? undefined}
      data-dragging={isDragging ? "true" : undefined}
      data-selected={isSelected ? "true" : undefined}
      data-controls-open={controlsActive ? "true" : undefined}
      onMouseDownCapture={handleMouseDownCapture}
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
      onContextMenu={handleContextMenu}
      onDragOver={enableDrag ? handleDragOver : undefined}
      onDragLeave={enableDrag ? handleDragLeave : undefined}
      onDrop={enableDrag ? handleDrop : undefined}
    >
      {readOnly ? null : (
        <BlockGutterHandles
          controlsActive={controlsActive}
          isDragging={isDragging}
          onAdd={onAdd}
          onDragStart={onGutterDragStart}
          onDragEnd={onBlockDragEnd}
          onMenu={onMenu}
        />
      )}
      <EditableBlock
        block={block}
        depth={depth}
        onSelectBlock={onSelectBlock}
        request={request}
        selectedBlockId={selectedBlockId}
        setError={setError}
        setMessage={setMessage}
        uploading={isUploading}
        onPatch={onPatch}
        onSlashCommand={onSlashCommand}
        onChooseSlashCommand={onChooseSlashCommand}
        onFocusInput={onFocusInput}
        onInsertParagraphAfter={onInsertParagraphAfterCb}
        onInsertBlocksAfter={onInsertBlocksAfterCb}
        onRemoveEmpty={onRemoveEmpty}
        onReplaceWithBlocks={onReplaceWithBlocks}
        onUploadImage={onUploadImage}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onDuplicate={onDuplicate}
        onTurnInto={onTurnInto}
        readOnly={readOnly}
      />
    </div>
  );
});

function EditableBlock({
  block,
  depth,
  onChooseSlashCommand,
  onDuplicate,
  onFocusInput,
  onInsertParagraphAfter,
  onInsertBlocksAfter,
  onMoveDown,
  onMoveUp,
  onPatch,
  onRemoveEmpty,
  onReplaceWithBlocks,
  onSlashCommand,
  onSelectBlock,
  onTurnInto,
  onUploadImage,
  readOnly = false,
  request,
  selectedBlockId,
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
  onInsertBlocksAfter: (blocks: MdxBlock[]) => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
  onPatch: (patcher: (block: MdxBlock) => MdxBlock) => void;
  onRemoveEmpty: () => void;
  onReplaceWithBlocks: (blocks: MdxBlock[]) => void;
  onSlashCommand: (value: string) => boolean;
  onSelectBlock?: (id: string) => void;
  onTurnInto: (type: MdxBlockType, level?: 1 | 2 | 3) => void;
  onUploadImage: (file: File | null) => void;
  readOnly?: boolean;
  request: RequestFn;
  selectedBlockId?: string;
  setError: (error: string) => void;
  setMessage: (kind: "error" | "success", text: string) => void;
  uploading: boolean;
}) {
  // Pull the surface whitelist so the inline slash menu (rendered in
  // RichTextEditableBlock) stays consistent with the toggle-keystroke
  // path above. Notes overrides this to a curated list; site-admin
  // leaves it undefined and gets every command.
  const { enabledBlockIds } = useWorkspaceEditorRuntime();
  // RichTextEditableBlock renders the slash menu internally when this list
  // is non-empty. Computed only for paragraph; heading / quote / callout /
  // list intentionally don't trigger the slash matcher even if their text
  // happens to start with "/". useMemo so we don't redo the whitelist
  // filtering on every keystroke when the block's text actually hasn't
  // changed (e.g. parent re-rendered for a sibling reason).
  const slashCommands = useMemo(
    () =>
      block.type === "paragraph"
        ? getMatchingSlashCommands(block.text, enabledBlockIds)
        : [],
    [block.type, block.text, enabledBlockIds],
  );
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
        onInsertBlocksAfter={onInsertBlocksAfter}
        onMoveDown={onMoveDown}
        onMoveUp={onMoveUp}
        onPatch={onPatch}
        readOnly={readOnly}
        setMessage={setMessage}
        onRemoveEmpty={onRemoveEmpty}
        onReplaceWithBlocks={onReplaceWithBlocks}
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
    if (!meta && event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      onMoveUp();
      return;
    }
    if (!meta && event.altKey && event.key === "ArrowDown") {
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
      <figure className="mdx-document-image-block">
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
        {block.caption ? (
          <figcaption className="mdx-document-image-block__caption">
            {block.caption}
          </figcaption>
        ) : null}
      </figure>
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
            onSelectBlock={onSelectBlock}
            readOnly={readOnly}
            request={request}
            selectedBlockId={selectedBlockId}
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
            onSelectBlock={onSelectBlock}
            readOnly={readOnly}
            request={request}
            selectedBlockId={selectedBlockId}
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
            onSelectBlock={onSelectBlock}
            readOnly={readOnly}
            request={request}
            selectedBlockId={selectedBlockId}
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
            onSelectBlock={onSelectBlock}
            readOnly={readOnly}
            request={request}
            selectedBlockId={selectedBlockId}
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
            onSelectBlock={onSelectBlock}
            readOnly={readOnly}
            request={request}
            selectedBlockId={selectedBlockId}
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
      {block.type === "raw" ? (
        <div className="mdx-document-raw-block__head">
          <strong>Raw MDX fallback</strong>
          <span>Use when no visual block exists yet.</span>
        </div>
      ) : null}
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
