import type { Metadata } from "next";

import newsData from "@/content/news.json";
import { ClassicPageShell } from "@/components/classic/classic-page-shell";
import { NewsBlock } from "@/components/posts-mdx/news-block";
import { normalizeNewsData } from "@/lib/site-admin/news-normalize";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { getSiteConfig } from "@/lib/site-config";
import type { SiteAdminNewsData } from "@/lib/site-admin/api-types";

export const dynamic = "force-static";

function readData(): SiteAdminNewsData {
  return normalizeNewsData(newsData);
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
  const { title } = readData();
  // The page is intentionally just chrome around <NewsBlock />: same
  // pipeline as embedding the block inside any other MDX document, no
  // duplicate rendering path. /news still owns the page title +
  // breadcrumbs because they're route-level concerns, not block-level.
  return (
    <ClassicPageShell
      title={title}
      className="super-content page__news parent-page__index"
      breadcrumbs={[
        { href: "/", label: "Home" },
        { href: "/news", label: title },
      ]}
    >
      <NewsBlock />
    </ClassicPageShell>
  );
}
