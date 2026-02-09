import RawHtml from "@/components/raw-html";
import { getBlogIndex } from "@/lib/blog";
import { loadRawMainHtml } from "@/lib/load-raw-main";
import { getRoutesManifest } from "@/lib/routes-manifest";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Blog",
  description: "Jinkun's Blog",
};

async function loadNotionBlogMain(): Promise<string> {
  // Prefer canonical /blog.
  try {
    return await loadRawMainHtml("blog");
  } catch {
    // Fallback: find the Notion page titled "Blog" and use its route.
    const items = getRoutesManifest();
    const cand = items.find((it) => it.kind === "page" && it.title.trim().toLowerCase() === "blog");
    if (cand?.routePath) {
      const route = cand.routePath.replace(/^\/+/, "");
      return await loadRawMainHtml(route || "index");
    }
    throw new Error("Missing blog.html");
  }
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

function findBalancedDivEnd(html: string, startIdx: number): number | null {
  let depth = 0;
  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = startIdx;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[0];
    if (tag.startsWith("</")) depth -= 1;
    else depth += 1;
    if (depth === 0) return re.lastIndex;
  }
  return null;
}

function buildBlogListHtml(items: Awaited<ReturnType<typeof getBlogIndex>>): string {
  const iconSvg =
    '<svg class="notion-icon notion-icon__page" viewBox="0 0 16 16" width="18" height="18" style="width: 18px; height: 18px; font-size: 18px; fill: var(--color-text-default-light);"><path d="M4.35645 15.4678H11.6367C13.0996 15.4678 13.8584 14.6953 13.8584 13.2256V7.02539C13.8584 6.0752 13.7354 5.6377 13.1406 5.03613L9.55176 1.38574C8.97754 0.804688 8.50586 0.667969 7.65137 0.667969H4.35645C2.89355 0.667969 2.13477 1.44043 2.13477 2.91016V13.2256C2.13477 14.7021 2.89355 15.4678 4.35645 15.4678ZM4.46582 14.1279C3.80273 14.1279 3.47461 13.7793 3.47461 13.1436V2.99219C3.47461 2.36328 3.80273 2.00781 4.46582 2.00781H7.37793V5.75391C7.37793 6.73145 7.86328 7.20312 8.83398 7.20312H12.5186V13.1436C12.5186 13.7793 12.1836 14.1279 11.5205 14.1279H4.46582ZM8.95703 6.02734C8.67676 6.02734 8.56055 5.9043 8.56055 5.62402V2.19238L12.334 6.02734H8.95703ZM10.4336 9.00098H5.42969C5.16992 9.00098 4.98535 9.19238 4.98535 9.43164C4.98535 9.67773 5.16992 9.86914 5.42969 9.86914H10.4336C10.6797 9.86914 10.8643 9.67773 10.8643 9.43164C10.8643 9.19238 10.6797 9.00098 10.4336 9.00098ZM10.4336 11.2979H5.42969C5.16992 11.2979 4.98535 11.4893 4.98535 11.7354C4.98535 11.9746 5.16992 12.1592 5.42969 12.1592H10.4336C10.6797 12.1592 10.8643 11.9746 10.8643 11.7354C10.8643 11.4893 10.6797 11.2979 10.4336 11.2979Z"></path></svg>';

  const rows = items
    .filter((it) => it.kind === "list")
    .map((it) => {
      const id = `block-list-${escapeHtml(it.slug)}`;
      const href = escapeHtml(it.href);
      const title = escapeHtml(it.title);
      const dateText = it.dateText ? escapeHtml(it.dateText) : "";
      return (
        `<div id="${id}" class="notion-collection-list__item ">` +
        `<a id="${id}" href="${href}" class="notion-link notion-collection-list__item-anchor"></a>` +
        `<div class="notion-property notion-property__title notion-semantic-string">` +
        `<div class="notion-property__title__icon-wrapper">${iconSvg}</div>` +
        `${title}` +
        `</div>` +
        `<div class="notion-collection-list__item-content">` +
        `<div class="notion-property notion-property__date notion-collection-list__item-property notion-semantic-string no-wrap">` +
        (dateText ? `<span class="date">${dateText}</span>` : "") +
        `</div>` +
        `</div>` +
        `</div>`
      );
    })
    .join("");

  const collectionAnchorId = "blog-list";
  return (
    `<div class="notion-collection inline">` +
    `<div class="notion-collection__header-wrapper">` +
    `<h3 class="notion-collection__header">` +
    `<a class="notion-anchor" href="#${collectionAnchorId}"></a>` +
    `<span class="notion-semantic-string">List</span>` +
    `</h3>` +
    `</div>` +
    `<div id="${collectionAnchorId}" class="notion-collection-list">` +
    `${rows}` +
    `</div>` +
    `</div>`
  );
}

function rewriteBlogIndexMainHtml(mainHtml: string, listHtml: string): string {
  const marker = 'class="notion-collection inline"';
  const idx = mainHtml.indexOf(marker);
  if (idx === -1) {
    return mainHtml.replace(/<\/article>\s*<\/main>/i, `${listHtml}</article></main>`);
  }
  const start = mainHtml.lastIndexOf("<div", idx);
  if (start === -1) return mainHtml;
  const end = findBalancedDivEnd(mainHtml, start);
  if (!end) return mainHtml;
  return mainHtml.slice(0, start) + listHtml + mainHtml.slice(end);
}

export default async function BlogPage() {
  let html = "";
  try {
    html = await loadNotionBlogMain();
  } catch {
    notFound();
  }
  const index = await getBlogIndex();
  const listHtml = buildBlogListHtml(index);
  const rewritten = rewriteBlogIndexMainHtml(html, listHtml);
  return <RawHtml html={rewritten} />;
}
