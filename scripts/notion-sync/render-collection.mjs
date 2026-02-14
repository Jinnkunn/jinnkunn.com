import { escapeHtml } from "../../lib/shared/text-utils.mjs";
import { canonicalizePublicHref } from "./route-model.mjs";
import { renderBreadcrumbs } from "./breadcrumbs.mjs";

export function pageIconSvg() {
  return `<svg class="notion-icon notion-icon__page" viewBox="0 0 16 16" width="18" height="18" style="width: 18px; height: 18px; font-size: 18px; fill: var(--color-text-default-light);"><path d="M4.35645 15.4678H11.6367C13.0996 15.4678 13.8584 14.6953 13.8584 13.2256V7.02539C13.8584 6.0752 13.7354 5.6377 13.1406 5.03613L9.55176 1.38574C8.97754 0.804688 8.50586 0.667969 7.65137 0.667969H4.35645C2.89355 0.667969 2.13477 1.44043 2.13477 2.91016V13.2256C2.13477 14.7021 2.89355 15.4678 4.35645 15.4678ZM4.46582 14.1279C3.80273 14.1279 3.47461 13.7793 3.47461 13.1436V2.99219C3.47461 2.36328 3.80273 2.00781 4.46582 2.00781H7.37793V5.75391C7.37793 6.73145 7.86328 7.20312 8.83398 7.20312H12.5186V13.1436C12.5186 13.7793 12.1836 14.1279 11.5205 14.1279H4.46582ZM8.95703 6.02734C8.67676 6.02734 8.56055 5.9043 8.56055 5.62402V2.19238L12.334 6.02734H8.95703ZM10.4336 9.00098H5.42969C5.16992 9.00098 4.98535 9.19238 4.98535 9.43164C4.98535 9.67773 5.16992 9.86914 5.42969 9.86914H10.4336C10.6797 9.86914 10.8643 9.67773 10.8643 9.43164C10.8643 9.19238 10.6797 9.00098 10.4336 9.00098ZM10.4336 11.2979H5.42969C5.16992 11.2979 4.98535 11.4893 4.98535 11.7354C4.98535 11.9746 5.16992 12.1592 5.42969 12.1592H10.4336C10.6797 12.1592 10.8643 11.9746 10.8643 11.7354C10.8643 11.4893 10.6797 11.2979 10.4336 11.2979Z"></path></svg>`;
}

export function renderCollectionListItem(item, { listKey }) {
  const slug = item.routePath.split("/").filter(Boolean).slice(-1)[0] || item.id.slice(0, 8);
  const blockId = `block-${listKey}-${slug}`;

  const date = item.__date;
  const propId = date?.id ? String(date.id).replace(/[^a-z0-9]/gi, "") : "";
  const dateClass = propId ? ` property-${escapeHtml(propId)}` : "";
  const dateHtml = date?.text
    ? `<div class="notion-property notion-property__date${dateClass} notion-collection-list__item-property notion-semantic-string no-wrap"><span class="date">${escapeHtml(
        date.text,
      )}</span></div>`
    : "";

  const href = canonicalizePublicHref(item.routePath);

  return `<div id="${escapeHtml(
    blockId,
  )}" class="notion-collection-list__item "><a id="${escapeHtml(
    blockId,
  )}" href="${escapeHtml(
    href,
  )}" class="notion-link notion-collection-list__item-anchor"></a><div class="notion-property notion-property__title notion-semantic-string"><div class="notion-property__title__icon-wrapper">${pageIconSvg()}</div>${escapeHtml(
    item.title,
  )}</div><div class="notion-collection-list__item-content">${dateHtml}</div></div>`;
}

export function renderDatabaseMain(db, cfg, ctx) {
  const pageKey = db.routePath === "/" ? "index" : db.routePath.replace(/^\/+/, "").replace(/\//g, "-");
  const parentKey =
    db.parentRoutePath === "/"
      ? "index"
      : (db.parentRoutePath || "/").replace(/^\/+/, "").replace(/\//g, "-") || "index";

  const mainId = `page-${pageKey}`;
  const mainClass = `super-content page__${pageKey} parent-page__${parentKey}`;
  const breadcrumbs = renderBreadcrumbs(db, cfg, ctx);

  const items = (db.children || [])
    .filter((x) => x.kind !== "database")
    .map((it) => renderCollectionListItem(it, { listKey: pageKey }))
    .join("");

  return `<main id="${escapeHtml(
    mainId,
  )}" class="${escapeHtml(
    mainClass,
  )}">${breadcrumbs}<div class="notion-header collection"><div class="notion-header__cover no-cover no-icon"></div><div class="notion-header__content no-cover no-icon"><div class="notion-header__title-wrapper" style="display:flex"><h1 class="notion-header__title">${escapeHtml(
    db.title,
  )}</h1></div><div class="notion-header__description notion-semantic-string"></div></div></div><article id="block-${escapeHtml(
    pageKey,
  )}" class="notion-root full-width has-footer notion-collection notion-collection-page collection-${escapeHtml(
    db.id,
  )}"><div class="notion-collection-list">${items}</div></article></main>`;
}
