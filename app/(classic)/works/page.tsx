import type { Metadata } from "next";

import worksData from "@/content/works.json";
import { WorksView } from "@/components/works/works-view";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { getSiteConfig } from "@/lib/site-config";
import type { SiteAdminWorksData } from "@/lib/site-admin/api-types";

export const dynamic = "force-static";

function readData(): SiteAdminWorksData {
  const d = worksData as Partial<SiteAdminWorksData>;
  return {
    title: d.title || "Works",
    description: d.description,
    intro: d.intro,
    note: d.note,
    entries: Array.isArray(d.entries) ? d.entries : [],
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const cfg = getSiteConfig();
  const { title, description } = readData();
  return buildPageMetadata({
    cfg,
    title,
    description: description ?? cfg.seo.description,
    pathname: "/works",
    type: "website",
  });
}

export default async function WorksPage() {
  const data = readData();
  return <WorksView data={data} />;
}
