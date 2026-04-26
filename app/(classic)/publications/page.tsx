import type { Metadata } from "next";
import { notFound } from "next/navigation";

import JsonLdScript from "@/components/seo/json-ld-script";
import { PageView } from "@/components/posts-mdx/page-view";
import { getPageEntry, readPageSource } from "@/lib/pages/index";
import type { PublicationStructuredEntry } from "@/lib/seo/publications-items";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { buildPublicationsStructuredData } from "@/lib/seo/structured-data";
import { getSiteConfig } from "@/lib/site-config";

export const dynamic = "force-static";

const ENTRY_RE = /<PublicationsEntry\s+data='([^']*)'\s*\/>/g;

function unescapeJsonAttr(raw: string): string {
  // Mirrors the editor's serializer escape for `'` inside the
  // single-quoted `data` attr.
  return raw.replace(/\\u0027/g, "'");
}

async function readPublicationsEntries(): Promise<PublicationStructuredEntry[]> {
  const loaded = await readPageSource("publications");
  if (!loaded) return [];
  const body = loaded.source.replace(/^---[\s\S]*?---\s*/m, "");
  const out: PublicationStructuredEntry[] = [];
  let m: RegExpExecArray | null;
  while ((m = ENTRY_RE.exec(body)) !== null) {
    try {
      const parsed = JSON.parse(unescapeJsonAttr(m[1] ?? ""));
      if (parsed && typeof parsed === "object") {
        out.push(parsed as PublicationStructuredEntry);
      }
    } catch {
      // skip bad rows; keep page rendering
    }
  }
  return out;
}

export async function generateMetadata(): Promise<Metadata> {
  const cfg = getSiteConfig();
  const entry = await getPageEntry("publications");
  return buildPageMetadata({
    cfg,
    title: entry?.title ?? "Publications",
    description: entry?.description ?? cfg.seo.description,
    pathname: "/publications",
    type: "website",
  });
}

/** /publications keeps a custom route so we can emit the
 * publications-list JSON-LD alongside the rendered page. The body
 * itself comes from `content/pages/publications.mdx` via the standard
 * PageView so editing happens through the same MDX page editor every
 * other page uses. */
export default async function PublicationsPage() {
  const cfg = getSiteConfig();
  const entry = await getPageEntry("publications");
  const loaded = await readPageSource("publications");
  if (!entry || !loaded) notFound();
  const items = await readPublicationsEntries();
  const jsonLd = buildPublicationsStructuredData(cfg, {
    title: entry.title,
    description: entry.description ?? cfg.seo.description,
    items,
  });

  return (
    <>
      <JsonLdScript id="ld-publications" data={jsonLd} />
      <PageView entry={entry} source={loaded.source} />
    </>
  );
}
