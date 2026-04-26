import type { Metadata } from "next";

import publicationsData from "@/content/publications.json";
import { ClassicPageShell } from "@/components/classic/classic-page-shell";
import { PublicationsBlock } from "@/components/posts-mdx/publications-block";
import JsonLdScript from "@/components/seo/json-ld-script";
import { normalizePublicationsData } from "@/lib/site-admin/publications-normalize";
import type { PublicationProfileLink } from "@/lib/publications/extract";
import type { PublicationStructuredEntry } from "@/lib/seo/publications-items";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { buildPublicationsStructuredData } from "@/lib/seo/structured-data";
import { getSiteConfig } from "@/lib/site-config";

export const dynamic = "force-static";

type PublicationsData = {
  schemaVersion?: number;
  title?: string;
  description?: string;
  sections?: ReturnType<typeof normalizePublicationsData>["sections"];
  profileLinks: PublicationProfileLink[];
  entries: PublicationStructuredEntry[];
};

function readData(): PublicationsData {
  return normalizePublicationsData(publicationsData) as PublicationsData;
}

export async function generateMetadata(): Promise<Metadata> {
  const cfg = getSiteConfig();
  const { title, description } = readData();
  return buildPageMetadata({
    cfg,
    title: title ?? "Publications",
    description: description ?? cfg.seo.description,
    pathname: "/publications",
    type: "website",
  });
}

export default async function PublicationsPage() {
  const cfg = getSiteConfig();
  const { title, description, entries } = readData();
  const jsonLd = buildPublicationsStructuredData(cfg, {
    title: title ?? "Publications",
    description: description ?? cfg.seo.description,
    items: entries,
  });
  const pageTitle = title ?? "Publications";

  // Same pattern as /news (e626a13): the page is just chrome around
  // <PublicationsBlock />. The block is the single rendering path,
  // shared with anyone who embeds it inside an MDX document.
  return (
    <>
      <JsonLdScript id="ld-publications" data={jsonLd} />
      <ClassicPageShell
        title={pageTitle}
        className="super-content page__publications parent-page__index"
        breadcrumbs={[
          { href: "/", label: "Home" },
          { href: "/publications", label: pageTitle },
        ]}
      >
        <PublicationsBlock />
      </ClassicPageShell>
    </>
  );
}
