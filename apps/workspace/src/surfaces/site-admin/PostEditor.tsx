import { useMemo } from "react";

import {
  MdxDocumentEditor,
  type MdxDocumentEditorAdapter,
  type MdxDocumentPropertiesProps,
} from "./MdxDocumentEditor";
import {
  buildPostSource,
  parsePostSource,
  type PostFrontmatterForm,
} from "./mdx-source";
import { PageRoutingProperties } from "./page-routing-properties";
import { PageSeoProperties } from "./page-seo-properties";
import { localDateIso } from "./utils";

export type PostEditorMode = "create" | "edit";

export interface PostEditorProps {
  mode: PostEditorMode;
  onExit: (action: "saved" | "deleted" | "cancel", slug?: string) => void;
  slug?: string;
}

function blankForm(): PostFrontmatterForm {
  return {
    title: "",
    dateIso: localDateIso(),
    description: "",
    draft: true,
    tags: [],
  };
}

function tagsToInput(tags: string[]): string {
  return tags.join(", ");
}

function tagsFromInput(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function PostProperties({
  form,
  mode,
  setForm,
  setSlug,
  slug,
  slugHint,
}: MdxDocumentPropertiesProps<PostFrontmatterForm>) {
  return (
    <>
      {mode === "create" ? (
        <label className="home-builder__field">
          <span>Slug</span>
          <input
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            placeholder="my-new-post"
            autoFocus
          />
          <em>{slugHint}</em>
        </label>
      ) : null}

      <label className="home-builder__field">
        <span>Date</span>
        <input
          value={form.dateIso}
          type="date"
          required
          onChange={(event) =>
            setForm((current) => ({ ...current, dateIso: event.target.value }))
          }
        />
      </label>

      <label className="home-builder__field">
        <span>Description</span>
        <textarea
          rows={3}
          value={form.description}
          placeholder="Optional excerpt for the blog index."
          onChange={(event) =>
            setForm((current) => ({ ...current, description: event.target.value }))
          }
        />
      </label>

      <label className="home-builder__field">
        <span>Tags</span>
        <input
          value={tagsToInput(form.tags)}
          placeholder="research, notes"
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              tags: tagsFromInput(event.target.value),
            }))
          }
        />
      </label>

      <label className="home-builder__toggle">
        <input
          type="checkbox"
          checked={form.draft}
          onChange={(event) =>
            setForm((current) => ({ ...current, draft: event.target.checked }))
          }
        />
        Draft (hidden from public index)
      </label>

      {/* Same per-page URL override + password protection drawer the
        * page editor surfaces. The component talks to the routes API
        * keyed by `slug` (pageId convention is just the slug for both
        * posts and pages); only render in edit mode since a freshly-
        * created post needs a slug on disk before routing it. */}
      {mode === "edit" ? (
        <>
          <PageRoutingProperties slug={slug} publicPath={`/blog/${slug}`} />
          <PageSeoProperties pathname={`/blog/${slug}`} />
        </>
      ) : null}
    </>
  );
}

export function PostEditor({ mode, slug, onExit }: PostEditorProps) {
  const adapter = useMemo<MdxDocumentEditorAdapter<PostFrontmatterForm>>(
    () => ({
      buildSource: buildPostSource,
      canSave: ({ body, form, mode: editorMode, slug: draftSlug }) => {
        if (!form.title.trim()) return false;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dateIso)) return false;
        if (editorMode === "create" && !draftSlug.trim()) return false;
        if (!body.trim()) return false;
        return true;
      },
      contentPath: (draftSlug) => `content/posts/${draftSlug}.mdx`,
      createBlankForm: blankForm,
      defaultBody: "Start writing here.\n",
      getTitle: (form) => form.title,
      kind: "post",
      parseSource: parsePostSource,
      renderProperties: (props) => <PostProperties {...props} />,
      routeBase: "/api/site-admin/posts",
      setTitle: (form, title) => ({ ...form, title }),
      titleNoun: "post",
    }),
    [],
  );

  return <MdxDocumentEditor adapter={adapter} mode={mode} slug={slug} onExit={onExit} />;
}
