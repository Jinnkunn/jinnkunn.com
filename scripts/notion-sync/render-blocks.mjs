import { compactId, slugify } from "../../lib/shared/route-utils.mjs";
import { escapeHtml } from "../../lib/shared/text-utils.mjs";
import { pageIconSvg, renderCollectionListItem } from "./render-collection.mjs";
import { renderKatexFromCtx, renderRichText, richTextPlain } from "./render-rich-text.mjs";

function pickCalloutBgClass(color) {
  const c = String(color || "default").replace(/_background$/, "");
  if (c === "default") return "bg-gray-light";
  return `bg-${c}-light`;
}

function embedSpinnerSvg() {
  return `<svg class="super-loader__spinner" viewBox="0 0 24 24"><defs><linearGradient x1="28.1542969%" y1="63.7402344%" x2="74.6289062%" y2="17.7832031%" id="linearGradient-1"><stop stop-color="rgba(164, 164, 164, 1)" offset="0%"></stop><stop stop-color="rgba(164, 164, 164, 0)" stop-opacity="0" offset="100%"></stop></linearGradient></defs><g id="Page-1" stroke="none" stroke-width="1" fill="none"><g transform="translate(-236.000000, -286.000000)"><g transform="translate(238.000000, 286.000000)"><circle id="Oval-2" stroke="url(#linearGradient-1)" stroke-width="4" cx="10" cy="12" r="10"></circle><path d="M10,2 C4.4771525,2 0,6.4771525 0,12" id="Oval-2" stroke="rgba(164, 164, 164, 1)" stroke-width="4"></path><rect id="Rectangle-1" fill="rgba(164, 164, 164, 1)" x="8" y="0" width="4" height="4" rx="8"></rect></g></g></g></g></svg>`;
}

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
    const e = b.embed ?? {};
    const url = String(e.url || "").trim();
    const caption = renderRichText(e.caption ?? [], ctx);
    const figcaption = caption ? `<figcaption class="notion-caption notion-semantic-string">${caption}</figcaption>` : "";

    let host = "";
    try {
      host = url ? new URL(url).hostname : "";
    } catch {
      // ignore invalid URL
    }

    const sandbox =
      "allow-scripts allow-popups allow-forms allow-same-origin allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation";

    const iframe = url
      ? `<iframe src="${escapeHtml(url)}" title="${escapeHtml(host || url)}" sandbox="${escapeHtml(
          sandbox,
        )}" allowfullscreen="" loading="lazy" frameborder="0"></iframe>`
      : "";

    return `<span id="${blockIdAttr}" class="notion-embed" style="display:block;width:100%"><span class="notion-embed__content" style="display:flex;width:100%"><span class="notion-embed__loader" style="display:inline-block">${embedSpinnerSvg()}</span><span class="notion-embed__container__wrapper" style="width:100%;display:flex;height:320px"><span style="width:100%;height:100%;display:block" class="notion-embed__container">${iframe}</span></span></span>${figcaption}</span>`;
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
    const t = b.table ?? {};
    const hasColumnHeader = Boolean(t.has_column_header);
    const hasRowHeader = Boolean(t.has_row_header);
    const rows = Array.isArray(b.__children) ? b.__children : [];

    let width = 0;
    const declared = Number(t.table_width ?? 0);
    if (Number.isFinite(declared) && declared > 0) width = declared;
    for (const r of rows) {
      const cells = r?.table_row?.cells;
      if (!Array.isArray(cells)) continue;
      width = Math.max(width, cells.length);
    }
    width = Math.max(1, width || 0);

    const rowHtml = rows
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

    const tableClasses = ["notion-table", hasColumnHeader ? "col-header" : "", hasRowHeader ? "row-header" : ""]
      .filter(Boolean)
      .join(" ");

    return `<div id="${blockIdAttr}" class="notion-table__wrapper"><table class="${escapeHtml(
      tableClasses,
    )}">${rowHtml}</table></div>`;
  }

  if (b.type === "image") {
    const img = b.image ?? {};
    const src = img.type === "external" ? img.external?.url : img.type === "file" ? img.file?.url : "";
    const stableName = id || `image-${Math.random().toString(16).slice(2)}`;
    const publicSrc = img.type === "file" && src && typeof ctx.downloadAsset === "function"
      ? await ctx.downloadAsset(src, stableName)
      : src;
    const caption = renderRichText(img.caption ?? [], ctx);
    const figcaption = caption ? `<figcaption class="notion-caption notion-semantic-string">${caption}</figcaption>` : "";
    const altText = escapeHtml(richTextPlain(img.caption ?? []) || "image");
    return `<div id="${blockIdAttr}" class="notion-image align-start page-width"><span data-full-size="${escapeHtml(
      publicSrc || "",
    )}" data-lightbox-src="${escapeHtml(
      publicSrc || "",
    )}" style="display:contents"><img alt="${altText}" loading="lazy" decoding="async" style="color: transparent; height: auto;" src="${escapeHtml(
      publicSrc || "",
    )}"></span>${figcaption}</div>`;
  }

  if (b.type === "code") {
    const code = b.code ?? {};
    const lang = String(code.language || "plain").toLowerCase();
    const codeText = richTextPlain(code.rich_text ?? []);
    const caption = renderRichText(code.caption ?? [], ctx);
    const figcaption = `<figcaption class="notion-caption notion-semantic-string">${caption}</figcaption>`;
    const copyIcon = `<svg class="notion-icon notion-icon__copy" viewBox="0 0 14 16"><path d="M2.404 15.322h5.701c1.26 0 1.887-.662 1.887-1.927V12.38h1.154c1.254 0 1.91-.662 1.91-1.928V5.555c0-.774-.158-1.266-.626-1.74L9.512.837C9.066.387 8.545.21 7.865.21H5.463c-1.254 0-1.91.662-1.91 1.928v1.084H2.404c-1.254 0-1.91.668-1.91 1.933v8.239c0 1.265.656 1.927 1.91 1.927zm7.588-6.62c0-.792-.1-1.161-.592-1.665L6.225 3.814c-.452-.462-.844-.58-1.5-.591V2.215c0-.533.28-.832.843-.832h2.38v2.883c0 .726.386 1.113 1.107 1.113h2.83v4.998c0 .539-.276.832-.844.832H9.992V8.701zm-.79-4.29c-.206 0-.288-.088-.288-.287V1.594l2.771 2.818H9.201zM2.503 14.15c-.563 0-.844-.293-.844-.832V5.232c0-.539.281-.837.85-.837h1.91v3.187c0 .85.416 1.26 1.26 1.26h3.14v4.476c0 .54-.28.832-.843.832H2.504zM5.79 7.816c-.24 0-.346-.105-.346-.345V4.547l3.223 3.27H5.791z"></path></svg>`;
    return `<div id="${blockIdAttr}" class="notion-code no-wrap"><button class="notion-code__copy-button">${copyIcon}Copy</button><pre class="language-${escapeHtml(
      lang,
    )}" tabindex="0"><code class="language-${escapeHtml(
      lang,
    )}">${escapeHtml(codeText)}</code></pre>${figcaption}</div>`;
  }

  if (b.type === "callout") {
    const c = b.callout ?? {};
    const bg = pickCalloutBgClass(c.color);
    const icon = c.icon?.type === "emoji" ? c.icon.emoji : "💡";
    const kids = Array.isArray(b.__children) ? b.__children : [];
    const text = renderRichText(c.rich_text ?? [], ctx);
    const body = kids.length ? await renderBlocks(kids, ctx) : "";
    return `<div id="${blockIdAttr}" class="notion-callout ${escapeHtml(
      bg,
    )} border"><div class="notion-callout__icon"><span class="notion-icon text" style="width:20px;height:20px;font-size:20px;fill:var(--color-text-default-light)">${escapeHtml(
      icon,
    )}</span></div><div class="notion-callout__content"><span class="notion-semantic-string">${text}</span>${body}</div></div>`;
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

  if (b.type === "child_page") {
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

  const kids = Array.isArray(b.__children) ? b.__children : [];
  if (kids.length) {
    const tableRows = kids.filter((k) => k?.type === "table_row" || k?.table_row);
    const looksLikeTable = tableRows.length > 0 && tableRows.length === kids.length;
    if (looksLikeTable) {
      let width = 0;
      for (const r of tableRows) {
        const cells = r?.table_row?.cells;
        if (!Array.isArray(cells)) continue;
        width = Math.max(width, cells.length);
      }
      width = Math.max(1, width || 0);

      const rowHtml = tableRows
        .map((r) => {
          const cells = Array.isArray(r?.table_row?.cells) ? r.table_row.cells : [];
          const tds = [];
          for (let col = 0; col < width; col++) {
            const cell = cells[col];
            const rich = Array.isArray(cell) ? cell : [];
            const content = rich.length ? renderRichText(rich, ctx) : "";
            const inner = content
              ? `<div class="notion-table__cell notion-semantic-string">${content}</div>`
              : `<div class="notion-table__cell notion-semantic-string"><div class="notion-table__empty-cell"></div></div>`;
            tds.push(`<td>${inner}</td>`);
          }
          return `<tr>${tds.join("")}</tr>`;
        })
        .join("");

      return `<div id="${blockIdAttr}" class="notion-table__wrapper"><table class="notion-table">${rowHtml}</table></div>`;
    }

    return `<div id="${blockIdAttr}" class="notion-unsupported">${await renderBlocks(kids, ctx)}</div>`;
  }

  return "";
}
