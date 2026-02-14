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

const BLOCK_RENDERERS = Object.freeze({
  paragraph: ({ b, blockIdAttr, ctx }) => renderParagraphBlock({ b, blockIdAttr, ctx }),
  heading_1: ({ b, id, blockIdAttr, ctx }) => renderHeadingBlock({ b, id, blockIdAttr, ctx, renderBlocks }),
  heading_2: ({ b, id, blockIdAttr, ctx }) => renderHeadingBlock({ b, id, blockIdAttr, ctx, renderBlocks }),
  heading_3: ({ b, id, blockIdAttr, ctx }) => renderHeadingBlock({ b, id, blockIdAttr, ctx, renderBlocks }),
  toggle: ({ b, blockIdAttr, ctx }) => renderToggleBlock({ b, blockIdAttr, ctx, renderBlocks }),
  quote: ({ b, blockIdAttr, ctx }) => renderQuoteBlock({ b, blockIdAttr, ctx }),
  divider: ({ blockIdAttr }) => renderDividerBlock({ blockIdAttr }),
  equation: ({ b, blockIdAttr, ctx }) => renderEquationBlock({ b, blockIdAttr, ctx }),
  embed: ({ b, blockIdAttr, ctx }) => renderEmbedBlock({ b, blockIdAttr, ctx }),
  table_of_contents: ({ blockIdAttr, ctx }) => renderTableOfContentsBlock({ blockIdAttr, ctx }),
  table: ({ b, blockIdAttr, ctx }) => renderTableBlock({ b, blockIdAttr, ctx }),
  image: ({ b, id, blockIdAttr, ctx }) => renderImageBlock({ b, blockIdAttr, id, ctx }),
  code: ({ b, blockIdAttr, ctx }) => renderCodeBlock({ b, blockIdAttr, ctx }),
  callout: ({ b, blockIdAttr, ctx }) => renderCalloutBlock({ b, blockIdAttr, ctx, renderBlocks }),
  column_list: ({ b, blockIdAttr, ctx }) => renderColumnListBlock({ b, blockIdAttr, ctx, renderBlocks }),
  bulleted_list_item: ({ b, blockIdAttr, ctx }) => renderListItemBlock({ b, blockIdAttr, ctx, renderBlocks }),
  numbered_list_item: ({ b, blockIdAttr, ctx }) => renderListItemBlock({ b, blockIdAttr, ctx, renderBlocks }),
  child_database: ({ b, blockIdAttr, ctx }) => renderChildDatabaseBlock({ b, blockIdAttr, ctx }),
  child_page: ({ b, ctx }) => renderChildPageBlock({ b, ctx }),
});

export const BLOCK_RENDERER_TYPES = Object.freeze(Object.keys(BLOCK_RENDERERS));

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
  const render = BLOCK_RENDERERS[b.type];
  if (render) {
    return await render({ b, id, blockIdAttr, ctx });
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
