import { useMemo } from "react";

import {
  MdxDocumentEditor,
  type MdxDocumentEditorAdapter,
} from "./MdxDocumentEditor";
import {
  buildComponentSource,
  parseComponentSource,
  type ComponentFrontmatterForm,
} from "./mdx-source";

/** Names of the four reusable MDX components managed by the admin
 * Components panel. Matches `lib/components/store.ts > COMPONENT_NAMES`
 * and the `<{Name}Block />` server components in `components/posts-mdx`. */
export type ComponentName = "news" | "teaching" | "publications" | "works";

const COMPONENT_TITLE_NOUN: Record<ComponentName, string> = {
  news: "News component",
  teaching: "Teaching component",
  publications: "Publications component",
  works: "Works component",
};

export interface ComponentEditorProps {
  name: ComponentName;
  onExit: (action: "saved" | "deleted" | "cancel", slug?: string) => void;
}

function blankForm(): ComponentFrontmatterForm {
  return { title: "" };
}

/** Editor for one of the four reusable MDX components. Uses the same
 * MdxDocumentEditor as Posts/Pages but with a stripped-down adapter:
 * no slug field (the four names are fixed), no draft toggle, no SEO
 * panel, no description — just a title and the block-edited body. */
export function ComponentEditor({ name, onExit }: ComponentEditorProps) {
  const adapter = useMemo<MdxDocumentEditorAdapter<ComponentFrontmatterForm>>(
    () => ({
      buildSource: buildComponentSource,
      // The MDX body must be non-empty (an empty file would be an
      // invalid component). The title is also expected to be present
      // — every shipped component file already carries one.
      canSave: ({ body, form }) => {
        if (!form.title.trim()) return false;
        if (!body.trim()) return false;
        return true;
      },
      contentPath: (slug) => `content/components/${slug}.mdx`,
      createBlankForm: blankForm,
      defaultBody: "",
      getTitle: (form) => form.title,
      kind: "component",
      parseSource: parseComponentSource,
      // No extra metadata fields — just the title (rendered separately
      // by MdxDocumentEditor) and the block body.
      renderProperties: () => null,
      routeBase: "/api/site-admin/components",
      setTitle: (form, title) => ({ ...form, title }),
      titleNoun: COMPONENT_TITLE_NOUN[name],
    }),
    [name],
  );

  // Components are always edited (never created or deleted) — the
  // four names are fixed by code. Pin mode to "edit" and pass the
  // component name as the slug.
  return (
    <MdxDocumentEditor
      adapter={adapter}
      mode="edit"
      slug={name}
      onExit={onExit}
    />
  );
}
