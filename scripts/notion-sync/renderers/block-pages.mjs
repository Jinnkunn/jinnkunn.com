import { compactId, slugify } from "../../../lib/shared/route-utils.mjs";
import { escapeHtml } from "../../../lib/shared/text-utils.mjs";
import { pageIconSvg, renderCollectionListItem } from "../render-collection.mjs";

export function renderChildDatabaseBlock({ b, blockIdAttr, ctx }) {
  const dbId = compactId(b.id);
  const db = ctx.dbById?.get?.(dbId) ?? null;
  const title = String(b.child_database?.title ?? "").trim() || db?.title || "List";

  if (!db) {
    const href = ctx.routeByPageId.get(dbId) ?? "#";
    return `<a id="${blockIdAttr}" href="${escapeHtml(
      href,
    )}" class="notion-page"><span class="notion-page__icon">${pageIconSvg()}</span><span class="notion-page__title notion-semantic-string">${escapeHtml(
      title,
    )}</span></a>`;
  }

  const pageKey = db.routePath === "/" ? "index" : db.routePath.replace(/^\/+/, "").replace(/\//g, "-");
  const items = (db.children || [])
    .filter((x) => x.kind !== "database")
    .map((it) => renderCollectionListItem(it, { listKey: pageKey }))
    .join("");

  return `<div id="${blockIdAttr}" class="notion-collection inline"><div class="notion-collection__header-wrapper"><h3 class="notion-collection__header"><span class="notion-semantic-string">${escapeHtml(
    title,
  )}</span></h3></div><div class="notion-collection-list" role="list" aria-label="${escapeHtml(
    title,
  )}">${items}</div></div>`;
}

export function renderChildPageBlock({ b, ctx }) {
  const title = b.child_page?.title ?? "Untitled";
  const pageId = compactId(b.id);
  const href = ctx.routeByPageId.get(pageId) ?? "#";
  const idAttr = `block-${slugify(title) || pageId}`;
  return `<a id="${escapeHtml(
    idAttr,
  )}" href="${escapeHtml(href)}" class="notion-page"><span class="notion-page__icon">${pageIconSvg()}</span><span class="notion-page__title notion-semantic-string">${escapeHtml(
    title,
  )}</span></a>`;
}
