import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PostView } from "@/components/posts-mdx/post-view";
import JsonLdScript from "@/components/seo/json-ld-script";
import { getPostEntry, getPostSlugs, readPostSource } from "@/lib/posts/index";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { buildBlogPostStructuredData } from "@/lib/seo/structured-data";
import { getSiteConfig } from "@/lib/site-config";

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  const slugs = await getPostSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const cfg = getSiteConfig();
  const { slug } = await params;
  const entry = await getPostEntry(slug);
  if (!entry) {
    return buildPageMetadata({
      cfg,
      title: "Blog",
      description: cfg.seo.description,
      pathname: `/blog/${slug}`,
      type: "article",
    });
  }
  return buildPageMetadata({
    cfg,
    title: `${entry.title} | Blog`,
    description: entry.description ?? cfg.seo.description,
    pathname: `/blog/${slug}`,
    type: "article",
    publishedTime: entry.dateIso || undefined,
    modifiedTime: entry.dateIso || undefined,
  });
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const cfg = getSiteConfig();
  const { slug } = await params;

  const entry = await getPostEntry(slug);
  if (!entry) notFound();
  const file = await readPostSource(slug);
  if (!file) notFound();

  const jsonLd = buildBlogPostStructuredData(cfg, {
    slug,
    title: entry.title,
    description: entry.description ?? cfg.seo.description,
    publishedTime: entry.dateIso,
    modifiedTime: entry.dateIso,
  });
  return (
    <>
      <JsonLdScript id={`ld-blog-${slug}`} data={jsonLd} />
      <PostView entry={entry} source={file.source} />
    </>
  );
}
