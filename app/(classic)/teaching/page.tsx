import type { Metadata } from "next";

import teachingData from "@/content/teaching.json";
import { TeachingView } from "@/components/teaching/teaching-view";
import { normalizeTeachingData } from "@/lib/site-admin/teaching-normalize";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { getSiteConfig } from "@/lib/site-config";
import type { SiteAdminTeachingData } from "@/lib/site-admin/api-types";

export const dynamic = "force-static";

function readData(): SiteAdminTeachingData {
  return normalizeTeachingData(teachingData);
}

export async function generateMetadata(): Promise<Metadata> {
  const cfg = getSiteConfig();
  const { title, description } = readData();
  return buildPageMetadata({
    cfg,
    title,
    description: description ?? cfg.seo.description,
    pathname: "/teaching",
    type: "website",
  });
}

export default async function TeachingPage() {
  const data = readData();
  return <TeachingView data={data} />;
}
