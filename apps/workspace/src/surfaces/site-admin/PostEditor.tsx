import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import { MarkdownEditor, type MarkdownEditorApi } from "./MarkdownEditor";
import { useSiteAdmin } from "./state";
import { insertMarkdownImage, uploadImageFile } from "./assets-upload";
import {
  buildPostSource,
  parsePostSource,
  type PostFrontmatterForm,
} from "./mdx-source";
import { formatDraftAge, useEditorDraft } from "./use-editor-draft";
import { normalizeString } from "./utils";
import { usePreview } from "./use-preview";

export type PostEditorMode = "create" | "edit";

export interface PostEditorProps {
  mode: PostEditorMode;
  slug?: string;
  onExit: (action: "saved" | "deleted" | "cancel", slug?: string) => void;
}

const SLUG_HINT =
  "1–60 chars, lowercase letters / digits / hyphens, no leading or trailing dash";

const BLANK_FORM: PostFrontmatterForm = {
  title: "",
  dateIso: new Date().toISOString().slice(0, 10),
  description: "",
  draft: true,
  tags: [],
};

const BLANK_BODY = `# Title\n\nStart writing here.\n`;

function tagsToInput(tags: string[]): string {
  return tags.join(", ");
}

function tagsFromInput(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function PostEditor({ mode, slug: initialSlug, onExit }: PostEditorProps) {
  const { request, setMessage } = useSiteAdmin();
  const [slug, setSlug] = useState(initialSlug ?? "");
  const [form, setForm] = useState<PostFrontmatterForm>(BLANK_FORM);
  const [body, setBody] = useState(BLANK_BODY);
  const [version, setVersion] = useState<string>("");
  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [dragDepth, setDragDepth] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewOn, setPreviewOn] = useState(false);
  const editorApiRef = useRef<MarkdownEditorApi | null>(null);

  const previewSource = useMemo(() => buildPostSource(form, body), [form, body]);
  const preview = usePreview(previewSource, previewOn, request);

  // In create mode the draft lives under a shared `__new__` key so typing
  // the slug doesn't scatter orphan entries across keys. In edit mode we
  // anchor on the initial slug (never the mutable `slug` state, which is
  // read-only in edit anyway but this is safer).
  const draftKeySlug = mode === "create" ? "" : (initialSlug ?? "");
  const { restorable, clearDraft, dismissRestore } = useEditorDraft(
    "post",
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
        `/api/site-admin/posts/${encodeURIComponent(initialSlug)}`,
        "GET",
      );
      if (cancelled) return;
      setLoading(false);
      if (!response.ok) {
        const msg = `${response.code}: ${response.error}`;
        setError(msg);
        setMessage("error", `Load post failed: ${msg}`);
        return;
      }
      const data = (response.data ?? {}) as Record<string, unknown>;
      const source = typeof data.source === "string" ? data.source : "";
      const ver = normalizeString(data.version);
      const parsed = parsePostSource(source);
      setForm({
        title: parsed.form.title,
        dateIso: parsed.form.dateIso,
        description: parsed.form.description,
        draft: parsed.form.draft,
        tags: parsed.form.tags,
      });
      setBody(parsed.body.replace(/^\n+/, ""));
      setVersion(ver);
    })();
    return () => {
      cancelled = true;
    };
  }, [initialSlug, mode, request, setMessage]);

  const onDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragDepth((depth) => depth + 1);
  }, []);

  const onDragLeave = useCallback(() => {
    setDragDepth((depth) => Math.max(0, depth - 1));
  }, []);

  const handleDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragDepth(0);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      const api = editorApiRef.current;
      if (!api) return;
      for (const file of files) {
        setUploading(true);
        const result = await uploadImageFile({ file, request });
        setUploading(false);
        if (!result.ok) {
          setError(result.error);
          setMessage("error", `Upload failed: ${result.error}`);
          continue;
        }
        const alt = file.name.replace(/\.[^.]+$/, "");
        insertMarkdownImage(api, result.asset.url, alt);
        setMessage("success", `Uploaded ${result.filename} → ${result.asset.url}`);
      }
    },
    [request, setMessage],
  );

  const canSave = useMemo(() => {
    if (!form.title.trim()) return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dateIso)) return false;
    if (mode === "create" && !slug.trim()) return false;
    if (!body.trim()) return false;
    return true;
  }, [body, form.dateIso, form.title, mode, slug]);

  const save = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!canSave || saving) return;
      const source = buildPostSource(form, body);
      setSaving(true);
      setError("");
      if (mode === "create") {
        const response = await request("/api/site-admin/posts", "POST", {
          slug: slug.trim(),
          source,
        });
        setSaving(false);
        if (!response.ok) {
          setError(`${response.code}: ${response.error}`);
          setMessage("error", `Create post failed: ${response.code}: ${response.error}`);
          return;
        }
        clearDraft();
        setMessage("success", `Post created.`);
        onExit("saved", slug.trim());
        return;
      }
      const currentSlug = initialSlug ?? slug;
      const response = await request(
        `/api/site-admin/posts/${encodeURIComponent(currentSlug)}`,
        "PATCH",
        { source, version },
      );
      setSaving(false);
      if (!response.ok) {
        setError(`${response.code}: ${response.error}`);
        setMessage("error", `Update post failed: ${response.code}: ${response.error}`);
        return;
      }
      const data = (response.data ?? {}) as Record<string, unknown>;
      const nextVersion = normalizeString(data.version);
      if (nextVersion) setVersion(nextVersion);
      clearDraft();
      setMessage("success", `Post saved.`);
      onExit("saved", currentSlug);
    },
    [body, canSave, clearDraft, form, initialSlug, mode, onExit, request, saving, setMessage, slug, version],
  );

  const remove = useCallback(async () => {
    if (mode !== "edit" || !initialSlug || !version) return;
    setDeleting(true);
    setError("");
    const response = await request(
      `/api/site-admin/posts/${encodeURIComponent(initialSlug)}`,
      "DELETE",
      { version },
    );
    setDeleting(false);
    if (!response.ok) {
      setError(`${response.code}: ${response.error}`);
      setMessage("error", `Delete post failed: ${response.code}: ${response.error}`);
      return;
    }
    clearDraft();
    setMessage("success", `Post deleted.`);
    onExit("deleted", initialSlug);
  }, [clearDraft, initialSlug, mode, onExit, request, setMessage, version]);

  const onEditorReady = useCallback((api: MarkdownEditorApi) => {
    editorApiRef.current = api;
  }, []);

  const title = mode === "create" ? "New post" : `Edit post: ${initialSlug ?? ""}`;

  return (
    <section className="surface-card">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="m-0 text-[20px] font-semibold text-text-primary tracking-[-0.01em]">
            {title}
          </h1>
          <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">
            Writes to <code>content/posts/{slug || "&lt;slug&gt;"}.mdx</code>.
          </p>
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
            className="btn btn--secondary"
            onClick={() => onExit("cancel", initialSlug)}
            disabled={saving || deleting}
          >
            Back
          </button>
          {mode === "edit" && (
            <button
              type="button"
              className="btn btn--danger"
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
            form="post-editor-form"
            className="btn btn--primary"
            disabled={!canSave || saving || loading || uploading}
          >
            {saving ? "Saving…" : mode === "create" ? "Create" : "Save"}
          </button>
        </div>
      </header>

      {error && (
        <p className="m-0 text-[12px] text-[color:var(--text-danger,#b02a37)]">{error}</p>
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
        <p className="m-0 text-[12.5px] text-text-muted">Loading post…</p>
      ) : (
        <form id="post-editor-form" onSubmit={save} className="flex flex-col gap-3">
          {mode === "create" && (
            <label className="flex flex-col gap-1 text-[12.5px]">
              <span className="text-text-muted">Slug</span>
              <input
                className="ds-input"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                placeholder="my-new-post"
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
              <span className="text-text-muted">Date (YYYY-MM-DD)</span>
              <input
                className="ds-input"
                value={form.dateIso}
                onChange={(event) => setForm((f) => ({ ...f, dateIso: event.target.value }))}
                placeholder="2026-04-23"
                required
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

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[12.5px]">
              <span className="text-text-muted">Tags (comma separated)</span>
              <input
                className="ds-input"
                value={tagsToInput(form.tags)}
                onChange={(event) =>
                  setForm((f) => ({ ...f, tags: tagsFromInput(event.target.value) }))
                }
              />
            </label>
            <label className="flex items-center gap-2 text-[12.5px] pt-[22px]">
              <input
                type="checkbox"
                checked={form.draft}
                onChange={(event) => setForm((f) => ({ ...f, draft: event.target.checked }))}
              />
              <span>Draft (hidden from public index)</span>
            </label>
          </div>

          <div className="flex flex-col gap-1 text-[12.5px]">
            <span className="text-text-muted">
              Body (MDX)
              {uploading ? " — uploading image…" : ""}
              {dragDepth > 0 ? " — drop to upload" : ""}
              {previewOn
                ? preview.loading
                  ? " — rendering preview…"
                  : preview.error
                    ? ` — preview error: ${preview.error}`
                    : ""
                : ""}
            </span>
            <div
              className="flex gap-3"
              onDragEnter={onDragEnter}
              onDragLeave={onDragLeave}
            >
              <div className={previewOn ? "flex-1 min-w-0" : "w-full"}>
                <MarkdownEditor
                  value={body}
                  onChange={setBody}
                  onDrop={handleDrop}
                  onReady={onEditorReady}
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
          </div>
        </form>
      )}
    </section>
  );
}
