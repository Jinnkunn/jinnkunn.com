import { compactId } from "../../lib/shared/route-utils.mjs";
import { renderRichText, richTextPlain } from "./render-rich-text.mjs";
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

    if (b.type === "bulleted_list_item" || b.type === "numbered_list_item") {
      const type = b.type;
      const items = [];
      let j = i;
      while (j < arr.length && arr[j]?.type === type) {
        items.push(arr[j]);
        j++;
      }
      i = j - 1;
      if (type === "bulleted_list_item") {
        html += `<ul class="notion-bulleted-list">`;
        for (const it of items) html += await renderBlock(it, ctx);
        html += `</ul>`;
      } else {
        html += `<ol type="1" class="notion-numbered-list">`;
        for (const it of items) html += await renderBlock(it, ctx);
        html += `</ol>`;
      }
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
    const kids = Array.isArray(b.__children) ? b.__children : [];
    const inner = renderRichText(b.bulleted_list_item?.rich_text ?? [], ctx);
    const nested = kids.length ? await renderBlocks(kids, ctx) : "";
    return `<li id="${blockIdAttr}" class="notion-list-item notion-semantic-string">${inner}${nested}</li>`;
  }

  if (b.type === "numbered_list_item") {
    const kids = Array.isArray(b.__children) ? b.__children : [];
    const inner = renderRichText(b.numbered_list_item?.rich_text ?? [], ctx);
    const nested = kids.length ? await renderBlocks(kids, ctx) : "";
    return `<li id="${blockIdAttr}" class="notion-list-item notion-semantic-string">${inner}${nested}</li>`;
  }

  if (b.type === "child_database") {
    return renderChildDatabaseBlock({ b, blockIdAttr, ctx });
  }

  if (b.type === "child_page") {
    return renderChildPageBlock({ b, ctx });
  }

  const kids = Array.isArray(b.__children) ? b.__children : [];
  if (kids.length) {
    const tableLike = renderTableLikeChildrenBlock({ kids, blockIdAttr, ctx });
    if (tableLike) return tableLike;

    return `<div id="${blockIdAttr}" class="notion-unsupported">${await renderBlocks(kids, ctx)}</div>`;
  }

  return "";
}
