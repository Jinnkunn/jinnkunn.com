import { escapeHtml } from "../../lib/shared/text-utils.mjs";
import { renderBreadcrumbs } from "./breadcrumbs.mjs";
import { renderPagePropertiesFromPageObject } from "./page-properties.mjs";

export { renderDatabaseMain } from "./render-collection.mjs";
export { collectHeadings, renderBlocks } from "./render-blocks.mjs";

import { collectHeadings, renderBlocks } from "./render-blocks.mjs";

export async function renderPageMain(page, blocks, cfg, ctx) {
  const pageKey = page.routePath === "/" ? "index" : page.routePath.replace(/^\/+/, "").replace(/\//g, "-");
  const parentKey =
    page.parentRoutePath === "/"
      ? "index"
      : (page.parentRoutePath || "/").replace(/^\/+/, "").replace(/\//g, "-") || "index";

  const mainId = `page-${pageKey}`;
  const mainClass = `super-content page__${pageKey} parent-page__${parentKey}`;
  const breadcrumbs = renderBreadcrumbs(page, cfg, ctx);

  const headings = collectHeadings(blocks);
  const localCtx = { ...ctx, headings };

  const body = await renderBlocks(blocks, localCtx);
  const propsHtml = page.__page ? renderPagePropertiesFromPageObject(page.__page) : "";

  return `<main id="${escapeHtml(mainId)}" class="${escapeHtml(
    mainClass,
  )}">${breadcrumbs}<div class="notion-header page"><div class="notion-header__cover no-cover no-icon"></div><div class="notion-header__content max-width no-cover no-icon"><div class="notion-header__title-wrapper"><h1 class="notion-header__title">${escapeHtml(
    page.title,
  )}</h1></div></div></div><article id="block-${escapeHtml(
    pageKey,
  )}" class="notion-root max-width has-footer">${propsHtml}${body}</article></main>`;
}
