import type { Metadata } from "next";

import worksData from "@/content/works.json";
import { WorksView } from "@/components/works/works-view";
import { normalizeWorksData } from "@/lib/site-admin/works-normalize";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { getSiteConfig } from "@/lib/site-config";
import type { SiteAdminWorksData } from "@/lib/site-admin/api-types";

export const dynamic = "force-static";

function readData(): SiteAdminWorksData {
  return normalizeWorksData(worksData);
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
