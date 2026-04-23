import type { Metadata } from "next";

import { PublicationsView } from "@/components/publications/publications-view";
import JsonLdScript from "@/components/seo/json-ld-script";
import { extractProfileLinks } from "@/lib/publications/extract";
import { loadRawMainHtml } from "@/lib/load-raw-main";
import { extractDescriptionFromMain, extractTitleFromMain } from "@/lib/seo/html-meta";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { extractPublicationStructuredEntries } from "@/lib/seo/publications-items";
import { buildPublicationsStructuredData } from "@/lib/seo/structured-data";
import { getSiteConfig } from "@/lib/site-config";

export const dynamic = "force-static";

export async function generateMetadata(): Promise<Metadata> {
  const cfg = getSiteConfig();
  try {
    const html = await loadRawMainHtml("publications");
    const title = extractTitleFromMain(html, "Publications");
    const description = extractDescriptionFromMain(html) ?? cfg.seo.description;
    return buildPageMetadata({
      cfg,
      title,
      description,
      pathname: "/publications",
      type: "website",
    });
  } catch {
    return buildPageMetadata({
      cfg,
      title: "Publications",
      description: cfg.seo.description,
      pathname: "/publications",
      type: "website",
    });
  }
}

export default async function PublicationsPage() {
  const cfg = getSiteConfig();
  const html = await loadRawMainHtml("publications");
  const title = extractTitleFromMain(html, "Publications");
  const description = extractDescriptionFromMain(html) ?? cfg.seo.description;
  const entries = extractPublicationStructuredEntries(html);
  const profileLinks = extractProfileLinks(html);
  const jsonLd = buildPublicationsStructuredData(cfg, { title, description, items: entries });

  return (
    <>
      <JsonLdScript id="ld-publications" data={jsonLd} />
      <PublicationsView title={title} profileLinks={profileLinks} entries={entries} />
    </>
  );
}
