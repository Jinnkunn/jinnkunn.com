import Link from "next/link";
import type { Metadata } from "next";

import { loadRawMainHtml } from "@/lib/load-raw-main";
import {
  extractArticleInnerFromMain,
  extractHeadingsFromHtml,
  getAdjacentBlogPosts,
  getBlogPostSlugs,
  parseBlogMetaFromMain,
  splitBlogArticleInner,
} from "@/lib/blog";
import { notFound } from "next/navigation";

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams(): Promise<Array<{ post: string }>> {
  const slugs = await getBlogPostSlugs();
  return slugs.map((post) => ({ post }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ post: string }>;
}): Promise<Metadata> {
  const { post } = await params;
  try {
    const main = await loadRawMainHtml(`blog/list/${post}`);
    const meta = parseBlogMetaFromMain(main);
    return {
      title: `${meta.title} | Blog`,
      description: meta.title,
    };
  } catch {
    return { title: "Blog" };
  }
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ post: string }>;
}) {
  const { post } = await params;

  let main: string;
  try {
    main = await loadRawMainHtml(`blog/list/${post}`);
  } catch {
    notFound();
  }

  const meta = parseBlogMetaFromMain(main);

  const articleInner = extractArticleInnerFromMain(main);
  const parts = splitBlogArticleInner(articleInner);
  const headings = extractHeadingsFromHtml(parts.bodyHtml).slice(0, 40);

  const adj = await getAdjacentBlogPosts(`/blog/list/${post}`);
  const hasProperties = Boolean(
    parts.propertiesHtml && parts.propertiesHtml.includes("notion-page__properties"),
  );

  const mainId = `page-blog-list-${post}`;
  const mainClass = `super-content page__blog-list-${post} parent-page__blog-list`;

  return (
    <main id={mainId} className={mainClass}>
      <div className="notion-header page">
        <div className="notion-header__cover no-cover no-icon" />
        <div className="notion-header__content max-width no-cover no-icon">
          <div className="notion-header__title-wrapper">
            <h1 className="notion-header__title">{meta.title}</h1>
          </div>
          {meta.dateText && !hasProperties ? (
            <div className="blog-post-meta">
              <span className="date">{meta.dateText}</span>
            </div>
          ) : null}
        </div>
      </div>

      <article className="notion-root max-width has-footer">
        {parts.propertiesHtml ? (
          <div dangerouslySetInnerHTML={{ __html: parts.propertiesHtml }} />
        ) : null}

        <div className="blog-post-layout">
          {headings.length > 0 ? (
            <aside className="blog-post-toc" aria-label="Table of contents">
              <ul id="block-blog-toc" className="notion-table-of-contents color-gray">
                {headings.map((h) => (
                  <li
                    key={h.id}
                    className="notion-table-of-contents__item"
                    data-toc-target={h.id}
                  >
                    <a className="notion-link" href={`#${h.id}`}>
                      <div
                        className="notion-semantic-string"
                        style={{ marginInlineStart: h.level === 3 ? 12 : 0 }}
                      >
                        {h.text}
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            </aside>
          ) : null}

          {parts.bodyHtml ? (
            <div
              className="blog-post-content"
              dangerouslySetInnerHTML={{ __html: parts.bodyHtml }}
            />
          ) : null}
        </div>

        <div className="blog-post-nav">
          <div className="notion-divider" />
          <div className="blog-post-nav__row">
            <div className="blog-post-nav__col">
              {adj.prev ? (
                <Link className="notion-link link" href={adj.prev.href}>
                  ← {adj.prev.title}
                </Link>
              ) : null}
            </div>

            <div className="blog-post-nav__col blog-post-nav__center">
              <Link className="notion-link link" href="/blog">
                Back to Blog
              </Link>
            </div>

            <div className="blog-post-nav__col blog-post-nav__right">
              {adj.next ? (
                <Link className="notion-link link" href={adj.next.href}>
                  {adj.next.title} →
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      </article>
    </main>
  );
}
