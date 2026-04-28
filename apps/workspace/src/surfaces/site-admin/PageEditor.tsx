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
import { PageRoutingProperties } from "./page-routing-properties";
import { PageSeoProperties } from "./page-seo-properties";
import {
  WorkspaceCheckboxField,
  WorkspaceInspectorSection,
  WorkspaceTextareaField,
  WorkspaceTextField,
} from "../../ui/primitives";

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
  readOnly,
  setForm,
  setSlug,
  slug,
  slugHint,
}: MdxDocumentPropertiesProps<PageFrontmatterForm>) {
  return (
    <>
      <WorkspaceInspectorSection heading="Document">
        {mode === "create" ? (
          <WorkspaceTextField
            autoFocus
            hint={slugHint}
            label="Slug"
            readOnly={readOnly}
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            placeholder="about"
          />
        ) : null}

        <WorkspaceTextField
          label="Updated"
          value={form.updated}
          type="date"
          readOnly={readOnly}
          onChange={(event) =>
            setForm((current) => ({ ...current, updated: event.target.value }))
          }
        />

        <WorkspaceTextareaField
          label="Description"
          rows={3}
          readOnly={readOnly}
          value={form.description}
          placeholder="Optional SEO description."
          onChange={(event) =>
            setForm((current) => ({ ...current, description: event.target.value }))
          }
        />

        <WorkspaceCheckboxField
          checked={form.draft}
          disabled={readOnly}
          onChange={(event) =>
            setForm((current) => ({ ...current, draft: event.target.checked }))
          }
        >
          Draft / folder page (shown in Tauri, hidden from public site)
        </WorkspaceCheckboxField>
      </WorkspaceInspectorSection>

      {mode === "edit" ? (
        <>
          <PageRoutingProperties slug={slug} />
          <PageSeoProperties pathname={`/${slug}`} />
        </>
      ) : null}
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
