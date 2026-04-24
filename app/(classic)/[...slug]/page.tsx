import RawHtml from "@/components/raw-html";
import { PageView } from "@/components/posts-mdx/page-view";
import { loadRawMainHtml } from "@/lib/load-raw-main";
import { getPageEntry, getPageSlugs, readPageSource } from "@/lib/pages/index";
import { listRawHtmlRelPaths } from "@/lib/server/content-files";
import { extractDescriptionFromMain, extractTitleFromMain } from "@/lib/seo/html-meta";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { getSiteConfig } from "@/lib/site-config";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams(): Promise<
  Array<{ slug: string[] }>
> {
  const rels = listRawHtmlRelPaths();

  const routes = new Set<string>();
  for (const rel of rels) {
    if (rel === "index") continue;
    // `/blog` is rendered by a dedicated route to avoid route conflicts with `/blog/list`.
    if (rel === "blog") continue;
    // `/publications` is rendered by a dedicated route for publication-specific structured data.
    if (rel === "publications") continue;
    // `/blog/list` is rendered by a dedicated route using a consistent template.
    if (rel === "blog/list") continue;
    // Blog posts are rendered by a dedicated route using a consistent template.
    if (rel.startsWith("blog/list/")) continue;
    routes.add(rel);
  }

  // Top-level MDX pages (`content/pages/<slug>.mdx`) live at the same
  // root URL — `/<slug>` — as the legacy Notion raw-html pages. Merge
  // their slugs in so a standalone MDX page authored via site-admin
  // gets a route even if no matching Notion HTML exists.
  const pageSlugs = await getPageSlugs();
  for (const slug of pageSlugs) {
    if (slug) routes.add(slug);
  }

  return Array.from(routes).map((rel) => ({ slug: rel.split("/").filter(Boolean) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const cfg = getSiteConfig();
  const { slug } = await params;
  const route = slug.join("/");
  const pathname = `/${route.replace(/^\/+/, "")}`;

  // MDX wins over legacy Notion HTML on slug collision.
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

  try {
    const main = await loadRawMainHtml(route);
    const title = extractTitleFromMain(main, "Page");
    const description = extractDescriptionFromMain(main) ?? undefined;
    return buildPageMetadata({
      cfg,
      title,
      description,
      pathname,
      type: "website",
    });
  } catch {
    return buildPageMetadata({
      cfg,
      title: "Page",
      description: cfg.seo.description,
      pathname,
      type: "website",
    });
  }
}

export default async function SlugPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;

  // 1. MDX store wins (authored via site-admin).
  if (slug.length === 1) {
    const entry = await getPageEntry(slug[0]);
    if (entry) {
      const file = await readPageSource(slug[0]);
      if (file) {
        return <PageView entry={entry} source={file.source} />;
      }
    }
  }

  // 2. Fallback to Notion-synced raw HTML.
  let html: string;
  try {
    html = await loadRawMainHtml(slug.join("/"));
  } catch {
    notFound();
  }

  return <RawHtml html={html} />;
}
