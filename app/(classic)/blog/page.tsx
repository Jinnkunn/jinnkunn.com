import type { Metadata } from "next";

import { BlogIndexView } from "@/components/blog-index/blog-index-view";
import JsonLdScript from "@/components/seo/json-ld-script";
import { getBlogIndex } from "@/lib/blog";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { buildBlogIndexStructuredData } from "@/lib/seo/structured-data";
import { getSiteConfig } from "@/lib/site-config";

export const dynamic = "force-static";

const BLOG_TITLE = "Blog";
const BLOG_INTRO_LINKS: Array<{ label: string; href: string }> = [
  { label: "RSS Feed", href: "/blog.rss" },
];

export async function generateMetadata(): Promise<Metadata> {
  const cfg = getSiteConfig();
  return buildPageMetadata({
    cfg,
    title: BLOG_TITLE,
    description: "Jinkun's Blog",
    pathname: "/blog",
    type: "website",
  });
}

export default async function BlogPage() {
  const cfg = getSiteConfig();
  const index = await getBlogIndex();
  const listEntries = index.filter((item) => item.kind === "list");
  const jsonLd = buildBlogIndexStructuredData(
    cfg,
    listEntries.map((item) => ({
      title: item.title,
      pathname: item.href,
      dateIso: item.dateIso,
    })),
  );
  return (
    <>
      <JsonLdScript id="ld-blog-index" data={jsonLd} />
      <BlogIndexView
        title={BLOG_TITLE}
        introLinks={BLOG_INTRO_LINKS}
        entries={listEntries}
      />
    </>
  );
}
