import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageView } from "@/components/posts-mdx/page-view";
import { getPageEntry, getPageSlugs, readPageSource } from "@/lib/pages/index";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { getSiteConfig } from "@/lib/site-config";

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams(): Promise<Array<{ slug: string[] }>> {
  // Every route that the catch-all serves now lives as an MDX file
  // under `content/pages/*.mdx`. The legacy Notion raw-HTML pipeline
  // was retired — dedicated routes (home, blog, publications, news,
  // teaching, works) handle the rest.
  const pageSlugs = await getPageSlugs();
  return pageSlugs.map((slug) => ({ slug: [slug] }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const cfg = getSiteConfig();
  const { slug } = await params;
  const pathname = `/${slug.join("/").replace(/^\/+/, "")}`;

  if (slug.length === 1) {
    const entry = await getPageEntry(slug[0]);
    if (entry) {
      return buildPageMetadata({
        cfg,
        title: entry.title,
        description: entry.description ?? cfg.seo.description,
        pathname,
        type: "website",
        modifiedTime: entry.updatedIso || undefined,
      });
    }
  }

  return buildPageMetadata({
    cfg,
    title: "Page",
    description: cfg.seo.description,
    pathname,
    type: "website",
  });
}

export default async function SlugPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  if (slug.length !== 1) notFound();
  const entry = await getPageEntry(slug[0]);
  if (!entry) notFound();
  const file = await readPageSource(slug[0]);
  if (!file) notFound();
  return <PageView entry={entry} source={file.source} />;
}
