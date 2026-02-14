import { compactId } from "../../lib/shared/route-utils.mjs";
import { richTextPlain } from "./render-rich-text.mjs";
import {
  renderGroupedListAtIndex,
  renderListItemBlock,
  renderUnknownChildrenBlock,
} from "./renderers/block-list.mjs";
import {
  renderCalloutBlock,
  renderCodeBlock,
  renderEmbedBlock,
  renderImageBlock,
} from "./renderers/block-media.mjs";
import { renderChildDatabaseBlock, renderChildPageBlock } from "./renderers/block-pages.mjs";
import {
  renderColumnListBlock,
  renderDividerBlock,
  renderEquationBlock,
  renderHeadingBlock,
  renderParagraphBlock,
  renderQuoteBlock,
  renderTableOfContentsBlock,
  renderToggleBlock,
} from "./renderers/block-structure.mjs";
import { renderTableBlock, renderTableLikeChildrenBlock } from "./renderers/block-table.mjs";

export function collectHeadings(blocks, out = []) {
  for (const b of blocks) {
    const id = compactId(b.id);
    if (b.type === "heading_1") out.push({ id, level: 1, text: richTextPlain(b.heading_1?.rich_text) });
    else if (b.type === "heading_2") out.push({ id, level: 2, text: richTextPlain(b.heading_2?.rich_text) });
    else if (b.type === "heading_3") out.push({ id, level: 3, text: richTextPlain(b.heading_3?.rich_text) });
    if (Array.isArray(b.__children) && b.__children.length) collectHeadings(b.__children, out);
  }
  return out.filter((h) => h.text && h.text.trim());
}

export async function renderBlocks(blocks, ctx) {
  let html = "";
  const arr = Array.isArray(blocks) ? blocks : [];

  for (let i = 0; i < arr.length; i++) {
    const b = arr[i];
    if (!b || !b.type) continue;

    const groupedList = await renderGroupedListAtIndex({
      arr,
      startIndex: i,
      ctx,
      renderBlock,
    });
    if (groupedList) {
      html += groupedList.html;
      i = groupedList.nextIndex;
      continue;
    }

    html += await renderBlock(b, ctx);
  }

  return html;
}

async function renderBlock(b, ctx) {
  const id = compactId(b.id);
  const blockIdAttr = `block-${id}`;

  if (b.type === "paragraph") {
    return renderParagraphBlock({ b, blockIdAttr, ctx });
  }

  if (b.type === "heading_1" || b.type === "heading_2" || b.type === "heading_3") {
    return renderHeadingBlock({ b, id, blockIdAttr, ctx, renderBlocks });
  }

  if (b.type === "toggle") {
    return renderToggleBlock({ b, blockIdAttr, ctx, renderBlocks });
  }

  if (b.type === "quote") {
    return renderQuoteBlock({ b, blockIdAttr, ctx });
  }

  if (b.type === "divider") return renderDividerBlock({ blockIdAttr });

  if (b.type === "equation") {
    return renderEquationBlock({ b, blockIdAttr, ctx });
  }

  if (b.type === "embed") {
    return renderEmbedBlock({ b, blockIdAttr, ctx });
  }

  if (b.type === "table_of_contents") {
    return renderTableOfContentsBlock({ blockIdAttr, ctx });
  }

  if (b.type === "table") {
    return renderTableBlock({ b, blockIdAttr, ctx });
  }

  if (b.type === "image") {
    return renderImageBlock({ b, blockIdAttr, id, ctx });
  }

  if (b.type === "code") {
    return renderCodeBlock({ b, blockIdAttr, ctx });
  }

  if (b.type === "callout") {
    return renderCalloutBlock({ b, blockIdAttr, ctx, renderBlocks });
  }

  if (b.type === "column_list") {
    return renderColumnListBlock({ b, blockIdAttr, ctx, renderBlocks });
  }

  if (b.type === "bulleted_list_item") {
    return renderListItemBlock({ b, blockIdAttr, ctx, renderBlocks });
  }

  if (b.type === "numbered_list_item") {
    return renderListItemBlock({ b, blockIdAttr, ctx, renderBlocks });
  }

  if (b.type === "child_database") {
    return renderChildDatabaseBlock({ b, blockIdAttr, ctx });
  }

  if (b.type === "child_page") {
    return renderChildPageBlock({ b, ctx });
  }

  const kids = Array.isArray(b.__children) ? b.__children : [];
  if (kids.length) {
    return renderUnknownChildrenBlock({
      kids,
      blockIdAttr,
      ctx,
      renderBlocks,
      renderTableLikeChildrenBlock,
    });
  }

  return "";
}
