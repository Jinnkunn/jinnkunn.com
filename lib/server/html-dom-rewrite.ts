import { parse, serializeOuter, type DefaultTreeAdapterTypes } from "parse5";

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlElement = DefaultTreeAdapterTypes.Element;

const REMOTE_PROFILE_PUBLIC =
  "https://images.spr.so/cdn-cgi/imagedelivery/j42No7y-dcokJuNgXeA0ig/d4473e16-cb09-4f59-8e01-9bed5a936048/web-image/public";
const REMOTE_PROFILE_OPTIMIZED =
  "https://images.spr.so/cdn-cgi/imagedelivery/j42No7y-dcokJuNgXeA0ig/d4473e16-cb09-4f59-8e01-9bed5a936048/web-image/w=1920,quality=90,fit=scale-down";
const REMOTE_PROFILE_CDN = "https://cdn.jinkunchen.com/web_image/web-image.png";
const REMOTE_LOGO =
  "https://assets.super.so/e331c927-5859-4092-b1ca-16eddc17b1bb/uploads/logo/712f74e3-00ca-453b-9511-39896485699f.png";
const REMOTE_PROFILE_LIGHTBOX_PREFIX =
  "https://images.spr.so/cdn-cgi/imagedelivery/j42No7y-dcokJuNgXeA0ig/d4473e16-cb09-4f59-8e01-9bed5a936048/web-image/";

const PROFILE_IMG_FALLBACK =
  "this.onerror=null;this.src='https://cdn.jinkunchen.com/web_image/web-image.png'";

const URL_REPLACEMENTS: ReadonlyArray<[from: string, to: string]> = [
  [REMOTE_PROFILE_PUBLIC, "/assets/profile.png"],
  [REMOTE_PROFILE_OPTIMIZED, "/assets/profile.png"],
  [REMOTE_PROFILE_CDN, "/assets/profile.png"],
  [REMOTE_LOGO, "/assets/logo.png"],
];

function asChildren(node: HtmlNode): HtmlNode[] {
  const n = node as HtmlNode & { childNodes?: HtmlNode[] };
  return Array.isArray(n.childNodes) ? n.childNodes : [];
}

function nodeTextContent(node: HtmlNode): string {
  const textNode = node as HtmlNode & { nodeName?: string; value?: string };
  if (textNode.nodeName === "#text") return String(textNode.value || "");
  return asChildren(node).map((child) => nodeTextContent(child)).join("");
}

function isElement(node: HtmlNode): node is HtmlElement {
  const n = node as HtmlElement;
  return typeof n.tagName === "string" && Array.isArray(n.attrs);
}

function walkNodes(root: HtmlNode, visit: (el: HtmlElement) => void) {
  const stack: HtmlNode[] = [root];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    if (isElement(cur)) visit(cur);
    const children = asChildren(cur);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i]);
    }
  }
}

function findFirstElement(root: HtmlNode, pred: (el: HtmlElement) => boolean): HtmlElement | null {
  let out: HtmlElement | null = null;
  walkNodes(root, (el) => {
    if (!out && pred(el)) out = el;
  });
  return out;
}

function attrIndex(el: HtmlElement, name: string): number {
  return el.attrs.findIndex((a) => a.name === name);
}

function getAttr(el: HtmlElement, name: string): string {
  const idx = attrIndex(el, name);
  return idx === -1 ? "" : String(el.attrs[idx]?.value || "");
}

function setAttr(el: HtmlElement, name: string, value: string) {
  const idx = attrIndex(el, name);
  if (idx === -1) {
    el.attrs.push({ name, value });
    return;
  }
  el.attrs[idx] = { name, value };
}

function removeAttr(el: HtmlElement, name: string) {
  const idx = attrIndex(el, name);
  if (idx !== -1) el.attrs.splice(idx, 1);
}

function hasClass(el: HtmlElement, className: string): boolean {
  const classes = getAttr(el, "class")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return classes.includes(className);
}

function buildEmptyLinkAriaLabel(href: string): string {
  const raw = String(href || "").trim();
  if (!raw) return "Open link";

  try {
    const url = new URL(raw, "https://jinkunchen.com");
    const isInternal = url.origin === "https://jinkunchen.com";
    if (isInternal) {
      const path = url.pathname || "/";
      return `Open ${path}`;
    }
    return `Open link to ${url.hostname}`;
  } catch {
    return "Open link";
  }
}

function rewriteAttrValue(value: string): string {
  let out = String(value || "");
  for (const [from, to] of URL_REPLACEMENTS) {
    if (out.includes(from)) out = out.split(from).join(to);
  }
  return out;
}

function normalizeCssValue(value: string): string {
  return value.replace(/\s*!important\s*$/i, "").trim().toLowerCase();
}

function stripPositionAbsolute(styleText: string): string {
  const chunks = String(styleText || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  const kept: string[] = [];
  for (const chunk of chunks) {
    const idx = chunk.indexOf(":");
    if (idx === -1) continue;
    const prop = chunk.slice(0, idx).trim().toLowerCase();
    const value = chunk.slice(idx + 1).trim();
    if (!prop) continue;
    if (prop === "position" && normalizeCssValue(value) === "absolute") continue;
    kept.push(`${prop}:${value}`);
  }
  return kept.join("; ");
}

function isProfileLightboxSource(value: string): boolean {
  const v = String(value || "").trim();
  if (!v) return false;
  if (v === REMOTE_PROFILE_CDN) return true;
  return v.startsWith(REMOTE_PROFILE_LIGHTBOX_PREFIX);
}

function fixElement(el: HtmlElement) {
  if (hasClass(el, "super-navbar__breadcrumbs")) {
    const style = getAttr(el, "style");
    if (style) {
      const cleaned = stripPositionAbsolute(style);
      if (cleaned) setAttr(el, "style", cleaned);
      else removeAttr(el, "style");
    }
  }

  for (const attrName of ["data-full-size", "data-lightbox-src"]) {
    const value = getAttr(el, attrName);
    if (isProfileLightboxSource(value)) {
      removeAttr(el, attrName);
    }
  }

  for (const attr of el.attrs) {
    attr.value = rewriteAttrValue(attr.value);
  }

  if (el.tagName === "a") {
    const existingLabel = getAttr(el, "aria-label").trim();
    if (!existingLabel) {
      const text = nodeTextContent(el).replace(/\s+/g, " ").trim();
      if (!text) {
        const href = getAttr(el, "href");
        if (href) {
          setAttr(el, "aria-label", buildEmptyLinkAriaLabel(href));
        }
      }
    }
  }

  if (el.tagName === "img" && getAttr(el, "src").includes("/assets/profile.png")) {
    removeAttr(el, "loading");
    removeAttr(el, "fetchpriority");
    removeAttr(el, "onerror");
    setAttr(el, "loading", "eager");
    setAttr(el, "fetchpriority", "high");
    setAttr(el, "onerror", PROFILE_IMG_FALLBACK);
  }
}

export function extractMainElementHtml(fullHtml: string): string | null {
  const document = parse(String(fullHtml || ""));
  const main = findFirstElement(document as unknown as HtmlNode, (el) => el.tagName === "main");
  if (!main) return null;
  return serializeOuter(main);
}

export function rewriteMainHtmlWithDom(mainHtml: string): string {
  const doc = parse(String(mainHtml || ""));
  const main = findFirstElement(doc as unknown as HtmlNode, (el) => el.tagName === "main");
  if (!main) return String(mainHtml || "");

  walkNodes(main, fixElement);
  return serializeOuter(main);
}
