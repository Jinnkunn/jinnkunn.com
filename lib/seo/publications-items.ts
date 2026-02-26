import { parse, type DefaultTreeAdapterTypes } from "parse5";

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlElement = DefaultTreeAdapterTypes.Element;

export type PublicationStructuredItem = {
  title: string;
  year: string;
  url: string;
  labels: string[];
};

export type PublicationStructuredEntry = PublicationStructuredItem & {
  authors?: string[];
  externalUrls?: string[];
  doiUrl?: string;
  arxivUrl?: string;
  venue?: string;
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

function extractExternalUrls(root: HtmlElement): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const link of findDescendants(root, (el) => el.tagName === "a")) {
    const href = String(getAttr(link, "href") || "").trim();
    if (!/^https?:\/\//i.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push(href);
  }
  return out;
}

function extractQuoteLines(contentEl: HtmlElement): string[] {
  const lines: string[] = [];
  for (const quote of findDescendants(contentEl, (el) => el.tagName === "blockquote")) {
    const text = normalizeText(textContent(quote));
    if (text) lines.push(text);
  }
  return lines;
}

function splitAuthors(raw: string): string[] {
  const normalized = normalizeText(raw)
    .replace(/[，]/g, ",")
    .replace(/\s+and\s+/gi, ", ")
    .replace(/\s*&\s*/g, ", ");
  if (!normalized) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of normalized.split(",").map((s) => s.trim())) {
    if (!part) continue;
    if (/^https?:\/\//i.test(part)) continue;
    const cleaned = part.replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function extractAuthorsFromContent(contentEl: HtmlElement): string[] {
  const lines = extractQuoteLines(contentEl);
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("http://") || lower.includes("https://")) continue;
    if (/^\s*(conference|journal|workshop|arxiv\.org|doi)\b/i.test(line)) continue;
    const authors = splitAuthors(line);
    if (authors.length > 0) return authors;
  }
  return [];
}

function extractVenueFromContent(contentEl: HtmlElement): string {
  const lines = extractQuoteLines(contentEl);
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("http://") || lower.includes("https://")) continue;
    if (line.includes(":") || /\b(conference|journal|workshop|proceedings)\b/i.test(line)) {
      return normalizeText(line);
    }
  }
  return "";
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
  return extractPublicationStructuredEntries(mainHtml, opts).map((item) => ({
    title: item.title,
    year: item.year,
    url: item.url,
    labels: item.labels,
  }));
}

export function extractPublicationStructuredEntries(
  mainHtml: string,
  opts?: { maxItems?: number },
): PublicationStructuredEntry[] {
  const maxItems = Math.max(1, Math.min(300, Math.floor(Number(opts?.maxItems ?? 120))));
  const doc = parse(String(mainHtml || ""));
  const main = findPublicationsMain(doc as unknown as HtmlNode);
  if (!main) return [];

  const out: PublicationStructuredEntry[] = [];
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
    const labels = extractLabelsFromSummary(summary);
    const externalUrls = content ? extractExternalUrls(content) : [];
    const fallbackUrl = content ? extractFirstExternalUrl(content) : "";
    const doiUrl = externalUrls.find((href) => /doi\.org/i.test(href)) || "";
    const arxivUrl = externalUrls.find((href) => /arxiv\.org\/abs\//i.test(href)) || "";
    const primaryUrl = doiUrl || arxivUrl || externalUrls[0] || fallbackUrl;
    const authors = content ? extractAuthorsFromContent(content) : [];
    const venue = content ? extractVenueFromContent(content) : "";

    const item: PublicationStructuredEntry = {
      title,
      year: currentYear,
      url: primaryUrl,
      labels,
    };
    if (authors.length > 0) item.authors = authors;
    if (externalUrls.length > 0) item.externalUrls = externalUrls;
    if (doiUrl) item.doiUrl = doiUrl;
    if (arxivUrl) item.arxivUrl = arxivUrl;
    if (venue) item.venue = venue;

    out.push(item);
  });

  return out;
}
