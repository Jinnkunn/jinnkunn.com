import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PostView } from "@/components/posts-mdx/post-view";
import JsonLdScript from "@/components/seo/json-ld-script";
import RawHtml from "@/components/raw-html";
import { getBlogPostSlugs, parseBlogMetaFromMain } from "@/lib/blog";
import { loadRawMainHtml } from "@/lib/load-raw-main";
import { getPostEntry, getPostSlugs, readPostSource } from "@/lib/posts/index";
import { extractDescriptionFromMain, extractTitleFromMain } from "@/lib/seo/html-meta";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { buildBlogPostStructuredData } from "@/lib/seo/structured-data";
import { escapeHtml } from "@/lib/shared/text-utils";
import { getSiteConfig } from "@/lib/site-config";

export const dynamic = "force-static";
export const dynamicParams = false;

function buildBreadcrumbsHtml({ title, slug }: { title: string; slug: string }): string {
  const safeTitle = escapeHtml(title);
  const safeSlug = escapeHtml(slug);
  return `<div class="super-navbar__breadcrumbs"><div class="notion-breadcrumb"><a href="/" class="notion-link notion-breadcrumb__item"><div class="notion-navbar__title notion-breadcrumb__title">Home</div></a><span class="notion-breadcrumb__divider">/</span><a href="/blog" class="notion-link notion-breadcrumb__item"><div class="notion-navbar__title notion-breadcrumb__title">Blog</div></a><span class="notion-breadcrumb__divider">/</span><a href="/blog/${safeSlug}" class="notion-link notion-breadcrumb__item"><div class="notion-navbar__title notion-breadcrumb__title">${safeTitle}</div></a></div></div>`;
}

function rewriteBlogPostMainHtml(input: string, { slug }: { slug: string }): string {
  let out = input;
  const title = extractTitleFromMain(out, "Blog");
  const breadcrumbs = buildBreadcrumbsHtml({ title, slug });
  out = out.replace(
    /<div class="super-navbar__breadcrumbs"[^>]*>[\s\S]*?<\/div>\s*<\/div>/i,
    breadcrumbs,
  );
  return out;
}

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  const [mdxSlugs, notionSlugs] = await Promise.all([
    getPostSlugs(),
    getBlogPostSlugs(),
  ]);
  const merged = new Set<string>();
  for (const s of mdxSlugs) merged.add(s);
  // MDX store wins on conflict; Notion is a fallback only.
  for (const s of notionSlugs) if (!merged.has(s)) merged.add(s);
  return Array.from(merged).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const cfg = getSiteConfig();
  const { slug } = await params;
  const pathname = `/blog/${slug}`;

  const mdxEntry = await getPostEntry(slug);
  if (mdxEntry) {
    return buildPageMetadata({
      cfg,
      title: `${mdxEntry.title} | Blog`,
      description: mdxEntry.description ?? cfg.seo.description,
      pathname,
      type: "article",
      publishedTime: mdxEntry.dateIso || undefined,
      modifiedTime: mdxEntry.dateIso || undefined,
    });
  }

  try {
    const main = await loadRawMainHtml(`blog/list/${slug}`);
    const meta = parseBlogMetaFromMain(main);
    const description = extractDescriptionFromMain(main) ?? cfg.seo.description;
    return buildPageMetadata({
      cfg,
      title: `${meta.title} | Blog`,
      description,
      pathname,
      type: "article",
      publishedTime: meta.dateIso || undefined,
      modifiedTime: meta.dateIso || undefined,
    });
  } catch {
    return buildPageMetadata({
      cfg,
      title: "Blog",
      description: cfg.seo.description,
      pathname,
      type: "article",
    });
  }
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const cfg = getSiteConfig();
  const { slug } = await params;

  // 1. MDX store wins.
  const mdxEntry = await getPostEntry(slug);
  if (mdxEntry) {
    const file = await readPostSource(slug);
    if (!file) notFound();
    const jsonLd = buildBlogPostStructuredData(cfg, {
      slug,
      title: mdxEntry.title,
      description: mdxEntry.description ?? cfg.seo.description,
      publishedTime: mdxEntry.dateIso,
      modifiedTime: mdxEntry.dateIso,
    });
    return (
      <>
        <JsonLdScript id={`ld-blog-${slug}`} data={jsonLd} />
        <PostView entry={mdxEntry} source={file.source} />
      </>
    );
  }

  // 2. Notion HTML fallback (existing posts).
  const raw = await loadRawMainHtml(`blog/list/${slug}`);
  const meta = parseBlogMetaFromMain(raw);
  const description = extractDescriptionFromMain(raw) ?? cfg.seo.description;
  const jsonLd = buildBlogPostStructuredData(cfg, {
    slug,
    title: meta.title,
    description,
    publishedTime: meta.dateIso,
    modifiedTime: meta.dateIso,
  });
  const rewritten = rewriteBlogPostMainHtml(raw, { slug });
  return (
    <>
      <JsonLdScript id={`ld-blog-${slug}`} data={jsonLd} />
      <RawHtml html={rewritten} />
    </>
  );
}
