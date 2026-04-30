import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import {
  notesArchive,
  notesCreate,
  notesGet,
  notesList,
  notesListArchived,
  notesMove,
  notesSaveAsset,
  notesSearch,
  notesUnarchive,
  notesUpdate,
  type NoteDetail,
  type NoteRow,
  type NoteSearchResult,
} from "../../modules/notes/api";
import { useSurfaceNav } from "../../shell/surface-nav-context";
import {
  WorkspaceCommandBar,
  WorkspaceCommandButton,
  WorkspaceCommandGroup,
  WorkspaceSurfaceFrame,
} from "../../ui/primitives";
import {
  WorkspaceEditorRuntimeProvider,
  type WorkspaceEditorRuntime,
} from "../../ui/editor-runtime";
import { BlocksEditor } from "../site-admin/LazyBlocksEditor";
import { NoteIconPicker } from "./IconPicker";
import {
  NOTES_ARCHIVE_NAV_ITEM,
  NOTES_NAV_GROUP_ID,
} from "./nav";
import {
  applyNotesMutation,
  buildNoteBreadcrumb,
  buildNoteTree,
  getRecentNotes,
  getSiblingNotes,
  noteIdFromNavItem,
  noteNavId,
  noteTreeToNavItems,
  NOTES_ARCHIVE_NAV_ID,
  NOTES_ROOT_NAV_ID,
  parentIdFromNavItem,
} from "./tree";
import type { NotesSaveState } from "./types";

const SAVE_DEBOUNCE_MS = 600;
const DEFAULT_NOTE_TITLE = "Untitled";
const IS_MAC =
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
const SHORTCUT_META = IS_MAC ? "⌘" : "Ctrl";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

type PendingNotePayload = {
  noteId: string;
  bodyMdx: string;
  icon: string | null;
  title: string;
};

function normalizeTitle(value: string): string {
  const trimmed = value.trim();
  return trimmed || DEFAULT_NOTE_TITLE;
}

function normalizeIcon(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function noteSaveKey(input: { bodyMdx: string; icon: string | null; title: string }): string {
  return JSON.stringify({
    bodyMdx: input.bodyMdx,
    icon: input.icon ?? "",
    title: normalizeTitle(input.title),
  });
}

function mergeNoteRow(rows: readonly NoteRow[], detail: NoteDetail): NoteRow[] {
  return rows.map((row) =>
    row.id === detail.id
      ? {
          archivedAt: detail.archivedAt,
          createdAt: detail.createdAt,
          icon: detail.icon,
          id: detail.id,
          parentId: detail.parentId,
          sortOrder: detail.sortOrder,
          title: detail.title,
          updatedAt: detail.updatedAt,
        }
      : row,
  );
}

function formatSaveState(state: NotesSaveState): string {
  if (state === "dirty") return "Unsaved";
  if (state === "saving") return "Saving...";
  if (state === "saved") return "Saved";
  if (state === "error") return "Save failed";
  return "Idle";
}

// FTS5 snippet() wraps matches with these private-use Unicode chars
// (chosen to survive JSON transport and not collide with note content).
// Render them as <mark> spans without an HTML-injection path.
const SNIPPET_OPEN = "\u{e000}";
const SNIPPET_CLOSE = "\u{e001}";

// Slash-command whitelist for the Notes surface. Trims off site-admin
// business blocks (publications-block, teaching-links, news-entry,
// hero-block, link-list-block, featured-pages-block, …) — they only
// make sense inside the public website's content tree, not in personal
// notes. The ids match the SlashCommand `id` field in editor-slash-commands.ts.
const NOTES_ENABLED_BLOCK_IDS: ReadonlySet<string> = new Set([
  "text",
  "heading1",
  "heading2",
  "heading3",
  "quote",
  "list",
  "todo",
  "toggle",
  "callout",
  "code",
  "divider",
  "image",
  "video",
  "file",
  "bookmark",
  "embed",
  "table",
  "columns",
  "column",
]);

function renderSnippet(raw: string): ReactNode[] {
  if (!raw.includes(SNIPPET_OPEN)) return [raw];
  const out: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  while (cursor < raw.length) {
    const open = raw.indexOf(SNIPPET_OPEN, cursor);
    if (open === -1) {
      out.push(raw.slice(cursor));
      break;
    }
    if (open > cursor) out.push(raw.slice(cursor, open));
    const close = raw.indexOf(SNIPPET_CLOSE, open + 1);
    if (close === -1) {
      out.push(raw.slice(open + 1));
      break;
    }
    out.push(<mark key={key++}>{raw.slice(open + 1, close)}</mark>);
    cursor = close + 1;
  }
  return out;
}

export function NotesSurface() {
  const {
    activeNavItemId,
    setActiveNavItemId,
    setNavGroupItems,
    setMoveNavItemHandler,
    setRenameNavItemHandler,
    setRenameValidator,
    setReorderNavItemHandler,
  } = useSurfaceNav();
  const [rows, setRows] = useState<NoteRow[]>([]);
  const [selectedNote, setSelectedNote] = useState<NoteDetail | null>(null);
  const [title, setTitle] = useState(DEFAULT_NOTE_TITLE);
  const [body, setBody] = useState("");
  const [icon, setIcon] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingNote, setLoadingNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<NotesSaveState>("idle");
  const [message, setMessage] = useState<{ kind: string; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NoteSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [archivedRows, setArchivedRows] = useState<NoteRow[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const [, setDiagnostics] = useState<unknown[]>([]);
  const lastSavedKeyRef = useRef("");
  const pendingSaveRef = useRef<PendingNotePayload | null>(null);
  const savingRef = useRef(false);
  const selectedNoteRef = useRef<NoteDetail | null>(null);
  const createInFlightRef = useRef(false);
  const createNoteRef = useRef<(parentId: string | null) => void>(() => {});
  const archiveSelectedRef = useRef<() => void>(() => {});
  const selectedNoteId = noteIdFromNavItem(activeNavItemId);

  useEffect(() => {
    selectedNoteRef.current = selectedNote;
  }, [selectedNote]);

  const tree = useMemo(() => buildNoteTree(rows), [rows]);
  const navItems = useMemo(() => noteTreeToNavItems(tree), [tree]);
  const recentNotes = useMemo(() => getRecentNotes(rows), [rows]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const next = await notesList();
      setRows(next);
      setMessage(null);
      return next;
    } catch (error) {
      setMessage({ kind: "error", text: `Failed to load notes: ${String(error)}` });
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    setNavGroupItems(NOTES_NAV_GROUP_ID, [...navItems, NOTES_ARCHIVE_NAV_ITEM]);
    return () => setNavGroupItems(NOTES_NAV_GROUP_ID, null);
  }, [navItems, setNavGroupItems]);

  const isArchiveView = activeNavItemId === NOTES_ARCHIVE_NAV_ID;

  useEffect(() => {
    if (!isArchiveView) return;
    let cancelled = false;
    setArchiveLoading(true);
    notesListArchived()
      .then((next) => {
        if (!cancelled) setArchivedRows(next);
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage({
            kind: "error",
            text: `Failed to load archived notes: ${String(error)}`,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setArchiveLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isArchiveView]);

  const selectFirstAvailable = useCallback(
    (nextRows: readonly NoteRow[]) => {
      const [first] = getRecentNotes(nextRows, 1);
      setActiveNavItemId(first ? noteNavId(first.id) : NOTES_ROOT_NAV_ID);
    },
    [setActiveNavItemId],
  );

  const createNote = useCallback(
    async (parentId: string | null) => {
      if (createInFlightRef.current) return;
      createInFlightRef.current = true;
      setBusy(true);
      try {
        const result = await notesCreate({ parentId, title: DEFAULT_NOTE_TITLE });
        setRows((current) => applyNotesMutation(current, result.mutation));
        setActiveNavItemId(noteNavId(result.note.id));
        setMessage(null);
      } catch (error) {
        setMessage({ kind: "error", text: `Create note failed: ${String(error)}` });
      } finally {
        setBusy(false);
        createInFlightRef.current = false;
      }
    },
    [setActiveNavItemId],
  );

  useEffect(() => {
    createNoteRef.current = (parentId) => {
      void createNote(parentId);
    };
  }, [createNote]);

  useEffect(() => {
    if (!activeNavItemId?.startsWith("add:")) return;
    const parentId = parentIdFromNavItem(activeNavItemId.slice(4));
    void createNote(parentId);
  }, [activeNavItemId, createNote]);

  const flushSave = useCallback(async () => {
    if (savingRef.current) return;
    const pending = pendingSaveRef.current;
    if (!pending) {
      if (selectedNoteRef.current) setSaveState("saved");
      return;
    }
    pendingSaveRef.current = null;
    savingRef.current = true;
    if (selectedNoteRef.current?.id === pending.noteId) {
      setSaveState("saving");
    }
    try {
      const updated = await notesUpdate({
        bodyMdx: pending.bodyMdx,
        icon: pending.icon,
        id: pending.noteId,
        title: pending.title,
      });
      setRows((current) => mergeNoteRow(current, updated));
      setMessage(null);
      if (selectedNoteRef.current?.id === updated.id) {
        // Use the payload we *sent*, not the server response, so any
        // keystroke that landed during the round-trip still registers as
        // dirty against the version we just persisted.
        lastSavedKeyRef.current = noteSaveKey({
          bodyMdx: pending.bodyMdx,
          icon: pending.icon,
          title: pending.title,
        });
        // Refresh metadata only — never write back bodyMdx / title / icon
        // state. Doing so during active typing would clobber the cursor
        // and drop characters typed during the save.
        setSelectedNote((prev) =>
          prev && prev.id === updated.id
            ? {
                ...prev,
                archivedAt: updated.archivedAt,
                parentId: updated.parentId,
                sortOrder: updated.sortOrder,
                updatedAt: updated.updatedAt,
              }
            : prev,
        );
        if (pendingSaveRef.current === null) {
          setSaveState("saved");
        }
      }
    } catch (error) {
      if (pendingSaveRef.current === null) pendingSaveRef.current = pending;
      if (selectedNoteRef.current?.id === pending.noteId) {
        setSaveState("error");
      }
      setMessage({ kind: "error", text: `Save note failed: ${String(error)}` });
    } finally {
      savingRef.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Flush trailing edits for the previously-selected note before we
    // overwrite local state with the new note's data. Fire-and-forget so
    // the user sees the new note immediately; failures surface via the
    // message banner.
    const pending = pendingSaveRef.current;
    if (pending && pending.noteId !== selectedNoteId) {
      void flushSave();
    }

    if (!selectedNoteId) {
      setSelectedNote(null);
      setTitle(DEFAULT_NOTE_TITLE);
      setBody("");
      setIcon("");
      lastSavedKeyRef.current = "";
      setSaveState("idle");
      return;
    }

    setLoadingNote(true);
    notesGet(selectedNoteId)
      .then((note) => {
        if (cancelled) return;
        if (!note) {
          setMessage({ kind: "error", text: "That note no longer exists." });
          setRows((current) => {
            const next = current.filter((row) => row.id !== selectedNoteId);
            selectFirstAvailable(next);
            return next;
          });
          return;
        }
        setSelectedNote(note);
        setTitle(note.title || DEFAULT_NOTE_TITLE);
        setBody(note.bodyMdx);
        setIcon(note.icon ?? "");
        lastSavedKeyRef.current = noteSaveKey(note);
        setSaveState("saved");
        setMessage(null);
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage({ kind: "error", text: `Load note failed: ${String(error)}` });
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingNote(false);
      });
    return () => {
      cancelled = true;
    };
  }, [flushSave, selectFirstAvailable, selectedNoteId]);

  useEffect(() => {
    if (!selectedNote || loadingNote) return;
    const nextPayload: PendingNotePayload = {
      bodyMdx: body,
      icon: normalizeIcon(icon),
      noteId: selectedNote.id,
      title: normalizeTitle(title),
    };
    const nextKey = noteSaveKey(nextPayload);
    if (nextKey === lastSavedKeyRef.current) {
      pendingSaveRef.current = null;
      if (!savingRef.current) setSaveState("saved");
      return;
    }
    pendingSaveRef.current = nextPayload;
    setSaveState("dirty");
    const timeout = window.setTimeout(() => {
      void flushSave();
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [body, flushSave, icon, loadingNote, selectedNote, title]);

  useEffect(() => {
    return () => {
      const pending = pendingSaveRef.current;
      if (!pending || savingRef.current) return;
      pendingSaveRef.current = null;
      void notesUpdate({
        bodyMdx: pending.bodyMdx,
        icon: pending.icon,
        id: pending.noteId,
        title: pending.title,
      }).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta || event.altKey) return;
      const key = event.key.toLowerCase();
      // ⌘N (menu-new-event) and ⌘K (menu-open-palette) live on the
      // native menubar, so the keydown is consumed before reaching the
      // webview. Those routes through the workspace:menu listener below.
      if (key === "s") {
        event.preventDefault();
        void flushSave();
        return;
      }
      if (key === "backspace" && !isEditableTarget(event.target)) {
        if (!selectedNoteRef.current) return;
        event.preventDefault();
        archiveSelectedRef.current();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flushSave]);

  useEffect(() => {
    const onMenu = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string }>).detail;
      // ⌘N (menu-new-event) is bound to the native menubar so the
      // keydown is consumed before reaching the webview; route it
      // through the menu broadcast instead. ⌘K is already owned by the
      // global WorkspaceCommandPalette in App.tsx — don't intercept.
      if (detail?.id === "menu-new-event") {
        createNoteRef.current(null);
      }
    };
    window.addEventListener("workspace:menu", onMenu);
    return () => window.removeEventListener("workspace:menu", onMenu);
  }, []);

  useEffect(() => {
    setMoveNavItemHandler((fromId, toId) => {
      const id = noteIdFromNavItem(fromId);
      if (!id) return;
      const parentId = parentIdFromNavItem(toId);
      void notesMove({ id, parentId })
        .then((mutation) =>
          setRows((current) => applyNotesMutation(current, mutation)),
        )
        .catch((error) => {
          setMessage({ kind: "error", text: `Move note failed: ${String(error)}` });
        });
    });
    return () => setMoveNavItemHandler(null);
  }, [setMoveNavItemHandler]);

  useEffect(() => {
    setReorderNavItemHandler((itemId, direction) => {
      const id = noteIdFromNavItem(itemId);
      if (!id) return;
      const siblings = getSiblingNotes(rows, id);
      const currentIndex = siblings.findIndex((row) => row.id === id);
      const target = siblings[currentIndex + (direction === "up" ? -1 : 1)];
      if (!target) return;
      void notesMove({
        edge: direction === "up" ? "before" : "after",
        id,
        targetId: target.id,
      })
        .then((mutation) =>
          setRows((current) => applyNotesMutation(current, mutation)),
        )
        .catch((error) => {
          setMessage({ kind: "error", text: `Reorder note failed: ${String(error)}` });
        });
    });
    return () => setReorderNavItemHandler(null);
  }, [rows, setReorderNavItemHandler]);

  useEffect(() => {
    setRenameNavItemHandler((itemId, nextTitle) => {
      const id = noteIdFromNavItem(itemId);
      if (!id) return;
      const normalized = normalizeTitle(nextTitle);
      void notesUpdate({ id, title: normalized })
        .then((updated) => {
          setRows((current) => mergeNoteRow(current, updated));
          if (selectedNote?.id === id) {
            setSelectedNote(updated);
            setTitle(updated.title);
            lastSavedKeyRef.current = noteSaveKey(updated);
          }
        })
        .catch((error) => {
          setMessage({ kind: "error", text: `Rename note failed: ${String(error)}` });
        });
    });
    setRenameValidator((itemId, nextTitle) => {
      if (!noteIdFromNavItem(itemId)) return null;
      if (!nextTitle.trim()) return "Title is required.";
      if (nextTitle.trim().length > 160) return "Keep note titles under 160 characters.";
      return null;
    });
    return () => {
      setRenameNavItemHandler(null);
      setRenameValidator(null);
    };
  }, [
    selectedNote,
    setRenameNavItemHandler,
    setRenameValidator,
  ]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timeout = window.setTimeout(() => {
      notesSearch(trimmed)
        .then((results) => setSearchResults(results))
        .catch((error) => {
          setMessage({ kind: "error", text: `Search failed: ${String(error)}` });
        })
        .finally(() => setSearching(false));
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    setSearchActiveIndex(0);
  }, [searchResults]);

  const onSearchKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSearchActiveIndex((idx) =>
          searchResults.length === 0
            ? 0
            : Math.min(idx + 1, searchResults.length - 1),
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSearchActiveIndex((idx) => Math.max(idx - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        const target = searchResults[searchActiveIndex];
        if (!target) return;
        event.preventDefault();
        setQuery("");
        setActiveNavItemId(noteNavId(target.id));
        return;
      }
      if (event.key === "Escape") {
        if (query) {
          event.preventDefault();
          setQuery("");
          return;
        }
        event.currentTarget.blur();
      }
    },
    [query, searchActiveIndex, searchResults, setActiveNavItemId],
  );

  const archiveSelected = useCallback(async () => {
    if (!selectedNote || busy) return;
    setBusy(true);
    try {
      const mutation = await notesArchive(selectedNote.id);
      let nextRows: NoteRow[] = [];
      setRows((current) => {
        nextRows = applyNotesMutation(current, mutation);
        return nextRows;
      });
      setSelectedNote(null);
      setMessage({ kind: "success", text: "Archived note." });
      selectFirstAvailable(nextRows);
    } catch (error) {
      setMessage({ kind: "error", text: `Archive note failed: ${String(error)}` });
    } finally {
      setBusy(false);
    }
  }, [busy, selectFirstAvailable, selectedNote]);

  useEffect(() => {
    archiveSelectedRef.current = () => {
      void archiveSelected();
    };
  }, [archiveSelected]);

  const restoreArchived = useCallback(
    async (id: string) => {
      if (busy) return;
      setBusy(true);
      try {
        const mutation = await notesUnarchive(id);
        setRows((current) => applyNotesMutation(current, mutation));
        const restoredIds = new Set(mutation.updated.map((row) => row.id));
        setArchivedRows((current) =>
          current.filter((row) => !restoredIds.has(row.id)),
        );
        setMessage(null);
      } catch (error) {
        setMessage({
          kind: "error",
          text: `Restore note failed: ${String(error)}`,
        });
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  const editorRuntime = useMemo<WorkspaceEditorRuntime>(
    () => ({
      assetsEnabled: true,
      // No remote asset library to browse — the picker pulls in
      // `useSiteAdmin` and would crash without a SiteAdminProvider
      // ancestor. Paste/drop uploads still work through uploadAsset.
      assetLibraryEnabled: false,
      // Curated slash-command vocabulary so Notes users don't see
      // entries for site-admin business blocks (publications, teaching,
      // news, hero, …) that don't make sense outside the public site.
      enabledBlockIds: NOTES_ENABLED_BLOCK_IDS,
      // Typed upload entry point. Notes writes the bytes to its local
      // SQLite-adjacent assets dir via the `notes_save_asset` Tauri
      // command and returns a `note-asset://` URL the custom URI scheme
      // handler in main.rs serves back to the webview.
      uploadAsset: async ({ contentType, base64 }) => {
        if (!contentType || !base64) {
          return {
            ok: false,
            code: "NOTES_ASSET_BAD_PARAMS",
            error: "missing content type or base64 body",
          };
        }
        try {
          const result = await notesSaveAsset({ contentType, base64 });
          return {
            ok: true,
            asset: {
              key: result.key,
              url: result.url,
              size: result.size,
              contentType: result.contentType,
              version: result.key,
            },
          };
        } catch (error) {
          return {
            ok: false,
            code: "NOTES_ASSET_SAVE_FAILED",
            error: String(error),
          };
        }
      },
      // Notes has no other site-admin-shaped endpoints, but BlocksEditor
      // helpers (Bookmark / PageLink / etc.) call `request` for unrelated
      // paths. Return a clear failure for anything we don't handle.
      request: async (path, method) => ({
        ok: false,
        status: 404,
        code: "NOTES_RUNTIME_UNSUPPORTED_PATH",
        error: `Notes editor runtime does not handle ${method ?? "GET"} ${path}`,
        raw: null,
      }),
      setEditorDiagnostics: (next) => setDiagnostics(next),
      setMessage: (kind, text) => setMessage({ kind, text }),
    }),
    [],
  );

  const saveLabel = formatSaveState(saveState);
  const showEditor = Boolean(selectedNoteId && selectedNote && !isArchiveView);
  const breadcrumb = useMemo(
    () =>
      showEditor && selectedNote
        ? buildNoteBreadcrumb(rows, selectedNote.id)
        : [],
    [rows, selectedNote, showEditor],
  );

  return (
    <WorkspaceSurfaceFrame className="notes-surface">
      <WorkspaceCommandBar
        className="notes-commandbar"
        leading={
          <div className="notes-search">
            <input
              type="search"
              placeholder="Search notes"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={onSearchKeyDown}
            />
          </div>
        }
        center={
          <CommandBarCenter
            isArchiveView={isArchiveView}
            breadcrumb={breadcrumb}
            onSelectBreadcrumb={(id) => setActiveNavItemId(noteNavId(id))}
          />
        }
        trailing={
          <WorkspaceCommandGroup align="end">
            {showEditor ? (
              <span
                className="notes-save-state"
                data-state={saveState}
                role={saveState === "error" ? "alert" : "status"}
              >
                {saveLabel}
              </span>
            ) : null}
            <WorkspaceCommandButton
              tone="ghost"
              disabled={busy}
              title={`New note (${SHORTCUT_META}N)`}
              onClick={() => void createNote(null)}
            >
              New note
            </WorkspaceCommandButton>
            {showEditor ? (
              <WorkspaceCommandButton
                tone="ghost"
                disabled={!selectedNote || busy}
                title={`Archive (${SHORTCUT_META}⌫)`}
                onClick={() => void archiveSelected()}
              >
                Archive
              </WorkspaceCommandButton>
            ) : null}
          </WorkspaceCommandGroup>
        }
      />

      {message ? (
        <div className="notes-message" data-kind={message.kind} role="status">
          {message.text}
        </div>
      ) : null}

      {query.trim() ? (
        <section className="notes-search-results" aria-label="Search results">
          <div className="notes-search-results__head">
            {searching ? "Searching..." : `${searchResults.length} results`}
          </div>
          {searchResults.map((result, index) => (
            <button
              type="button"
              key={result.id}
              className="notes-search-result"
              data-active={index === searchActiveIndex || undefined}
              onMouseEnter={() => setSearchActiveIndex(index)}
              onClick={() => {
                setQuery("");
                setActiveNavItemId(noteNavId(result.id));
              }}
            >
              <span className="notes-search-result__title">
                {result.icon ? `${result.icon} ` : null}
                {result.title || DEFAULT_NOTE_TITLE}
              </span>
              <span className="notes-search-result__excerpt">
                {renderSnippet(result.excerpt)}
              </span>
            </button>
          ))}
        </section>
      ) : null}

      {isArchiveView ? (
        <ArchivePanel
          rows={archivedRows}
          loading={archiveLoading}
          busy={busy}
          onRestore={(id) => void restoreArchived(id)}
        />
      ) : showEditor ? (
        <article className="notes-editor" aria-busy={loadingNote ? "true" : undefined}>
          <div className="notes-editor__head">
            <NoteIconPicker value={icon} onChange={setIcon} />
            <input
              aria-label="Note title"
              className="notes-editor__title workspace-editor-title-input"
              value={title}
              placeholder={DEFAULT_NOTE_TITLE}
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
          </div>
          <WorkspaceEditorRuntimeProvider runtime={editorRuntime}>
            <BlocksEditor
              value={body}
              onChange={setBody}
              minHeight={520}
              placeholder="Type / for blocks"
            />
          </WorkspaceEditorRuntimeProvider>
        </article>
      ) : (
        <section className="notes-empty" aria-busy={loading ? "true" : undefined}>
          <div className="notes-empty__card">
            <h1>Notes</h1>
            <WorkspaceCommandButton
              tone="accent"
              disabled={busy}
              onClick={() => void createNote(null)}
            >
              New note
            </WorkspaceCommandButton>
          </div>
          {recentNotes.length > 0 ? (
            <div className="notes-empty__recent" aria-label="Recent notes">
              <h2>Recent</h2>
              {recentNotes.map((note) => (
                <button
                  type="button"
                  key={note.id}
                  className="notes-recent-row"
                  onClick={() => setActiveNavItemId(noteNavId(note.id))}
                >
                  <span>{note.icon || "#"}</span>
                  <strong>{note.title || DEFAULT_NOTE_TITLE}</strong>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      )}
    </WorkspaceSurfaceFrame>
  );
}

function CommandBarCenter({
  isArchiveView,
  breadcrumb,
  onSelectBreadcrumb,
}: {
  isArchiveView: boolean;
  breadcrumb: NoteRow[];
  onSelectBreadcrumb: (id: string) => void;
}) {
  if (isArchiveView) {
    return <span className="workspace-commandbar__title">Archived</span>;
  }
  if (breadcrumb.length === 0) {
    return <span className="workspace-commandbar__title">Notes</span>;
  }
  return (
    <nav className="notes-breadcrumb" aria-label="Note path">
      {breadcrumb.map((node, index) => {
        const isLast = index === breadcrumb.length - 1;
        return (
          <span key={node.id} className="notes-breadcrumb__segment">
            {index > 0 ? (
              <span aria-hidden="true" className="notes-breadcrumb__sep">
                ›
              </span>
            ) : null}
            {isLast ? (
              <span
                className="notes-breadcrumb__crumb"
                data-current="true"
                aria-current="page"
              >
                {node.icon ? `${node.icon} ` : null}
                {node.title || DEFAULT_NOTE_TITLE}
              </span>
            ) : (
              <button
                type="button"
                className="notes-breadcrumb__crumb"
                onClick={() => onSelectBreadcrumb(node.id)}
              >
                {node.icon ? `${node.icon} ` : null}
                {node.title || DEFAULT_NOTE_TITLE}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function ArchivePanel({
  rows,
  loading,
  busy,
  onRestore,
}: {
  rows: NoteRow[];
  loading: boolean;
  busy: boolean;
  onRestore: (id: string) => void;
}) {
  return (
    <section
      className="notes-archive"
      aria-busy={loading ? "true" : undefined}
      aria-label="Archived notes"
    >
      <header className="notes-archive__head">
        <h1>Archived</h1>
        <p>
          Archived notes stay here until you restore them. Restoring a parent
          brings its descendants back too.
        </p>
      </header>
      {loading ? (
        <div className="notes-archive__empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="notes-archive__empty">No archived notes.</div>
      ) : (
        <ul className="notes-archive__list">
          {rows.map((row) => (
            <li key={row.id} className="notes-archive__row">
              <span className="notes-archive__icon" aria-hidden="true">
                {row.icon || "·"}
              </span>
              <span className="notes-archive__title">
                {row.title || DEFAULT_NOTE_TITLE}
              </span>
              <span className="notes-archive__meta">
                {row.archivedAt ? formatArchivedAt(row.archivedAt) : ""}
              </span>
              <button
                type="button"
                className="notes-archive__restore"
                disabled={busy}
                onClick={() => onRestore(row.id)}
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatArchivedAt(unixMs: number): string {
  try {
    return new Date(unixMs).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "";
  }
}
