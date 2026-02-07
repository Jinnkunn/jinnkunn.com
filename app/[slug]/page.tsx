import RawHtml from "@/components/raw-html";
import { loadRawMainHtml } from "@/lib/load-raw-main";
import { notFound } from "next/navigation";
import { readdir } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  const dir = path.join(process.cwd(), "content", "raw");
  const files = await readdir(dir);
  return files
    .filter((f) => f.endsWith(".html"))
    .map((f) => f.slice(0, -".html".length))
    .filter((slug) => slug !== "index")
    .map((slug) => ({ slug }));
}

export default async function SlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  try {
    const html = await loadRawMainHtml(slug);
    return <RawHtml html={html} />;
  } catch {
    notFound();
  }
}
