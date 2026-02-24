import "server-only";

import { readFile } from "node:fs/promises";
import { resolveRawHtmlFile } from "./server/content-files";
import { canonicalizeBlogHrefsInHtml } from "@/lib/routes/html-rewrite";
import { rewritePublicationsHtml } from "@/lib/publications/rewrite";
import { extractMainElementHtml, rewriteMainHtmlWithDom } from "@/lib/server/html-dom-rewrite";

function rewriteRawHtml(html: string): string {
  const domRewritten = rewriteMainHtmlWithDom(html);

  // Canonicalize blog URLs:
  // - Notion structure often nests posts under `/blog/list/<slug>` or `/list/<slug>`
  // - Public routes should always be `/blog/<slug>` (matches original site UX)
  const blogCanon = canonicalizeBlogHrefsInHtml(domRewritten);

  const out = rewritePublicationsHtml(blogCanon);

  return out
    .replaceAll("https://jinkunchen.com", "")
    .replaceAll("http://jinkunchen.com", "");
}

export async function loadRawMainHtml(slug: string): Promise<string> {
  const file = resolveRawHtmlFile(slug);
  const html = await readFile(file, "utf8");

  const main = extractMainElementHtml(html);
  if (!main) {
    throw new Error(`Could not find <main> in ${file}`);
  }

  return rewriteRawHtml(main);
}
