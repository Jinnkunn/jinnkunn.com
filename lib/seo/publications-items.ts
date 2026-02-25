import { parse, type DefaultTreeAdapterTypes } from "parse5";

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlElement = DefaultTreeAdapterTypes.Element;

export type PublicationStructuredItem = {
  title: string;
  year: string;
  url: string;
  labels: string[];
};

function asChildren(node: HtmlNode): HtmlNode[] {
  const n = node as HtmlNode & { childNodes?: HtmlNode[] };
  return Array.isArray(n.childNodes) ? n.childNodes : [];
}

function isElement(node: HtmlNode): node is HtmlElement {
  const n = node as HtmlElement;
  return typeof n.tagName === "string" && Array.isArray(n.attrs);
}

function getAttr(el: HtmlElement, name: string): string {
  const attr = el.attrs.find((a) => a.name === name);
  return attr ? String(attr.value || "") : "";
}

function hasClass(el: HtmlElement, className: string): boolean {
  return getAttr(el, "class")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(className);
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

function findFirstDescendant(
  root: HtmlNode,
  pred: (el: HtmlElement) => boolean,
): HtmlElement | null {
  let out: HtmlElement | null = null;
  walkNodes(root, (el) => {
    if (!out && pred(el)) out = el;
  });
  return out;
}

function findDescendants(
  root: HtmlNode,
  pred: (el: HtmlElement) => boolean,
): HtmlElement[] {
  const out: HtmlElement[] = [];
  walkNodes(root, (el) => {
    if (pred(el)) out.push(el);
  });
  return out;
}

function textContent(node: HtmlNode): string {
  const n = node as HtmlNode & { nodeName?: string; value?: string };
  if (n.nodeName === "#text") return String(n.value || "");
  return asChildren(node).map((child) => textContent(child)).join("");
}

function normalizeText(input: string): string {
  return String(input || "").replace(/\s+/g, " ").trim();
}

function extractTitleFromSummary(summaryEl: HtmlElement): string {
  const strongTexts = findDescendants(summaryEl, (el) => el.tagName === "strong")
    .map((el) => normalizeText(textContent(el)))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (strongTexts.length > 0) return strongTexts[0];
  return normalizeText(textContent(summaryEl));
}

function extractLabelsFromSummary(summaryEl: HtmlElement): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const codeEl of findDescendants(summaryEl, (el) => el.tagName === "code")) {
    const label = normalizeText(textContent(codeEl));
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

function extractFirstExternalUrl(root: HtmlElement): string {
  const link = findFirstDescendant(root, (el) => {
    if (el.tagName !== "a") return false;
    const href = String(getAttr(el, "href") || "").trim();
    return /^https?:\/\//i.test(href);
  });
  return link ? String(getAttr(link, "href") || "").trim() : "";
}

function findPublicationsMain(root: HtmlNode): HtmlElement | null {
  return findFirstDescendant(root, (el) => {
    if (el.tagName !== "main") return false;
    return hasClass(el, "page__publications");
  });
}

function isNotionYearHeading(el: HtmlElement): boolean {
  return el.tagName === "h2" && hasClass(el, "notion-heading");
}

function isPublicationToggle(el: HtmlElement): boolean {
  return el.tagName === "div" && hasClass(el, "notion-toggle");
}

export function extractPublicationsStructuredItems(
  mainHtml: string,
  opts?: { maxItems?: number },
): PublicationStructuredItem[] {
  const maxItems = Math.max(1, Math.min(300, Math.floor(Number(opts?.maxItems ?? 120))));
  const doc = parse(String(mainHtml || ""));
  const main = findPublicationsMain(doc as unknown as HtmlNode);
  if (!main) return [];

  const out: PublicationStructuredItem[] = [];
  let currentYear = "";

  walkNodes(main, (el) => {
    if (out.length >= maxItems) return;

    if (isNotionYearHeading(el)) {
      currentYear = normalizeText(textContent(el));
      return;
    }

    if (!isPublicationToggle(el)) return;

    const summary = findFirstDescendant(el, (node) =>
      node.tagName === "div" && hasClass(node, "notion-toggle__summary"),
    );
    if (!summary) return;

    const content = findFirstDescendant(el, (node) =>
      node.tagName === "div" && hasClass(node, "notion-toggle__content"),
    );

    const title = extractTitleFromSummary(summary);
    if (!title) return;

    out.push({
      title,
      year: currentYear,
      url: content ? extractFirstExternalUrl(content) : "",
      labels: extractLabelsFromSummary(summary),
    });
  });

  return out;
}
