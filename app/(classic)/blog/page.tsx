import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BlogIndexView } from "@/components/blog-index/blog-index-view";
import JsonLdScript from "@/components/seo/json-ld-script";
import { getBlogIndex } from "@/lib/blog";
import { loadRawMainHtml } from "@/lib/load-raw-main";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { buildBlogIndexStructuredData } from "@/lib/seo/structured-data";
import { getSiteConfig } from "@/lib/site-config";

export const dynamic = "force-static";

export async function generateMetadata(): Promise<Metadata> {
  const cfg = getSiteConfig();
  return buildPageMetadata({
    cfg,
    title: "Blog",
    description: "Jinkun's Blog",
    pathname: "/blog",
    type: "website",
  });
}

function extractTitleFromBlogMain(html: string): string {
  const m = html.match(/class="notion-header__title">([\s\S]*?)<\/h1>/i);
  if (!m) return "Blog";
  return m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || "Blog";
}

function extractIntroLinksFromBlogMain(
  html: string,
): Array<{ label: string; href: string }> {
  const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (!articleMatch) return [];
  const article = articleMatch[1];
  const firstPara = article.match(
    /<p\b[^>]*class="[^"]*notion-text[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
  );
  if (!firstPara) return [];
  const inner = firstPara[1];
  const out: Array<{ label: string; href: string }> = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(inner)) !== null) {
    const href = m[1].trim();
    if (!href) continue;
    if (seen.has(href)) continue;
    const label = m[2]
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    if (!label) continue;
    seen.add(href);
    out.push({ label, href });
  }
  return out;
}

export default async function BlogPage() {
  const cfg = getSiteConfig();
  let html = "";
  try {
    html = await loadRawMainHtml("blog");
  } catch {
    notFound();
  }
  const title = extractTitleFromBlogMain(html);
  const introLinks = extractIntroLinksFromBlogMain(html);
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
      <BlogIndexView title={title} introLinks={introLinks} entries={listEntries} />
    </>
  );
}
