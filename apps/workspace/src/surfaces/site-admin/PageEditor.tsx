import { useMemo } from "react";

import {
  MdxDocumentEditor,
  type MdxDocumentEditorAdapter,
  type MdxDocumentPropertiesProps,
} from "./MdxDocumentEditor";
import {
  buildPageSource,
  parsePageSource,
  type PageFrontmatterForm,
} from "./mdx-source";

export type PageEditorMode = "create" | "edit";

export interface PageEditorProps {
  mode: PageEditorMode;
  onExit: (action: "saved" | "deleted" | "cancel", slug?: string) => void;
  slug?: string;
}

function blankForm(): PageFrontmatterForm {
  return {
    title: "",
    description: "",
    draft: true,
    updated: "",
  };
}

function PageProperties({
  form,
  mode,
  setForm,
  setSlug,
  slug,
  slugHint,
}: MdxDocumentPropertiesProps<PageFrontmatterForm>) {
  return (
    <>
      {mode === "create" ? (
        <label className="home-builder__field">
          <span>Slug</span>
          <input
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            placeholder="about"
            autoFocus
          />
          <em>{slugHint}</em>
        </label>
      ) : null}

      <label className="home-builder__field">
        <span>Updated</span>
        <input
          value={form.updated}
          type="date"
          onChange={(event) =>
            setForm((current) => ({ ...current, updated: event.target.value }))
          }
        />
      </label>

      <label className="home-builder__field">
        <span>Description</span>
        <textarea
          rows={3}
          value={form.description}
          placeholder="Optional SEO description."
          onChange={(event) =>
            setForm((current) => ({ ...current, description: event.target.value }))
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
        Draft (hidden from public site)
      </label>
    </>
  );
}

export function PageEditor({ mode, slug, onExit }: PageEditorProps) {
  const adapter = useMemo<MdxDocumentEditorAdapter<PageFrontmatterForm>>(
    () => ({
      buildSource: buildPageSource,
      canSave: ({ body, form, mode: editorMode, slug: draftSlug }) => {
        if (!form.title.trim()) return false;
        if (editorMode === "create" && !draftSlug.trim()) return false;
        if (!body.trim()) return false;
        return true;
      },
      contentPath: (draftSlug) => `content/pages/${draftSlug}.mdx`,
      createBlankForm: blankForm,
      defaultBody: "This page is a work in progress.\n",
      getTitle: (form) => form.title,
      kind: "page",
      parseSource: parsePageSource,
      renderProperties: (props) => <PageProperties {...props} />,
      routeBase: "/api/site-admin/pages",
      setTitle: (form, title) => ({ ...form, title }),
      titleNoun: "page",
    }),
    [],
  );

  return <MdxDocumentEditor adapter={adapter} mode={mode} slug={slug} onExit={onExit} />;
}
