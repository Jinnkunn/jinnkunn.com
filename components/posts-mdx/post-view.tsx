import "server-only";

import Link from "next/link";

import type { PostEntry } from "@/lib/posts/types";
import { compilePostMdx } from "@/lib/posts/compile";
import { postMdxComponents } from "./components";

export async function PostView({
  entry,
  source,
}: {
  entry: PostEntry;
  source: string;
}) {
  const { Content } = await compilePostMdx(source);

  return (
    <main
      id="main-content"
      className="super-content page__blog-post parent-page__blog-post"
    >
      <div className="super-navbar__breadcrumbs">
        <div className="notion-breadcrumb">
          <Link href="/" className="notion-link notion-breadcrumb__item">
            <div className="notion-navbar__title notion-breadcrumb__title">Home</div>
          </Link>
          <span className="notion-breadcrumb__divider">/</span>
          <Link href="/blog" className="notion-link notion-breadcrumb__item">
            <div className="notion-navbar__title notion-breadcrumb__title">Blog</div>
          </Link>
          <span className="notion-breadcrumb__divider">/</span>
          <Link href={entry.href} className="notion-link notion-breadcrumb__item">
            <div className="notion-navbar__title notion-breadcrumb__title">
              {entry.title}
            </div>
          </Link>
        </div>
      </div>
      <div className="notion-header page">
        <div className="notion-header__cover no-cover no-icon" />
        <div className="notion-header__content max-width no-cover no-icon">
          <div className="notion-header__title-wrapper">
            <h1 className="notion-header__title">{entry.title}</h1>
          </div>
        </div>
      </div>
      <article className="notion-root max-width has-footer">
        <div className="notion-page__properties">
          <div className="notion-page__property">
            <div className="notion-property notion-property__date notion-semantic-string">
              <span className="date">{entry.dateText}</span>
            </div>
          </div>
          {entry.readingMinutes > 0 && (
            <div className="notion-page__property">
              <div className="notion-property notion-semantic-string">
                <span className="mdx-post__reading">{entry.readingMinutes} min read</span>
              </div>
            </div>
          )}
        </div>
        <div className="mdx-post__body">
          <Content components={postMdxComponents} />
        </div>
      </article>
    </main>
  );
}
