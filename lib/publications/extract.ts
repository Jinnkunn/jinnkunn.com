import { parse, type DefaultTreeAdapterTypes } from "parse5";

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlElement = DefaultTreeAdapterTypes.Element;

export type PublicationProfileLink = {
  label: string;
  href: string;
  hostname: string;
};

function asChildren(node: HtmlNode): HtmlNode[] {
  const n = node as HtmlNode & { childNodes?: HtmlNode[] };
  return Array.isArray(n.childNodes) ? n.childNodes : [];
}

function isElement(node: HtmlNode): node is HtmlElement {
  const n = node as HtmlElement;
  return typeof n.tagName === "string" && Array.isArray(n.attrs);
}

function hasClass(el: HtmlElement, className: string): boolean {
  const attr = el.attrs.find((a) => a.name === "class");
  if (!attr) return false;
  return String(attr.value || "")
    .split(/\s+/)
    .includes(className);
}

function textContent(node: HtmlNode): string {
  const n = node as HtmlNode & { nodeName?: string; value?: string };
  if (n.nodeName === "#text") return String(n.value || "");
  return asChildren(node).map((child) => textContent(child)).join("");
}

function walk(root: HtmlNode, visit: (el: HtmlElement) => boolean | void): void {
  const stack: HtmlNode[] = [root];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    if (isElement(cur)) {
      const stop = visit(cur);
      if (stop === true) return;
    }
    const children = asChildren(cur);
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
  }
}

function findPublicationsMain(root: HtmlNode): HtmlElement | null {
  let out: HtmlElement | null = null;
  walk(root, (el) => {
    if (out) return true;
    if (el.tagName === "main" && hasClass(el, "page__publications")) {
      out = el;
      return true;
    }
  });
  return out;
}

function findArticle(main: HtmlElement): HtmlElement | null {
  let out: HtmlElement | null = null;
  walk(main, (el) => {
    if (out) return true;
    if (el.tagName === "article" && hasClass(el, "notion-root")) {
      out = el;
      return true;
    }
  });
  return out;
}

export function extractProfileLinks(mainHtml: string): PublicationProfileLink[] {
  const doc = parse(String(mainHtml || ""));
  const main = findPublicationsMain(doc as unknown as HtmlNode);
  if (!main) return [];
  const article = findArticle(main);
  if (!article) return [];

  const seen = new Set<string>();
  const out: PublicationProfileLink[] = [];

  for (const child of asChildren(article)) {
    if (!isElement(child)) continue;
    if (child.tagName === "h2") break;
    if (child.tagName !== "p") continue;
    walk(child, (el) => {
      if (el.tagName !== "a") return;
      const hrefAttr = el.attrs.find((a) => a.name === "href");
      const href = String(hrefAttr?.value || "").trim();
      if (!/^https?:\/\//i.test(href)) return;
      if (seen.has(href)) return;
      const label = textContent(el).replace(/\s+/g, " ").trim();
      if (!label) return;
      let hostname = "";
      try {
        hostname = new URL(href).hostname.replace(/^www\./i, "");
      } catch {
        hostname = "";
      }
      seen.add(href);
      out.push({ label, href, hostname });
    });
  }
  return out;
}

export function extractPageTitle(mainHtml: string): string {
  const doc = parse(String(mainHtml || ""));
  const main = findPublicationsMain(doc as unknown as HtmlNode);
  if (!main) return "";
  let title = "";
  walk(main, (el) => {
    if (title) return true;
    if (el.tagName === "h1" && hasClass(el, "notion-header__title")) {
      title = textContent(el).replace(/\s+/g, " ").trim();
      return true;
    }
  });
  return title;
}
