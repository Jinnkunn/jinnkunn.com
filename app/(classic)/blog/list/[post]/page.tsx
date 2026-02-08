import RawHtml from "@/components/raw-html";
import { loadRawMainHtml } from "@/lib/load-raw-main";
import { getBlogPostSlugs } from "@/lib/blog";
import { notFound } from "next/navigation";

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams(): Promise<Array<{ post: string }>> {
  const slugs = await getBlogPostSlugs();
  return slugs.map((post) => ({ post }));
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ post: string }>;
}) {
  const { post } = await params;

  let html: string;
  try {
    html = await loadRawMainHtml(`blog/list/${post}`);
  } catch {
    notFound();
  }

  return <RawHtml html={html} />;
}

