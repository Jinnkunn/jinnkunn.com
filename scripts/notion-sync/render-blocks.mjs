import { compactId } from "../../lib/shared/route-utils.mjs";
import { escapeHtml } from "../../lib/shared/text-utils.mjs";
import { renderKatexFromCtx, renderRichText, richTextPlain } from "./render-rich-text.mjs";
import {
  renderCalloutBlock,
  renderCodeBlock,
  renderEmbedBlock,
  renderImageBlock,
} from "./renderers/block-media.mjs";
import { renderChildDatabaseBlock, renderChildPageBlock } from "./renderers/block-pages.mjs";
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
    const rich = b.paragraph?.rich_text ?? [];
    if (!rich.length) return `<div id="${blockIdAttr}" class="notion-text"></div>`;
    return `<p id="${blockIdAttr}" class="notion-text notion-text__content notion-semantic-string">${renderRichText(rich, ctx)}</p>`;
  }

  if (b.type === "heading_1" || b.type === "heading_2" || b.type === "heading_3") {
    const h = b[b.type] ?? {};
    const level = b.type === "heading_1" ? 1 : b.type === "heading_2" ? 2 : 3;
    const tag = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
    const isToggleable = Boolean(h.is_toggleable);

    if (isToggleable) {
      const toggleClass = `notion-toggle-heading-${level}`;
      const kids = Array.isArray(b.__children) ? b.__children : [];
      return `<div id="${blockIdAttr}" class="notion-toggle closed ${toggleClass}"><div class="notion-toggle__summary"><div class="notion-toggle__trigger"><div class="notion-toggle__trigger_icon"><span>‣</span></div></div><span class="notion-heading__anchor" id="${id}"></span><${tag} id="${blockIdAttr}" class="notion-heading toggle notion-semantic-string">${renderRichText(h.rich_text ?? [], ctx)}</${tag}></div><div class="notion-toggle__content">${await renderBlocks(kids, ctx)}</div></div>`;
    }

    return `<span class="notion-heading__anchor" id="${id}"></span><${tag} id="${blockIdAttr}" class="notion-heading notion-semantic-string">${renderRichText(h.rich_text ?? [], ctx)}</${tag}>`;
  }

  if (b.type === "toggle") {
    const kids = Array.isArray(b.__children) ? b.__children : [];
    return `<div id="${blockIdAttr}" class="notion-toggle closed"><div class="notion-toggle__summary"><div class="notion-toggle__trigger"><div class="notion-toggle__trigger_icon"><span>‣</span></div></div><span class="notion-semantic-string">${renderRichText(
      b.toggle?.rich_text ?? [],
      ctx,
    )}</span></div><div class="notion-toggle__content">${await renderBlocks(kids, ctx)}</div></div>`;
  }

  if (b.type === "quote") {
    return `<blockquote id="${blockIdAttr}" class="notion-quote"><span class="notion-semantic-string">${renderRichText(
      b.quote?.rich_text ?? [],
      ctx,
    )}</span></blockquote>`;
  }

  if (b.type === "divider") return `<div id="${blockIdAttr}" class="notion-divider"></div>`;

  if (b.type === "equation") {
    const expr = b.equation?.expression ?? "";
    return `<span id="${blockIdAttr}" class="notion-equation notion-equation__block">${renderKatexFromCtx(
      expr,
      { displayMode: true },
      ctx,
    )}</span>`;
  }

  if (b.type === "embed") {
    return renderEmbedBlock({ b, blockIdAttr, ctx });
  }

  if (b.type === "table_of_contents") {
    const headings = ctx.headings ?? [];
    const items = headings
      .slice(0, 50)
      .map((h) => {
        const indent = h.level === 3 ? 12 : 0;
        return `<li class="notion-table-of-contents__item"><a class="notion-link" href="#block-${escapeHtml(
          h.id,
        )}"><div class="notion-semantic-string" style="margin-inline-start: ${indent}px;">${escapeHtml(
          h.text,
        )}</div></a></li>`;
      })
      .join("");
    return `<ul id="${blockIdAttr}" class="notion-table-of-contents color-gray">${items}</ul>`;
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
    const cols = Array.isArray(b.__children) ? b.__children : [];
    const n = cols.length || 1;

    const widths = [];
    let remaining = 1;
    for (let i = 0; i < cols.length; i++) {
      if (i === cols.length - 1) {
        widths.push(remaining);
        break;
      }
      const ratioRaw = Number(cols[i]?.column?.width_ratio);
      const ratio = Number.isFinite(ratioRaw) && ratioRaw > 0 ? ratioRaw : 1;
      const defaultWidth = remaining / (cols.length - i);
      let w = defaultWidth * ratio;
      w = Math.max(0, Math.min(remaining, w));
      widths.push(w);
      remaining -= w;
    }

    let inner = `<div id="${blockIdAttr}" class="notion-column-list">`;
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      const colId = compactId(col.id);
      const frac = widths[i] ?? 1 / n;
      const width = `(100% - var(--column-spacing) * ${n - 1}) * ${frac}`;
      const margin = i === 0 ? "" : `;margin-inline-start:var(--column-spacing)`;
      const colKids = Array.isArray(col.__children) ? col.__children : [];
      inner += `<div id="block-${colId}" class="notion-column" style="width:calc(${width})${margin}">${await renderBlocks(
        colKids,
        ctx,
      )}</div>`;
    }
    inner += `</div>`;
    return inner;
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
