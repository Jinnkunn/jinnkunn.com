import "server-only";
import { getPageEntry } from "@/lib/pages/index";
import type { PageEntry } from "@jinnkunn/content-core/pages";
import { compilePostMdx } from "@/lib/posts/compile";
import { postMdxComponents } from "./components";
import { PageArticle, type DocumentBreadcrumb } from "./document-layouts";

async function buildBreadcrumbTrail(entry: PageEntry): Promise<DocumentBreadcrumb[]> {
  const segments = entry.slug.split("/").filter(Boolean);
  const parentSlugs = segments.slice(0, -1).map((_, i) => segments.slice(0, i + 1).join("/"));
  const parents = await Promise.all(parentSlugs.map((slug) => getPageEntry(slug)));
  return [
    ...parentSlugs.map((slug, i) => ({ label: parents[i]?.title || segments[i], href: parents[i] ? `/${slug}` : null })),
    { label: entry.title, href: `/${entry.slug}` },
  ];
}

export async function PageView({ entry, source }: { entry: PageEntry; source: string }) {
  const [{ Content }, trail] = await Promise.all([compilePostMdx(source), buildBreadcrumbTrail(entry)]);
  return <PageArticle entry={entry} trail={trail}><Content components={postMdxComponents} /></PageArticle>;
}
