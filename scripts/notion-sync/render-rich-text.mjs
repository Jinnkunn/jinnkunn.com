import { compactId } from "../../lib/shared/route-utils.mjs";
import { escapeHtml } from "../../lib/shared/text-utils.mjs";

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

export function renderKatexFromCtx(expr, opts, ctx) {
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
