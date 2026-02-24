import RawHtml from "@/components/raw-html";
import { loadRawMainHtml } from "@/lib/load-raw-main";
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

  return rels
    .filter((rel) => rel !== "index")
    // `/blog` is rendered by a dedicated route to avoid route conflicts with `/blog/list`.
    .filter((rel) => rel !== "blog")
    // `/publications` is rendered by a dedicated route for publication-specific structured data.
    .filter((rel) => rel !== "publications")
    // `/blog/list` is rendered by a dedicated route using a consistent template.
    .filter((rel) => rel !== "blog/list")
    // Blog posts are rendered by a dedicated route using a consistent template.
    .filter((rel) => !rel.startsWith("blog/list/"))
    .map((rel) => ({ slug: rel.split("/").filter(Boolean) }));
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

  let html: string;
  try {
    html = await loadRawMainHtml(slug.join("/"));
  } catch {
    notFound();
  }

  return <RawHtml html={html} />;
}
