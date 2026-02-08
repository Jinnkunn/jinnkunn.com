import RawHtml from "@/components/raw-html";
import { getBlogPostSlugs, parseBlogMetaFromMain } from "@/lib/blog";
import { loadRawMainHtml } from "@/lib/load-raw-main";
import type { Metadata } from "next";

export const dynamic = "force-static";
export const dynamicParams = false;

function rewriteBlogPostMainHtml(input: string, { slug }: { slug: string }): string {
  let out = input;

  // Remove the middle breadcrumb "List" (the one that links to /blog/list).
  out = out.replace(
    /<span class="notion-breadcrumb__divider">\/\s*<\/span>\s*<a\b[^>]*\bhref="\/blog\/list"[^>]*>[\s\S]*?<\/a>/i,
    "",
  );

  // Keep the last crumb link consistent with the canonical route.
  out = out.replaceAll(`href="/blog/list/${slug}"`, `href="/blog/${slug}"`);

  return out;
}

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  const slugs = await getBlogPostSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const main = await loadRawMainHtml(`blog/list/${slug}`);
    const meta = parseBlogMetaFromMain(main);
    return { title: `${meta.title} | Blog` };
  } catch {
    return { title: "Blog" };
  }
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const raw = await loadRawMainHtml(`blog/list/${slug}`);
  const rewritten = rewriteBlogPostMainHtml(raw, { slug });
  return <RawHtml html={rewritten} />;
}

