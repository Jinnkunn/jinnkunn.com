import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageView } from "@/components/posts-mdx/page-view";
import { getPageEntry, getPageSlugs, readPageSource } from "@/lib/pages/index";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { getSiteConfig } from "@/lib/site-config";

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  const slugs = await getPageSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const cfg = getSiteConfig();
  const { slug } = await params;
  const entry = await getPageEntry(slug);
  if (!entry) {
    return buildPageMetadata({
      cfg,
      title: "Page",
      description: cfg.seo.description,
      pathname: `/pages/${slug}`,
      type: "website",
    });
  }
  return buildPageMetadata({
    cfg,
    title: entry.title,
    description: entry.description ?? cfg.seo.description,
    pathname: `/pages/${slug}`,
    type: "website",
    modifiedTime: entry.updatedIso || undefined,
  });
}

export default async function MdxPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const entry = await getPageEntry(slug);
  if (!entry) notFound();
  const file = await readPageSource(slug);
  if (!file) notFound();
  return <PageView entry={entry} source={file.source} />;
}
