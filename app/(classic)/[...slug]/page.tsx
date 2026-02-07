import RawHtml from "@/components/raw-html";
import { loadRawMainHtml } from "@/lib/load-raw-main";
import { notFound } from "next/navigation";
import { readdir } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-static";
export const dynamicParams = false;

async function listHtmlFilesRec(dir: string): Promise<string[]> {
  const ents = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const ent of ents) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await listHtmlFilesRec(p)));
      continue;
    }
    if (ent.isFile() && ent.name.endsWith(".html")) out.push(p);
  }
  return out;
}

export async function generateStaticParams(): Promise<
  Array<{ slug: string[] }>
> {
  const root = path.join(process.cwd(), "content", "raw");
  const files = await listHtmlFilesRec(root);

  return files
    .map((abs) => path.relative(root, abs))
    .map((rel) => rel.replace(/\\/g, "/"))
    .filter((rel) => rel.endsWith(".html"))
    .map((rel) => rel.slice(0, -".html".length))
    .filter((rel) => rel !== "index")
    // Blog posts are rendered by a dedicated route using a consistent template.
    .filter((rel) => !rel.startsWith("blog/list/"))
    .map((rel) => ({ slug: rel.split("/").filter(Boolean) }));
}

export default async function SlugPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;

  try {
    const html = await loadRawMainHtml(slug.join("/"));
    return <RawHtml html={html} />;
  } catch {
    notFound();
  }
}
