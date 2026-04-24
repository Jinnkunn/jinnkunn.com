import type { Metadata } from "next";

import newsData from "@/content/news.json";
import { NewsView } from "@/components/news/news-view";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { getSiteConfig } from "@/lib/site-config";
import type { SiteAdminNewsData } from "@/lib/site-admin/api-types";

export const dynamic = "force-static";

function readData(): SiteAdminNewsData {
  const d = newsData as Partial<SiteAdminNewsData>;
  return {
    title: d.title || "News",
    description: d.description,
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
    pathname: "/news",
    type: "website",
  });
}

export default async function NewsPage() {
  const data = readData();
  return <NewsView data={data} />;
}
