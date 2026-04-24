import "server-only";

import Image from "next/image";
import type { ReactElement } from "react";

import { renderSimpleMarkdown } from "@/lib/posts/simple-markdown";
import type { SiteAdminHomeData } from "@/lib/site-admin/api-types";

/** Split markdown body on the first blank line so the opening paragraph
 * can render in a column beside the profile image (Notion-like) and the
 * remaining paragraphs flow full-width below. Input is trusted markdown
 * from content/home.json — no need to handle HTML. */
function splitIntroAndRest(body: string): { intro: string; rest: string } {
  const trimmed = body.trim();
  if (!trimmed) return { intro: "", rest: "" };
  const match = trimmed.match(/\n\s*\n/);
  if (!match || match.index === undefined) {
    return { intro: trimmed, rest: "" };
  }
  return {
    intro: trimmed.slice(0, match.index).trim(),
    rest: trimmed.slice(match.index + match[0].length).trim(),
  };
}

export async function HomeView({
  data,
}: {
  data: SiteAdminHomeData;
}): Promise<ReactElement> {
  const { intro, rest } = splitIntroAndRest(data.body);

  // Pure AST pipeline (remark → rehype → jsx-runtime) instead of
  // @mdx-js/mdx's evaluate(). evaluate() relies on `new Function()`,
  // which Cloudflare Workers block at runtime — and the home page is
  // dynamic-rendered on staging (STAGING_GATE), so we can't rely on
  // the build-time pre-render. home.json is short trusted markdown, so
  // the full MDX component layer isn't needed here.
  const introNode = await renderSimpleMarkdown(intro);
  const restNode = await renderSimpleMarkdown(rest);

  return (
    <main
      id="main-content"
      className="super-content page__index parent-page__index"
    >
      <div className="notion-header page">
        <div className="notion-header__cover no-cover no-icon" />
        <div className="notion-header__content max-width no-cover no-icon">
          <div className="notion-header__title-wrapper">
            <h1 className="notion-header__title">{data.title}</h1>
          </div>
        </div>
      </div>
      <article className="notion-root max-width has-footer">
        <div className="home-intro-row">
          {data.profileImageUrl && (
            <div className="home-intro-row__image notion-image align-start">
              <Image
                src={data.profileImageUrl}
                alt={data.profileImageAlt || "Profile"}
                width={480}
                height={640}
                priority
                sizes="(max-width: 640px) 100vw, 33vw"
                className="home-intro-row__img"
              />
            </div>
          )}
          {introNode && (
            <div className="home-intro-row__body mdx-post__body">{introNode}</div>
          )}
        </div>
        {restNode && (
          <div className="home-body mdx-post__body">{restNode}</div>
        )}
      </article>
    </main>
  );
}
