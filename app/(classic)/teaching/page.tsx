import type { Metadata } from "next";

import teachingData from "@/content/teaching.json";
import { ClassicPageShell } from "@/components/classic/classic-page-shell";
import { TeachingBlock } from "@/components/posts-mdx/teaching-block";
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
  const { title } = readData();
  // Same pattern as /news, /publications, /works (Phases 1c, 2a, 2b):
  // the page is just chrome around <TeachingBlock />.
  return (
    <ClassicPageShell
      title={title}
      className="super-content page__teaching parent-page__index"
      breadcrumbs={[
        { href: "/", label: "Home" },
        { href: "/teaching", label: title },
      ]}
    >
      <TeachingBlock />
    </ClassicPageShell>
  );
}
