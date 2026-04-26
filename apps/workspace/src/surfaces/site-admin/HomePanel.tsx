import { useMemo } from "react";

import {
  MdxDocumentEditor,
  type MdxDocumentEditorAdapter,
  type MdxDocumentPropertiesProps,
} from "./MdxDocumentEditor";
import {
  buildHomeSource,
  parseHomeSource,
  type HomeFrontmatterForm,
} from "./mdx-source";

function blankForm(): HomeFrontmatterForm {
  return { title: "Hi there!" };
}

function HomeProperties({
  form,
}: MdxDocumentPropertiesProps<HomeFrontmatterForm>) {
  return (
    <>
      <label className="home-builder__field">
        <span>Title</span>
        <input value={form.title} readOnly />
        <em>
          The title is edited in the canvas. Home saves to content/home.json as
          title + bodyMdx.
        </em>
      </label>
    </>
  );
}

function sourceToHomeData(source: string): {
  title: string;
  bodyMdx?: string;
} {
  const parsed = parseHomeSource(source);
  const body = parsed.body.trim();
  return {
    title: parsed.form.title.trim() || "Hi there!",
    ...(body ? { bodyMdx: parsed.body } : {}),
  };
}

/** Home is edited with the same MDX document editor as pages/posts. The
 * server still stores the compatibility JSON file (`content/home.json`),
 * but the editor surface is now a normal Notion-style block document. */
export function HomePanel() {
  const adapter = useMemo<MdxDocumentEditorAdapter<HomeFrontmatterForm>>(
    () => ({
      allowBack: false,
      allowDelete: false,
      buildSource: buildHomeSource,
      canSave: ({ form }) => Boolean(form.title.trim()),
      contentPath: () => "content/home.json",
      createBlankForm: blankForm,
      defaultBody: "",
      getTitle: (form) => form.title,
      kind: "home",
      loadDocument: async ({ request }) => {
        const response = await request("/api/site-admin/home", "GET");
        if (!response.ok) {
          return {
            ok: false,
            code: response.code,
            error: response.error,
          };
        }
        const payload = (response.data ?? {}) as Record<string, unknown>;
        const data = (payload.data ?? {}) as Record<string, unknown>;
        const sourceVersion = (payload.sourceVersion ?? {}) as {
          fileSha?: unknown;
        };
        return {
          ok: true,
          source: buildHomeSource(
            { title: typeof data.title === "string" ? data.title : "Hi there!" },
            typeof data.bodyMdx === "string" ? data.bodyMdx : "",
          ),
          version: typeof sourceVersion.fileSha === "string" ? sourceVersion.fileSha : "",
        };
      },
      parseSource: parseHomeSource,
      renderProperties: (props) => <HomeProperties {...props} />,
      routeBase: "/api/site-admin/home",
      saveDocument: async ({ request, source, version }) =>
        request("/api/site-admin/home", "POST", {
          data: sourceToHomeData(source),
          expectedFileSha: version,
        }),
      setTitle: (form, title) => ({ ...form, title }),
      stayAfterSave: true,
      title: "Home",
      titleNoun: "Home",
    }),
    [],
  );

  return (
    <MdxDocumentEditor
      adapter={adapter}
      mode="edit"
      slug="home"
      onExit={() => {
        // Home is the root document; it stays mounted after save.
      }}
    />
  );
}
