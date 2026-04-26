import "server-only";

import type { ReactElement } from "react";

import { ClassicPageShell } from "@/components/classic/classic-page-shell";
import { postMdxComponents } from "@/components/posts-mdx/components";
import { compilePostMdx } from "@/lib/posts/compile";
import type { SiteAdminHomeData } from "@/lib/site-admin/api-types";

/** Public Home renderer. After the section-builder cleanup, Home is a
 * plain MDX document — `bodyMdx` compiles through the same pipeline as
 * every other page, with the shared HeroBlock / Columns / LinkListBlock
 * / FeaturedPagesBlock primitives available via `postMdxComponents`.
 * Empty bodyMdx renders just the page shell (intentional: a freshly
 * cleared Home shouldn't crash, the user fixes it in the admin). */
export async function HomeView({
  data,
}: {
  data: SiteAdminHomeData;
}): Promise<ReactElement> {
  const body = data.bodyMdx?.trim() ?? "";
  const Content = body ? (await compilePostMdx(body)).Content : null;
  return (
    <ClassicPageShell
      title={data.title}
      className="super-content page__index parent-page__index"
    >
      {Content ? (
        <div className="mdx-post__body">
          <Content components={postMdxComponents} />
        </div>
      ) : null}
    </ClassicPageShell>
  );
}
