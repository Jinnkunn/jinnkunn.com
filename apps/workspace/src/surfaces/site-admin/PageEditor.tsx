import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { MarkdownEditor } from "./LazyMarkdownEditor";
import { useSiteAdmin } from "./state";
import { AssetLibraryPicker } from "./AssetLibraryPicker";
import {
  buildPageSource,
  parsePageSource,
  type PageFrontmatterForm,
} from "./mdx-source";
import { formatDraftAge, useEditorDraft } from "./use-editor-draft";
import {
  useConfirmingBack,
  useMdxImageUploadDrop,
  useUnsavedChangesBeforeUnload,
} from "./use-mdx-editor-controller";
import { isBoolean, usePersistentUiState } from "./use-persistent-ui-state";
import { normalizeString } from "./utils";
import { usePreview } from "./use-preview";

export type PageEditorMode = "create" | "edit";

export interface PageEditorProps {
  mode: PageEditorMode;
  slug?: string;
  onExit: (action: "saved" | "deleted" | "cancel", slug?: string) => void;
}

const SLUG_HINT =
  "1–60 chars, lowercase letters / digits / hyphens, no leading or trailing dash";

const BLANK_FORM: PageFrontmatterForm = {
  title: "",
  description: "",
  draft: true,
  updated: "",
};

const BLANK_BODY = "This page is a work in progress.\n";

export function PageEditor({ mode, slug: initialSlug, onExit }: PageEditorProps) {
  const { request, setMessage } = useSiteAdmin();
  const [slug, setSlug] = useState(initialSlug ?? "");
  const [form, setForm] = useState<PageFrontmatterForm>(BLANK_FORM);
  const [body, setBody] = useState(BLANK_BODY);
  const [lastSavedSource, setLastSavedSource] = useState(() =>
    buildPageSource(BLANK_FORM, BLANK_BODY),
  );
  const [version, setVersion] = useState<string>("");
  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewOn, setPreviewOn] = usePersistentUiState(
    "workspace.site-admin.page-editor.preview.v1",
    false,
    isBoolean,
  );

  const previewSource = useMemo(() => buildPageSource(form, body), [form, body]);
  const dirty = previewSource !== lastSavedSource || (mode === "create" && Boolean(slug.trim()));
  const preview = usePreview(previewSource, previewOn, request);
  const imageDrop = useMdxImageUploadDrop({ request, setError, setMessage });
  const { confirmBack, leaveEditor } = useConfirmingBack({
    dirty,
    initialSlug,
    onExit,
    source: previewSource,
  });

  // See PostEditor for the keying rationale.
  const draftKeySlug = mode === "create" ? "" : (initialSlug ?? "");
  const { restorable, clearDraft, dismissRestore } = useEditorDraft(
    "page",
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
        `/api/site-admin/pages/${encodeURIComponent(initialSlug)}`,
        "GET",
      );
      if (cancelled) return;
      setLoading(false);
      if (!response.ok) {
        const msg = `${response.code}: ${response.error}`;
        setError(msg);
        setMessage("error", `Load page failed: ${msg}`);
        return;
      }
      const data = (response.data ?? {}) as Record<string, unknown>;
      const source = typeof data.source === "string" ? data.source : "";
      const ver = normalizeString(data.version);
      const parsed = parsePageSource(source);
      const nextBody = parsed.body.replace(/^\n+/, "");
      setForm(parsed.form);
      setBody(nextBody);
      setLastSavedSource(buildPageSource(parsed.form, nextBody));
      setVersion(ver);
    })();
    return () => {
      cancelled = true;
    };
  }, [initialSlug, mode, request, setMessage]);

  useUnsavedChangesBeforeUnload(dirty, saving, deleting);

  const canSave = useMemo(() => {
    if (!form.title.trim()) return false;
    if (mode === "create" && !slug.trim()) return false;
    if (!body.trim()) return false;
    return true;
  }, [body, form.title, mode, slug]);

  const save = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!canSave || saving) return;
      const source = buildPageSource(form, body);
      setSaving(true);
      setError("");
      if (mode === "create") {
        const response = await request("/api/site-admin/pages", "POST", {
          slug: slug.trim(),
          source,
        });
        setSaving(false);
        if (!response.ok) {
          setError(`${response.code}: ${response.error}`);
          setMessage("error", `Create page failed: ${response.code}: ${response.error}`);
          return;
        }
        setLastSavedSource(source);
        clearDraft();
        setMessage("success", `Page created.`);
        onExit("saved", slug.trim());
        return;
      }
      const currentSlug = initialSlug ?? slug;
      const response = await request(
        `/api/site-admin/pages/${encodeURIComponent(currentSlug)}`,
        "PATCH",
        { source, version },
      );
      setSaving(false);
      if (!response.ok) {
        setError(`${response.code}: ${response.error}`);
        setMessage("error", `Update page failed: ${response.code}: ${response.error}`);
        return;
      }
      const data = (response.data ?? {}) as Record<string, unknown>;
      const nextVersion = normalizeString(data.version);
      if (nextVersion) setVersion(nextVersion);
      setLastSavedSource(source);
      clearDraft();
      setMessage("success", `Page saved.`);
      onExit("saved", currentSlug);
    },
    [body, canSave, clearDraft, form, initialSlug, mode, onExit, request, saving, setMessage, slug, version],
  );

  const remove = useCallback(async () => {
    if (mode !== "edit" || !initialSlug || !version) return;
    setDeleting(true);
    setError("");
    const response = await request(
      `/api/site-admin/pages/${encodeURIComponent(initialSlug)}`,
      "DELETE",
      { version },
    );
    setDeleting(false);
    if (!response.ok) {
      setError(`${response.code}: ${response.error}`);
      setMessage("error", `Delete page failed: ${response.code}: ${response.error}`);
      return;
    }
    clearDraft();
    setMessage("success", `Page deleted.`);
    onExit("deleted", initialSlug);
  }, [clearDraft, initialSlug, mode, onExit, request, setMessage, version]);

  const title = mode === "create" ? "New page" : `Edit page: ${initialSlug ?? ""}`;

  return (
    <section className="surface-card">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]">
            {title}
          </h1>
          <div className="editor-meta-row">
            <p className="m-0 text-[12.5px] text-text-muted">
              Writes to <code>content/pages/{slug || "&lt;slug&gt;"}.mdx</code>.
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
            onClick={() => setPreviewOn((on) => !on)}
            disabled={saving || deleting}
            aria-pressed={previewOn}
          >
            {previewOn ? "Hide preview" : "Preview"}
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
            form="page-editor-form"
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
          <span>Loading page…</span>
        </div>
      ) : (
        <form id="page-editor-form" onSubmit={save} className="flex flex-col gap-3">
          {mode === "create" && (
            <label className="flex flex-col gap-1 text-[12.5px]">
              <span className="text-text-muted">Slug</span>
              <input
                className="ds-input"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                placeholder="about"
                autoFocus
              />
              <span className="text-[11.5px] text-text-muted">{SLUG_HINT}</span>
            </label>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[12.5px]">
              <span className="text-text-muted">Title</span>
              <input
                className="ds-input"
                value={form.title}
                onChange={(event) => setForm((f) => ({ ...f, title: event.target.value }))}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-[12.5px]">
              <span className="text-text-muted">Updated (YYYY-MM-DD, optional)</span>
              <input
                className="ds-input"
                value={form.updated}
                type="date"
                onChange={(event) => setForm((f) => ({ ...f, updated: event.target.value }))}
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-[12.5px]">
            <span className="text-text-muted">Description (optional)</span>
            <input
              className="ds-input"
              value={form.description}
              onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
            />
          </label>

          <label className="flex items-center gap-2 text-[12.5px]">
            <input
              type="checkbox"
              checked={form.draft}
              onChange={(event) => setForm((f) => ({ ...f, draft: event.target.checked }))}
            />
            <span>Draft (hidden from public site)</span>
          </label>

          <div className="flex flex-col gap-1 text-[12.5px]">
            <span className="text-text-muted">
              Body (MDX)
              {imageDrop.uploading ? " — uploading image…" : ""}
              {imageDrop.dragDepth > 0 ? " — drop to upload" : ""}
              {previewOn
                ? preview.loading
                  ? " — rendering preview…"
                  : preview.error
                    ? ` — preview error: ${preview.error}`
                    : ""
                : ""}
            </span>
            <div
              className="editor-drop-zone flex gap-3"
              data-drag-active={imageDrop.dragDepth > 0 ? "true" : undefined}
              onDragEnter={imageDrop.onDragEnter}
              onDragLeave={imageDrop.onDragLeave}
            >
              <div className={previewOn ? "flex-1 min-w-0" : "w-full"}>
                <MarkdownEditor
                  value={body}
                  onChange={setBody}
                  onDrop={imageDrop.handleDrop}
                  onReady={imageDrop.onEditorReady}
                  minHeight={360}
                />
              </div>
              {previewOn && (
                <div
                  className="flex-1 min-w-0 overflow-auto rounded-[8px] border border-border-subtle bg-bg-surface"
                  style={{ minHeight: 360, padding: "12px 16px" }}
                >
                  <div
                    className="notion-root mdx-post__body"
                    dangerouslySetInnerHTML={{ __html: preview.html }}
                  />
                </div>
              )}
            </div>
            <span className="text-[11.5px] text-text-muted">
              Drop an image onto the editor to upload; a <code>![alt](/uploads/...)</code> tag is
              inserted at the cursor.
            </span>
            <AssetLibraryPicker
              onSelect={(asset) => {
                const alt = asset.alt || asset.filename || "image";
                imageDrop.insertAssetImage(asset.url, alt);
              }}
            />
          </div>
        </form>
      )}
    </section>
  );
}
