import RawHtml from "@/components/raw-html";
import { getBlogPostSlugs, parseBlogMetaFromMain } from "@/lib/blog";
import { loadRawMainHtml } from "@/lib/load-raw-main";
import { escapeHtml } from "@/lib/shared/text-utils";
import type { Metadata } from "next";

export const dynamic = "force-static";
export const dynamicParams = false;

function extractTitleFromMainHtml(mainHtml: string): string {
  const m = String(mainHtml || "").match(
    /<h1\b[^>]*class="notion-header__title"[^>]*>([\s\S]*?)<\/h1>/i,
  );
  if (!m) return "Blog";
  // Title is plain text in our generated HTML (already escaped), but keep it safe.
  const raw = m[1].replace(/<[^>]+>/g, "").trim();
  return raw || "Blog";
}

function buildBreadcrumbsHtml({ title, slug }: { title: string; slug: string }): string {
  const safeTitle = escapeHtml(title);
  const safeSlug = escapeHtml(slug);
  return `<div class="super-navbar__breadcrumbs"><div class="notion-breadcrumb"><a href="/" class="notion-link notion-breadcrumb__item"><div class="notion-navbar__title notion-breadcrumb__title">Home</div></a><span class="notion-breadcrumb__divider">/</span><a href="/blog" class="notion-link notion-breadcrumb__item"><div class="notion-navbar__title notion-breadcrumb__title">Blog</div></a><span class="notion-breadcrumb__divider">/</span><a href="/blog/${safeSlug}" class="notion-link notion-breadcrumb__item"><div class="notion-navbar__title notion-breadcrumb__title">${safeTitle}</div></a></div></div>`;
}

function rewriteBlogPostMainHtml(input: string, { slug }: { slug: string }): string {
  let out = input;

  // Replace the whole breadcrumb block so we always get:
  //   Home / Blog / <post title>
  // This avoids depending on the Notion hierarchy (which may include an
  // intermediate "List" database) and matches the original site's UX.
  const title = extractTitleFromMainHtml(out);
  const breadcrumbs = buildBreadcrumbsHtml({ title, slug });
  out = out.replace(
    /<div class="super-navbar__breadcrumbs"[^>]*>[\s\S]*?<\/div>\s*<\/div>/i,
    breadcrumbs,
  );

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
