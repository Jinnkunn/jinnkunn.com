import { renderRichText } from "../render-rich-text.mjs";

export async function renderGroupedListAtIndex({ arr, startIndex, ctx, renderBlock }) {
  const first = arr[startIndex];
  const type = first?.type;
  if (type !== "bulleted_list_item" && type !== "numbered_list_item") return null;

  const items = [];
  let j = startIndex;
  while (j < arr.length && arr[j]?.type === type) {
    items.push(arr[j]);
    j++;
  }

  const openTag = type === "bulleted_list_item"
    ? `<ul class="notion-bulleted-list">`
    : `<ol type="1" class="notion-numbered-list">`;
  const closeTag = type === "bulleted_list_item" ? "</ul>" : "</ol>";

  let html = openTag;
  for (const it of items) html += await renderBlock(it, ctx);
  html += closeTag;

  return { html, nextIndex: j - 1 };
}

export async function renderListItemBlock({ b, blockIdAttr, ctx, renderBlocks }) {
  const kids = Array.isArray(b.__children) ? b.__children : [];
  const rich =
    b.type === "bulleted_list_item"
      ? b.bulleted_list_item?.rich_text ?? []
      : b.numbered_list_item?.rich_text ?? [];
  const inner = renderRichText(rich, ctx);
  const nested = kids.length ? await renderBlocks(kids, ctx) : "";
  return `<li id="${blockIdAttr}" class="notion-list-item notion-semantic-string">${inner}${nested}</li>`;
}

export async function renderUnknownChildrenBlock({
  kids,
  blockIdAttr,
  ctx,
  renderBlocks,
  renderTableLikeChildrenBlock,
}) {
  const tableLike = renderTableLikeChildrenBlock({ kids, blockIdAttr, ctx });
  if (tableLike) return tableLike;

  return `<div id="${blockIdAttr}" class="notion-unsupported">${await renderBlocks(kids, ctx)}</div>`;
}
