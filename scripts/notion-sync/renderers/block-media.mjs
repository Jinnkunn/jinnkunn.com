import { escapeHtml } from "../../../lib/shared/text-utils.mjs";
import { renderRichText, richTextPlain } from "../render-rich-text.mjs";

const RESPONSIVE_WIDTHS = [480, 768, 1024, 1280, 1536, 1920];
const RESPONSIVE_QUALITY = 82;
const RESPONSIVE_FALLBACK_WIDTH = 1280;
const RESPONSIVE_SIZES = "(max-width: 960px) 100vw, 960px";

function pickCalloutBgClass(color) {
  const c = String(color || "default").replace(/_background$/, "");
  if (c === "default") return "bg-gray-light";
  return `bg-${c}-light`;
}

function embedSpinnerSvg() {
  return `<svg class="super-loader__spinner" viewBox="0 0 24 24"><defs><linearGradient x1="28.1542969%" y1="63.7402344%" x2="74.6289062%" y2="17.7832031%" id="linearGradient-1"><stop stop-color="rgba(164, 164, 164, 1)" offset="0%"></stop><stop stop-color="rgba(164, 164, 164, 0)" stop-opacity="0" offset="100%"></stop></linearGradient></defs><g id="Page-1" stroke="none" stroke-width="1" fill="none"><g transform="translate(-236.000000, -286.000000)"><g transform="translate(238.000000, 286.000000)"><circle id="Oval-2" stroke="url(#linearGradient-1)" stroke-width="4" cx="10" cy="12" r="10"></circle><path d="M10,2 C4.4771525,2 0,6.4771525 0,12" id="Oval-2" stroke="rgba(164, 164, 164, 1)" stroke-width="4"></path><rect id="Rectangle-1" fill="rgba(164, 164, 164, 1)" x="8" y="0" width="4" height="4" rx="8"></rect></g></g></g></g></svg>`;
}

function isOptimizableLocalAsset(src) {
  const s = String(src || "").trim();
  if (!s) return false;
  return s.startsWith("/notion-assets/");
}

function buildNextImageUrl(src, width, quality = RESPONSIVE_QUALITY) {
  const w = Math.max(1, Math.floor(Number(width) || 0));
  const q = Math.max(1, Math.min(100, Math.floor(Number(quality) || RESPONSIVE_QUALITY)));
  return `/_next/image?url=${encodeURIComponent(String(src || ""))}&w=${w}&q=${q}`;
}

function buildResponsiveImageAttrs(src) {
  if (!isOptimizableLocalAsset(src)) return null;
  const srcset = RESPONSIVE_WIDTHS
    .map((w) => `${buildNextImageUrl(src, w)} ${w}w`)
    .join(", ");
  return {
    src: buildNextImageUrl(src, RESPONSIVE_FALLBACK_WIDTH),
    srcset,
    sizes: RESPONSIVE_SIZES,
  };
}

export function renderEmbedBlock({ b, blockIdAttr, ctx }) {
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

export async function renderImageBlock({ b, blockIdAttr, id, ctx }) {
  const img = b.image ?? {};
  const src = img.type === "external" ? img.external?.url : img.type === "file" ? img.file?.url : "";
  const stableName = id || `image-${Math.random().toString(16).slice(2)}`;
  const publicSrc = img.type === "file" && src && typeof ctx.downloadAsset === "function"
    ? await ctx.downloadAsset(src, stableName)
    : src;
  const responsive = buildResponsiveImageAttrs(publicSrc);
  const caption = renderRichText(img.caption ?? [], ctx);
  const figcaption = caption ? `<figcaption class="notion-caption notion-semantic-string">${caption}</figcaption>` : "";
  const altText = escapeHtml(richTextPlain(img.caption ?? []) || "image");
  const srcAttr = escapeHtml(responsive?.src || publicSrc || "");
  const srcsetAttr = responsive?.srcset ? ` srcset="${escapeHtml(responsive.srcset)}"` : "";
  const sizesAttr = responsive?.sizes ? ` sizes="${escapeHtml(responsive.sizes)}"` : "";
  return `<div id="${blockIdAttr}" class="notion-image align-start page-width"><span data-full-size="${escapeHtml(
    publicSrc || "",
  )}" data-lightbox-src="${escapeHtml(
    publicSrc || "",
  )}" style="display:contents"><img alt="${altText}" loading="lazy" decoding="async" style="color: transparent; height: auto;" src="${srcAttr}"${srcsetAttr}${sizesAttr}></span>${figcaption}</div>`;
}

export function renderCodeBlock({ b, blockIdAttr, ctx }) {
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

export async function renderCalloutBlock({ b, blockIdAttr, ctx, renderBlocks }) {
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
