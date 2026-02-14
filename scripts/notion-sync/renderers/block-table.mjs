import { escapeHtml } from "../../../lib/shared/text-utils.mjs";
import { renderRichText } from "../render-rich-text.mjs";

function computeTableWidth(rows, declaredWidth) {
  let width = 0;
  const declared = Number(declaredWidth ?? 0);
  if (Number.isFinite(declared) && declared > 0) width = declared;

  for (const r of rows) {
    const cells = r?.table_row?.cells;
    if (!Array.isArray(cells)) continue;
    width = Math.max(width, cells.length);
  }

  return Math.max(1, width || 0);
}

function renderTableRows({ rows, width, ctx, hasColumnHeader = false, hasRowHeader = false }) {
  return rows
    .filter((r) => r?.type === "table_row" || r?.table_row)
    .map((r, rowIdx) => {
      const cells = Array.isArray(r?.table_row?.cells) ? r.table_row.cells : [];
      const tds = [];
      for (let col = 0; col < width; col++) {
        const cell = cells[col];
        const rich = Array.isArray(cell) ? cell : [];
        const content = rich.length ? renderRichText(rich, ctx) : "";
        const inner = content
          ? `<div class="notion-table__cell notion-semantic-string">${content}</div>`
          : `<div class="notion-table__cell notion-semantic-string"><div class="notion-table__empty-cell"></div></div>`;

        const isHeader = (hasColumnHeader && rowIdx === 0) || (hasRowHeader && col === 0);
        const tag = isHeader ? "th" : "td";
        tds.push(`<${tag}>${inner}</${tag}>`);
      }
      return `<tr>${tds.join("")}</tr>`;
    })
    .join("");
}

export function renderTableBlock({ b, blockIdAttr, ctx }) {
  const t = b.table ?? {};
  const hasColumnHeader = Boolean(t.has_column_header);
  const hasRowHeader = Boolean(t.has_row_header);
  const rows = Array.isArray(b.__children) ? b.__children : [];
  const width = computeTableWidth(rows, t.table_width);

  const rowHtml = renderTableRows({
    rows,
    width,
    ctx,
    hasColumnHeader,
    hasRowHeader,
  });

  const tableClasses = ["notion-table", hasColumnHeader ? "col-header" : "", hasRowHeader ? "row-header" : ""]
    .filter(Boolean)
    .join(" ");

  return `<div id="${blockIdAttr}" class="notion-table__wrapper"><table class="${escapeHtml(
    tableClasses,
  )}">${rowHtml}</table></div>`;
}

export function renderTableLikeChildrenBlock({ kids, blockIdAttr, ctx }) {
  const tableRows = kids.filter((k) => k?.type === "table_row" || k?.table_row);
  const looksLikeTable = tableRows.length > 0 && tableRows.length === kids.length;
  if (!looksLikeTable) return "";

  const width = computeTableWidth(tableRows, 0);
  const rowHtml = renderTableRows({
    rows: tableRows,
    width,
    ctx,
  });

  return `<div id="${blockIdAttr}" class="notion-table__wrapper"><table class="notion-table">${rowHtml}</table></div>`;
}
