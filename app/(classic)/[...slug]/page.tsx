import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageView } from "@/components/posts-mdx/page-view";
import { getPageEntry, getPageSlugs, readPageSource } from "@/lib/pages/index";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { getSiteConfig } from "@/lib/site-config";

export const dynamic = "force-static";
export const dynamicParams = false;

// Slugs whose route lives at a sibling page.tsx (currently only
// /publications, which keeps a custom route so it can emit JSON-LD).
// We filter them out of the catch-all's static-params list to avoid
// double-generating identical static HTML at build time. Functionally
// harmless to leave (Next.js routes the explicit page.tsx in
// preference to the catch-all), but the duplicate slows down the
// build and shows up confusingly in route inventories.
const RESERVED_EXPLICIT_SLUGS = new Set(["publications"]);

export async function generateStaticParams(): Promise<Array<{ slug: string[] }>> {
  // Every other route the catch-all serves lives as an MDX file
  // under `content/pages/*.mdx`. Page slugs can be hierarchical
  // (e.g. "docs/intro"); split on "/" so the array form matches what
  // Next.js gives back from the catch-all.
  const pageSlugs = await getPageSlugs();
  return pageSlugs
    .filter((slug) => !RESERVED_EXPLICIT_SLUGS.has(slug))
    .map((slug) => ({ slug: slug.split("/") }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const cfg = getSiteConfig();
  const { slug } = await params;
  const pathname = `/${slug.join("/").replace(/^\/+/, "")}`;

  const joined = slug.join("/");
  const entry = await getPageEntry(joined);
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
  const joined = slug.join("/");
  if (!joined) notFound();
  const entry = await getPageEntry(joined);
  if (!entry) notFound();
  const file = await readPageSource(joined);
  if (!file) notFound();
  return <PageView entry={entry} source={file.source} />;
}
