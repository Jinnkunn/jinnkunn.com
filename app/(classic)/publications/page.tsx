import type { Metadata } from "next";
import { notFound } from "next/navigation";

import JsonLdScript from "@/components/seo/json-ld-script";
import { PageView } from "@/components/posts-mdx/page-view";
import { parsePublicationsEntries } from "@/lib/components/parse";
import { readComponent } from "@/lib/components/store";
import { getPageEntry, readPageSource } from "@/lib/pages/index";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { buildPublicationsStructuredData } from "@/lib/seo/structured-data";
import { getSiteConfig } from "@/lib/site-config";

export const dynamic = "force-static";

// Read the publications data from the components file (the page MDX
// only embeds `<PublicationsBlock />`; entries live in the dedicated
// component file). Used to materialize JSON-LD for SEO.
async function readPublicationsEntries() {
  const component = await readComponent("publications");
  return parsePublicationsEntries(component?.source ?? "");
}

export async function generateMetadata(): Promise<Metadata> {
  const cfg = getSiteConfig();
  const entry = await getPageEntry("publications");
  return buildPageMetadata({
    cfg,
    title: entry?.title ?? "Publications",
    description: entry?.description ?? cfg.seo.description,
    pathname: "/publications",
    type: "website",
  });
}

/** /publications keeps a custom route so we can emit the
 * publications-list JSON-LD alongside the rendered page. The page
 * body comes from `content/pages/publications.mdx` via PageView (it
 * embeds `<PublicationsBlock />`), and the JSON-LD reader pulls the
 * raw entries from `content/components/publications.mdx` directly so
 * the structured data stays canonical even though the page itself
 * never inlines them. */
export default async function PublicationsPage() {
  const cfg = getSiteConfig();
  const entry = await getPageEntry("publications");
  const loaded = await readPageSource("publications");
  if (!entry || !loaded) notFound();
  const items = await readPublicationsEntries();
  const jsonLd = buildPublicationsStructuredData(cfg, {
    title: entry.title,
    description: entry.description ?? cfg.seo.description,
    items,
  });

  return (
    <>
      <JsonLdScript id="ld-publications" data={jsonLd} />
      <PageView entry={entry} source={loaded.source} />
    </>
  );
}
