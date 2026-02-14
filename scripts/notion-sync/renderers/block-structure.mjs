import { compactId } from "../../../lib/shared/route-utils.mjs";
import { escapeHtml } from "../../../lib/shared/text-utils.mjs";
import { renderKatexFromCtx, renderRichText } from "../render-rich-text.mjs";

export function renderParagraphBlock({ b, blockIdAttr, ctx }) {
  const rich = b.paragraph?.rich_text ?? [];
  if (!rich.length) return `<div id="${blockIdAttr}" class="notion-text"></div>`;
  return `<p id="${blockIdAttr}" class="notion-text notion-text__content notion-semantic-string">${renderRichText(
    rich,
    ctx,
  )}</p>`;
}

export async function renderHeadingBlock({ b, id, blockIdAttr, ctx, renderBlocks }) {
  const h = b[b.type] ?? {};
  const level = b.type === "heading_1" ? 1 : b.type === "heading_2" ? 2 : 3;
  const tag = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
  const isToggleable = Boolean(h.is_toggleable);

  if (isToggleable) {
    const toggleClass = `notion-toggle-heading-${level}`;
    const kids = Array.isArray(b.__children) ? b.__children : [];
    return `<div id="${blockIdAttr}" class="notion-toggle closed ${toggleClass}"><div class="notion-toggle__summary"><div class="notion-toggle__trigger"><div class="notion-toggle__trigger_icon"><span>‣</span></div></div><span class="notion-heading__anchor" id="${id}"></span><${tag} id="${blockIdAttr}" class="notion-heading toggle notion-semantic-string">${renderRichText(
      h.rich_text ?? [],
      ctx,
    )}</${tag}></div><div class="notion-toggle__content">${await renderBlocks(kids, ctx)}</div></div>`;
  }

  return `<span class="notion-heading__anchor" id="${id}"></span><${tag} id="${blockIdAttr}" class="notion-heading notion-semantic-string">${renderRichText(
    h.rich_text ?? [],
    ctx,
  )}</${tag}>`;
}

export async function renderToggleBlock({ b, blockIdAttr, ctx, renderBlocks }) {
  const kids = Array.isArray(b.__children) ? b.__children : [];
  return `<div id="${blockIdAttr}" class="notion-toggle closed"><div class="notion-toggle__summary"><div class="notion-toggle__trigger"><div class="notion-toggle__trigger_icon"><span>‣</span></div></div><span class="notion-semantic-string">${renderRichText(
    b.toggle?.rich_text ?? [],
    ctx,
  )}</span></div><div class="notion-toggle__content">${await renderBlocks(kids, ctx)}</div></div>`;
}

export function renderQuoteBlock({ b, blockIdAttr, ctx }) {
  return `<blockquote id="${blockIdAttr}" class="notion-quote"><span class="notion-semantic-string">${renderRichText(
    b.quote?.rich_text ?? [],
    ctx,
  )}</span></blockquote>`;
}

export function renderDividerBlock({ blockIdAttr }) {
  return `<div id="${blockIdAttr}" class="notion-divider"></div>`;
}

export function renderEquationBlock({ b, blockIdAttr, ctx }) {
  const expr = b.equation?.expression ?? "";
  return `<span id="${blockIdAttr}" class="notion-equation notion-equation__block">${renderKatexFromCtx(
    expr,
    { displayMode: true },
    ctx,
  )}</span>`;
}

export function renderTableOfContentsBlock({ blockIdAttr, ctx }) {
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

export async function renderColumnListBlock({ b, blockIdAttr, ctx, renderBlocks }) {
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
