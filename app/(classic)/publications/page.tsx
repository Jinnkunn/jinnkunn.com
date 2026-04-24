import type { Metadata } from "next";

import publicationsData from "@/content/publications.json";
import { PublicationsView } from "@/components/publications/publications-view";
import JsonLdScript from "@/components/seo/json-ld-script";
import type { PublicationProfileLink } from "@/lib/publications/extract";
import type { PublicationStructuredEntry } from "@/lib/seo/publications-items";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { buildPublicationsStructuredData } from "@/lib/seo/structured-data";
import { getSiteConfig } from "@/lib/site-config";

export const dynamic = "force-static";

type PublicationsData = {
  title?: string;
  description?: string;
  profileLinks: PublicationProfileLink[];
  entries: PublicationStructuredEntry[];
};

function readData(): PublicationsData {
  const d = publicationsData as PublicationsData;
  return {
    title: d.title || "Publications",
    description: d.description,
    profileLinks: Array.isArray(d.profileLinks) ? d.profileLinks : [],
    entries: Array.isArray(d.entries) ? d.entries : [],
  };
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
  const { title, description, profileLinks, entries } = readData();
  const jsonLd = buildPublicationsStructuredData(cfg, {
    title: title ?? "Publications",
    description: description ?? cfg.seo.description,
    items: entries,
  });

  return (
    <>
      <JsonLdScript id="ld-publications" data={jsonLd} />
      <PublicationsView
        title={title ?? "Publications"}
        profileLinks={profileLinks}
        entries={entries}
      />
    </>
  );
}
