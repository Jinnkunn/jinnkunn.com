import type { Metadata } from "next";

import worksData from "@/content/works.json";
import { ClassicPageShell } from "@/components/classic/classic-page-shell";
import { WorksBlock } from "@/components/posts-mdx/works-block";
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
  const { title } = readData();
  // Same pattern as /news (e626a13) and /publications (44fa270): the
  // page is just chrome around <WorksBlock />, which owns rendering and
  // is shared with anyone who embeds it inside an MDX document.
  return (
    <ClassicPageShell
      title={title}
      className="super-content page__works parent-page__index"
      breadcrumbs={[
        { href: "/", label: "Home" },
        { href: "/works", label: title },
      ]}
    >
      <WorksBlock />
    </ClassicPageShell>
  );
}
