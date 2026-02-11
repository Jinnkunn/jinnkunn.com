import { compactId, slugify } from "../../lib/shared/route-utils.mjs";
import { escapeHtml } from "../../lib/shared/text-utils.mjs";
import { canonicalizePublicHref } from "./route-model.mjs";
import { renderBreadcrumbs } from "./breadcrumbs.mjs";

function pickCalloutBgClass(color) {
  const c = String(color || "default").replace(/_background$/, "");
  if (c === "default") return "bg-gray-light";
  return `bg-${c}-light`;
}

function pageIconSvg() {
  // Matches the common "page" icon used by Super.
  return `<svg class="notion-icon notion-icon__page" viewBox="0 0 16 16" width="18" height="18" style="width: 18px; height: 18px; font-size: 18px; fill: var(--color-text-default-light);"><path d="M4.35645 15.4678H11.6367C13.0996 15.4678 13.8584 14.6953 13.8584 13.2256V7.02539C13.8584 6.0752 13.7354 5.6377 13.1406 5.03613L9.55176 1.38574C8.97754 0.804688 8.50586 0.667969 7.65137 0.667969H4.35645C2.89355 0.667969 2.13477 1.44043 2.13477 2.91016V13.2256C2.13477 14.7021 2.89355 15.4678 4.35645 15.4678ZM4.46582 14.1279C3.80273 14.1279 3.47461 13.7793 3.47461 13.1436V2.99219C3.47461 2.36328 3.80273 2.00781 4.46582 2.00781H7.37793V5.75391C7.37793 6.73145 7.86328 7.20312 8.83398 7.20312H12.5186V13.1436C12.5186 13.7793 12.1836 14.1279 11.5205 14.1279H4.46582ZM8.95703 6.02734C8.67676 6.02734 8.56055 5.9043 8.56055 5.62402V2.19238L12.334 6.02734H8.95703ZM10.4336 9.00098H5.42969C5.16992 9.00098 4.98535 9.19238 4.98535 9.43164C4.98535 9.67773 5.16992 9.86914 5.42969 9.86914H10.4336C10.6797 9.86914 10.8643 9.67773 10.8643 9.43164C10.8643 9.19238 10.6797 9.00098 10.4336 9.00098ZM10.4336 11.2979H5.42969C5.16992 11.2979 4.98535 11.4893 4.98535 11.7354C4.98535 11.9746 5.16992 12.1592 5.42969 12.1592H10.4336C10.6797 12.1592 10.8643 11.9746 10.8643 11.7354C10.8643 11.4893 10.6797 11.2979 10.4336 11.2979Z"></path></svg>`;
}

function calendarIconSvg16() {
  // Matches the icon used in Super's page properties ("Date").
  return `<svg viewBox="0 0 16 16" style="width:16px;height:16px"><path d="M3.29688 14.4561H12.7031C14.1797 14.4561 14.9453 13.6904 14.9453 12.2344V3.91504C14.9453 2.45215 14.1797 1.69336 12.7031 1.69336H3.29688C1.82031 1.69336 1.05469 2.45215 1.05469 3.91504V12.2344C1.05469 13.6973 1.82031 14.4561 3.29688 14.4561ZM3.27637 13.1162C2.70898 13.1162 2.39453 12.8154 2.39453 12.2207V5.9043C2.39453 5.30273 2.70898 5.00879 3.27637 5.00879H12.71C13.2842 5.00879 13.6055 5.30273 13.6055 5.9043V12.2207C13.6055 12.8154 13.2842 13.1162 12.71 13.1162H3.27637Z"></path></svg>`;
}

function personIconSvg16() {
  // Matches the icon used in Super's page properties ("Person").
  return `<svg viewBox="0 0 16 16" style="width:16px;height:16px"><path d="M10.9536 7.90088C12.217 7.90088 13.2559 6.79468 13.2559 5.38525C13.2559 4.01514 12.2114 2.92017 10.9536 2.92017C9.70142 2.92017 8.65137 4.02637 8.65698 5.39087C8.6626 6.79468 9.69019 7.90088 10.9536 7.90088ZM4.4231 8.03003C5.52368 8.03003 6.42212 7.05859 6.42212 5.83447C6.42212 4.63843 5.51245 3.68945 4.4231 3.68945C3.33374 3.68945 2.41846 4.64966 2.41846 5.84009C2.42407 7.05859 3.32251 8.03003 4.4231 8.03003ZM1.37964 13.168H5.49561C4.87231 12.292 5.43384 10.6074 6.78711 9.51807C6.18628 9.14746 5.37769 8.87231 4.4231 8.87231C1.95239 8.87231 0.262207 10.6917 0.262207 12.1628C0.262207 12.7974 0.548584 13.168 1.37964 13.168ZM7.50024 13.168H14.407C15.4009 13.168 15.7322 12.8423 15.7322 12.2864C15.7322 10.8489 13.8679 8.88354 10.9536 8.88354C8.04492 8.88354 6.17505 10.8489 6.17505 12.2864C6.17505 12.8423 6.50635 13.168 7.50024 13.168Z"></path></svg>`;
}

function toDateIso(start) {
  const s = String(start || "").trim();
  if (!s) return null;
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

function formatDateLong(start) {
  const iso = toDateIso(start);
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function extractFirstDateProperty(page) {
  const props = page?.properties && typeof page.properties === "object" ? page.properties : {};
  for (const [name, v] of Object.entries(props)) {
    if (!v || typeof v !== "object") continue;
    if (v.type !== "date") continue;
    const start = v.date?.start;
    if (!start) continue;
    const text = formatDateLong(start);
    if (!text) continue;
    return { name, id: String(v.id || ""), text, start };
  }
  return null;
}

function extractFirstPeopleProperty(page) {
  const props = page?.properties && typeof page.properties === "object" ? page.properties : {};
  for (const [name, v] of Object.entries(props)) {
    if (!v || typeof v !== "object") continue;
    if (v.type !== "people") continue;
    const people = Array.isArray(v.people) ? v.people : [];
    const names = people.map((p) => String(p?.name || "").trim()).filter(Boolean);
    if (!names.length) continue;
    return { name, id: String(v.id || ""), names };
  }
  return null;
}

export function renderPagePropertiesFromPageObject(pageObj) {
  const date = extractFirstDateProperty(pageObj);
  const people = extractFirstPeopleProperty(pageObj);

  const props = [];

  if (date) {
    const propId = date.id ? String(date.id).replace(/[^a-z0-9]/gi, "") : "";
    const dateClass = propId ? ` property-${escapeHtml(propId)}` : "";
    props.push(
      `<div class="notion-page__property"><div class="notion-page__property-name-wrapper"><div class="notion-page__property-icon-wrapper">${calendarIconSvg16()}</div><div class="notion-page__property-name"><span>${escapeHtml(
        date.name,
      )}</span></div></div><div class="notion-property notion-property__date${dateClass} notion-semantic-string"><span class="date">${escapeHtml(
        date.text,
      )}</span></div></div>`,
    );
  }

  if (people) {
    const propId = people.id ? String(people.id).replace(/[^a-z0-9]/gi, "") : "";
    const personClass = propId ? ` property-${escapeHtml(propId)}` : "";
    const primary = people.names[0] || "Person";
    const avatarLetter = escapeHtml(primary.trim().slice(0, 1).toUpperCase() || "P");
    props.push(
      `<div class="notion-page__property"><div class="notion-page__property-name-wrapper"><div class="notion-page__property-icon-wrapper">${personIconSvg16()}</div><div class="notion-page__property-name"><span>${escapeHtml(
        people.name,
      )}</span></div></div><div class="notion-property notion-property__person${personClass} notion-semantic-string no-wrap"><span class="individual-with-image"><div class="individual-letter-avatar">${avatarLetter}</div><span>${escapeHtml(
        primary,
      )}</span></span></div></div>`,
    );
  }

  if (!props.length) return "";
  return `<div class="notion-page__properties">${props.join("")}<div id="block-root-divider" class="notion-divider"></div></div>`;
}

function embedSpinnerSvg() {
  return `<svg class="super-loader__spinner" viewBox="0 0 24 24"><defs><linearGradient x1="28.1542969%" y1="63.7402344%" x2="74.6289062%" y2="17.7832031%" id="linearGradient-1"><stop stop-color="rgba(164, 164, 164, 1)" offset="0%"></stop><stop stop-color="rgba(164, 164, 164, 0)" stop-opacity="0" offset="100%"></stop></linearGradient></defs><g id="Page-1" stroke="none" stroke-width="1" fill="none"><g transform="translate(-236.000000, -286.000000)"><g transform="translate(238.000000, 286.000000)"><circle id="Oval-2" stroke="url(#linearGradient-1)" stroke-width="4" cx="10" cy="12" r="10"></circle><path d="M10,2 C4.4771525,2 0,6.4771525 0,12" id="Oval-2" stroke="rgba(164, 164, 164, 1)" stroke-width="4"></path><rect id="Rectangle-1" fill="rgba(164, 164, 164, 1)" x="8" y="0" width="4" height="4" rx="8"></rect></g></g></g></g></svg>`;
}

export function richTextPlain(richText) {
  return (richText || []).map((x) => x?.plain_text ?? "").join("");
}

export function renderRichText(richText, ctx) {
  const items = Array.isArray(richText) ? richText : [];
  return items.map((rt) => renderRichTextItem(rt, ctx)).join("");
}

function rewriteHref(rawHref, ctx) {
  const href = String(rawHref ?? "").trim();
  if (!href) return "";

  const routeByPageId = ctx?.routeByPageId;

  let url;
  let isAbsolute = false;
  try {
    url = new URL(href);
    isAbsolute = true;
  } catch {
    try {
      url = new URL(href, "https://local.invalid");
    } catch {
      return href;
    }
  }

  const host = String(url.host || "").toLowerCase();

  const compact = compactId(href);
  if (compact && routeByPageId?.has?.(compact)) {
    const mapped = routeByPageId.get(compact);
    if (mapped) return mapped;
  }

  const isProdDomain =
    host === "jinkunchen.com" ||
    host === "www.jinkunchen.com" ||
    host === "jinnkunn.com" ||
    host === "www.jinnkunn.com";
  if (isAbsolute && isProdDomain) {
    return `${url.pathname || "/"}${url.search || ""}${url.hash || ""}`;
  }

  return href;
}

function renderKatexFromCtx(expr, opts, ctx) {
  if (ctx && typeof ctx.renderKatex === "function") return ctx.renderKatex(expr, opts);
  return escapeHtml(expr);
}

function renderRichTextItem(rt, ctx) {
  const annotations = rt?.annotations ?? {};
  const color = String(annotations.color || "default");
  const href = rewriteHref(
    rt?.href ||
      rt?.text?.link?.url ||
      (rt?.type === "mention" && rt?.mention?.type === "page"
        ? ctx.routeByPageId.get(compactId(rt?.mention?.page?.id)) || ""
        : ""),
    ctx,
  );

  let inner = "";
  if (rt?.type === "equation") {
    const expr = rt?.equation?.expression ?? rt?.plain_text ?? "";
    inner = `<span class="notion-equation notion-equation__inline">${renderKatexFromCtx(
      expr,
      { displayMode: false },
      ctx,
    )}</span>`;
  } else {
    inner = escapeHtml(rt?.plain_text ?? "");
  }

  if (href) {
    const external = /^https?:\/\//i.test(href);
    const attrs = external ? ` target="_blank" rel="noopener noreferrer"` : "";
    inner = `<a href="${escapeHtml(href)}" class="notion-link link"${attrs}>${inner}</a>`;
  }

  if (annotations.underline) inner = `<u>${inner}</u>`;
  if (annotations.strikethrough) inner = `<s>${inner}</s>`;
  if (annotations.bold) inner = `<strong>${inner}</strong>`;
  if (annotations.code) inner = `<code class="code">${inner}</code>`;

  if (color.endsWith("_background")) {
    const bg = color.replace(/_background$/, "");
    const bgSafe = escapeHtml(bg);
    inner = `<span class="highlighted-background bg-${bgSafe}">${inner}</span>`;
    if (bg !== "yellow") {
      inner = `<span class="highlighted-color color-${bgSafe}">${inner}</span>`;
    }
  } else if (color !== "default") {
    inner = `<span class="highlighted-color color-${escapeHtml(color)}">${inner}</span>`;
  }

  if (annotations.italic) inner = `<em>${inner}</em>`;
  return inner;
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
    try { host = url ? new URL(url).hostname : ""; } catch {}

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

function renderCollectionListItem(item, { listKey }) {
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

