import RawHtml from "@/components/raw-html";
import { loadRawMainHtml } from "@/lib/load-raw-main";
import { notFound } from "next/navigation";
import { readdir, stat } from "node:fs/promises";
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

async function listHtmlFilesRecIfExists(dir: string): Promise<string[]> {
  try {
    const st = await stat(dir);
    if (!st.isDirectory()) return [];
  } catch {
    return [];
  }
  return await listHtmlFilesRec(dir);
}

export async function generateStaticParams(): Promise<
  Array<{ slug: string[] }>
> {
  const roots = [
    path.join(process.cwd(), "content", "generated", "raw"),
    path.join(process.cwd(), "content", "raw"),
  ];

  const rels: string[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    const files = await listHtmlFilesRecIfExists(root);
    for (const abs of files) {
      const rel = path.relative(root, abs).replace(/\\/g, "/");
      if (!rel.endsWith(".html")) continue;
      const noExt = rel.slice(0, -".html".length);
      if (seen.has(noExt)) continue;
      seen.add(noExt);
      rels.push(noExt);
    }
  }

  return rels
    .filter((rel) => rel !== "index")
    // `/blog` is rendered by a dedicated route using a consistent template.
    .filter((rel) => rel !== "blog")
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

  let html: string;
  try {
    html = await loadRawMainHtml(slug.join("/"));
  } catch {
    notFound();
  }

  return <RawHtml html={html} />;
}
