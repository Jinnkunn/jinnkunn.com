import { canonicalizeBlogHrefsInHtml as canonicalizeBlogHrefsInHtmlRaw } from "./html-rewrite.mjs";

export function canonicalizeBlogHrefsInHtml(html: string): string {
  return canonicalizeBlogHrefsInHtmlRaw(html);
}
