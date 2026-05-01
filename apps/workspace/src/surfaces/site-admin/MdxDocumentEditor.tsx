import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";

import { AssetLibraryPicker } from "./AssetLibraryPicker";
import { MarkdownEditor } from "./LazyMarkdownEditor";
import { useImeComposition } from "./useImeComposition";
import { classifySiteAdminError } from "./api-errors";
import {
  decodeDocumentLoad,
  decodeDocumentSave,
} from "./api-validators";
import { parseMdxBlocks } from "./mdx-blocks";
import { countBlocksOfType } from "./mdx-block-tree";
import { localContent } from "./local-content";
import { useSiteAdmin, useSiteAdminEphemeral } from "./state";
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
import { WorkspaceEditorRuntimeProvider } from "../../ui/editor-runtime";
// Block-editor canvas + its public types live in `./blocks-editor` so
// surfaces that just need the canvas (Notes) don't drag in this whole
// document chrome / publish flow file.
import {
  BlocksEditor,
  type BlocksEditorProps,
  type RequestFn,
} from "./blocks-editor";

type DocumentEditorMode = "blocks" | "source";
type DocumentExitAction = "saved" | "deleted" | "cancel";

const DOCUMENT_EDITOR_MODES: DocumentEditorMode[] = ["blocks", "source"];

const DOCUMENT_EDITOR_MODE_LABELS: Record<DocumentEditorMode, string> = {
  blocks: "Write",
  source: "Advanced",
};

const SLUG_HINTS: Partial<Record<EditorKind, string>> = {
  page: "Each segment 1–60 lowercase chars, separated by '/' (max 4 levels)",
  post: "1–120 chars, lowercase letters / digits / hyphens, no leading or trailing dash",
};

function isDocumentEditorMode(value: unknown): value is DocumentEditorMode {
  return isString(value) && DOCUMENT_EDITOR_MODES.includes(value as DocumentEditorMode);
}

// Re-export so existing site-admin call sites importing `BlocksEditor` /
// `BlocksEditorProps` from `./MdxDocumentEditor` keep compiling.
export { BlocksEditor };
export type { BlocksEditorProps };

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
      className="mdx-document-editor__title workspace-editor-title-input"
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
  } = useSiteAdmin();
  const { setEditorDiagnostics, setTopbarSaveAction } = useSiteAdminEphemeral();
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
  const editorRuntime = useMemo(
    () => ({
      assetsEnabled: true,
      // Typed entry point. Routes paste/drop uploads through the
      // site-admin assets endpoint without callers needing to know the
      // path string. The path lives here, where it belongs (next to
      // the rest of the site-admin HTTP wiring).
      uploadAsset: async ({
        contentType,
        base64,
        filename,
      }: {
        contentType: string;
        base64: string;
        filename: string;
      }) => {
        const response = await request("/api/site-admin/assets", "POST", {
          contentType,
          base64,
          filename,
        });
        if (!response.ok) {
          return { ok: false as const, code: response.code, error: response.error };
        }
        const data = response.data as Record<string, unknown>;
        const asset = {
          key: typeof data.key === "string" ? data.key : "",
          url: typeof data.url === "string" ? data.url : "",
          size: typeof data.size === "number" ? data.size : 0,
          contentType:
            typeof data.contentType === "string" ? data.contentType : contentType,
          version: typeof data.version === "string" ? data.version : "",
        };
        if (!asset.url) {
          return {
            ok: false as const,
            code: "ASSET_NO_URL",
            error: "upload response missing url",
          };
        }
        return { ok: true as const, asset };
      },
      request,
      setEditorDiagnostics,
      setMessage,
    }),
    [request, setEditorDiagnostics, setMessage],
  );
  const rawBlockCount = useMemo(
    () => countBlocksOfType(parseMdxBlocks(body), "raw"),
    [body],
  );
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
        ? "Saving…"
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
                ? rawBlockCount > 0
                  ? `${rawBlockCount} raw MDX ${rawBlockCount === 1 ? "block" : "blocks"}`
                  : "Visual editor"
                : imageDrop.uploading
                  ? "Uploading image…"
                  : imageDrop.dragDepth > 0
                    ? "Drop to upload"
                    : "Raw MDX escape hatch"}
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
                <WorkspaceEditorRuntimeProvider runtime={editorRuntime}>
                  <BlocksEditor
                    value={body}
                    onChange={setBody}
                    readOnly={productionReadOnly}
                  />
                </WorkspaceEditorRuntimeProvider>
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
