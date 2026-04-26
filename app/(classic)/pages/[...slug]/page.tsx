import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageView } from "@/components/posts-mdx/page-view";
import { getPageEntry, getPageSlugs, readPageSource } from "@/lib/pages/index";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { getSiteConfig } from "@/lib/site-config";

export const dynamic = "force-static";
export const dynamicParams = false;

// Catch-all so hierarchical page slugs (e.g. "docs/intro") render under
// /pages/docs/intro. Single-segment slugs ("about") still work — the
// array form just collapses to ["about"].
function joinSlug(parts: readonly string[]): string {
  return parts.join("/");
}

export async function generateStaticParams(): Promise<Array<{ slug: string[] }>> {
  const slugs = await getPageSlugs();
  return slugs.map((slug) => ({ slug: slug.split("/") }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const cfg = getSiteConfig();
  const { slug } = await params;
  const joined = joinSlug(slug);
  const entry = await getPageEntry(joined);
  if (!entry) {
    return buildPageMetadata({
      cfg,
      title: "Page",
      description: cfg.seo.description,
      pathname: `/pages/${joined}`,
      type: "website",
    });
  }
  return buildPageMetadata({
    cfg,
    title: entry.title,
    description: entry.description ?? cfg.seo.description,
    pathname: `/pages/${joined}`,
    type: "website",
    modifiedTime: entry.updatedIso || undefined,
  });
}

export default async function MdxPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const joined = joinSlug(slug);
  const entry = await getPageEntry(joined);
  if (!entry) notFound();
  const file = await readPageSource(joined);
  if (!file) notFound();
  return <PageView entry={entry} source={file.source} />;
}
