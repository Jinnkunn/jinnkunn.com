import { parse, type DefaultTreeAdapterTypes } from "parse5";

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlElement = DefaultTreeAdapterTypes.Element;

export type PublicationStructuredItem = {
  title: string;
  year: string;
  url: string;
  labels: string[];
};

export type PublicationAuthor = {
  name: string;
  isSelf: boolean;
};

export type PublicationVenue = {
  type: string;
  text: string;
  url?: string;
};

export type PublicationStructuredEntry = PublicationStructuredItem & {
  authors?: string[];
  authorsRich?: PublicationAuthor[];
  externalUrls?: string[];
  doiUrl?: string;
  arxivUrl?: string;
  venue?: string;
  venues?: PublicationVenue[];
  highlights?: string[];
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

function hasAncestorTag(
  root: HtmlNode,
  target: HtmlElement,
  tags: ReadonlySet<string>,
): boolean {
  let found: boolean | null = null;
  const visit = (node: HtmlNode, path: HtmlElement[]): void => {
    if (found !== null) return;
    if (node === (target as unknown as HtmlNode)) {
      found = path.some((el) => tags.has(el.tagName));
      return;
    }
    if (!isElement(node)) return;
    const children = asChildren(node);
    const nextPath = path.concat(node);
    for (const child of children) visit(child, nextPath);
  };
  visit(root, []);
  return found ?? false;
}

const TITLE_EXCLUDED_ANCESTORS = new Set(["code", "em"]);

function extractTitleFromSummary(summaryEl: HtmlElement): string {
  const strongTexts = findDescendants(summaryEl, (el) => el.tagName === "strong")
    .filter((el) => !hasAncestorTag(summaryEl, el, TITLE_EXCLUDED_ANCESTORS))
    .map((el) => normalizeText(textContent(el)))
    .map((text) => text.replace(/\[[^\[\]]{1,32}\]/g, "").trim())
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

const HIGHLIGHT_BRACKET_RE = /\[([^\[\]]{1,32})\]/g;

function extractHighlightsFromSummary(summaryEl: HtmlElement): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const codeEl of findDescendants(summaryEl, (el) => el.tagName === "code")) {
    seen.add(normalizeText(textContent(codeEl)).toLowerCase());
  }
  const text = normalizeText(textContent(summaryEl));
  let m: RegExpExecArray | null;
  while ((m = HIGHLIGHT_BRACKET_RE.exec(text)) !== null) {
    const raw = normalizeText(m[1]);
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

function hasSelfAncestor(path: HtmlElement[]): boolean {
  let sawU = false;
  let sawStrong = false;
  for (const el of path) {
    if (el.tagName === "u") sawU = true;
    if (el.tagName === "strong") sawStrong = true;
  }
  return sawU && sawStrong;
}

function isCodeLabelElement(el: HtmlElement): boolean {
  return el.tagName === "code" && hasClass(el, "code");
}

type QuoteEvent =
  | { kind: "text"; value: string; isSelf: boolean }
  | { kind: "label"; value: string }
  | { kind: "link"; href: string };

function collectQuoteEvents(quote: HtmlNode): QuoteEvent[] {
  const events: QuoteEvent[] = [];

  const visit = (node: HtmlNode, path: HtmlElement[]) => {
    const n = node as HtmlNode & { nodeName?: string; value?: string };

    if (n.nodeName === "#text") {
      const text = String(n.value || "");
      if (text) events.push({ kind: "text", value: text, isSelf: hasSelfAncestor(path) });
      return;
    }

    if (!isElement(node)) return;

    if (isCodeLabelElement(node)) {
      const label = normalizeText(textContent(node));
      if (label) events.push({ kind: "label", value: label });
      return;
    }

    if (node.tagName === "a") {
      const href = String(getAttr(node, "href") || "").trim();
      if (/^https?:\/\//i.test(href)) events.push({ kind: "link", href });
      const children = asChildren(node);
      const nextPath = path.concat(node);
      for (const child of children) visit(child, nextPath);
      return;
    }

    const children = asChildren(node);
    const nextPath = path.concat(node);
    for (const child of children) visit(child, nextPath);
  };

  visit(quote, []);
  return events;
}

function splitAuthorTokens(raw: string): Array<{ name: string; isSelf: boolean }> {
  const SELF_OPEN = "\u0001";
  const SELF_CLOSE = "\u0002";
  if (!raw.trim()) return [];
  const cleaned = raw
    .replace(/[，]/g, ",")
    .replace(/\s+and\s+/gi, ", ")
    .replace(/\s*&\s*/g, ", ")
    .replace(/[;；]/g, ",")
    .replace(/\s+/g, " ")
    .trim();
  const out: Array<{ name: string; isSelf: boolean }> = [];
  const seen = new Set<string>();
  for (const part of cleaned.split(",")) {
    const token = part.trim();
    if (!token) continue;
    if (/^https?:\/\//i.test(token)) continue;
    const isSelf = token.includes(SELF_OPEN);
    const name = token.replace(new RegExp(`[${SELF_OPEN}${SELF_CLOSE}]`, "g"), "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, isSelf });
  }
  return out;
}

function stripVenueText(raw: string): string {
  return raw
    .replace(/^[:\s]+/, "")
    .replace(/\s+(available at|doi|dio)\s*:?\s*$/i, "")
    .replace(/[.,\s]+$/, "")
    .trim();
}

function parseQuote(
  quote: HtmlNode,
  labels: string[],
): { authors: PublicationAuthor[]; venues: PublicationVenue[] } {
  const events = collectQuoteEvents(quote);
  const SELF_OPEN = "\u0001";
  const SELF_CLOSE = "\u0002";
  const authorParts: string[] = [];
  const venues: PublicationVenue[] = [];
  const labelKeys = new Set(labels.map((l) => l.toLowerCase()));

  let currentLabel: string | null = null;
  let currentText: string[] = [];
  let currentUrl: string | undefined;

  const commit = () => {
    if (!currentLabel) return;
    const typeKey = currentLabel.toLowerCase();
    if (labelKeys.size > 0 && !labelKeys.has(typeKey)) {
      currentLabel = null;
      currentText = [];
      currentUrl = undefined;
      return;
    }
    const text = stripVenueText(currentText.join("").replace(/\s+/g, " "));
    if (text || currentUrl) {
      venues.push(
        currentUrl
          ? { type: currentLabel, text, url: currentUrl }
          : { type: currentLabel, text },
      );
    }
    currentLabel = null;
    currentText = [];
    currentUrl = undefined;
  };

  for (const ev of events) {
    if (ev.kind === "label") {
      commit();
      currentLabel = ev.value;
      continue;
    }
    if (ev.kind === "text") {
      if (currentLabel === null) {
        authorParts.push(ev.isSelf ? `${SELF_OPEN}${ev.value}${SELF_CLOSE}` : ev.value);
      } else {
        currentText.push(ev.value);
      }
      continue;
    }
    if (ev.kind === "link") {
      if (currentLabel !== null && !currentUrl) currentUrl = ev.href;
    }
  }
  commit();

  return { authors: splitAuthorTokens(authorParts.join("")), venues };
}

function extractAuthorsAndVenuesFromContent(
  contentEl: HtmlElement,
  labels: string[],
): { authors: PublicationAuthor[]; venues: PublicationVenue[] } {
  const quotes = findDescendants(contentEl, (el) => el.tagName === "blockquote");
  let authors: PublicationAuthor[] = [];
  const allVenues: PublicationVenue[] = [];
  const seenVenueKey = new Set<string>();

  for (const quote of quotes) {
    const parsed = parseQuote(quote, labels);
    if (authors.length === 0 && parsed.authors.length > 0) authors = parsed.authors;
    for (const v of parsed.venues) {
      const key = `${v.type.toLowerCase()}::${v.text.toLowerCase()}::${v.url ?? ""}`;
      if (seenVenueKey.has(key)) continue;
      seenVenueKey.add(key);
      allVenues.push(v);
    }
  }
  return { authors, venues: allVenues };
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
    const highlights = extractHighlightsFromSummary(summary);
    const externalUrls = content ? extractExternalUrls(content) : [];
    const fallbackUrl = content ? extractFirstExternalUrl(content) : "";
    const doiUrl =
      externalUrls.find((href) => /doi\.org/i.test(href)) ||
      externalUrls.find((href) => /(ieeexplore\.ieee\.org|aclanthology\.org|dl\.acm\.org|link\.springer\.com)/i.test(href)) ||
      "";
    const arxivUrl = externalUrls.find((href) => /arxiv\.org\/abs\//i.test(href)) || "";
    const primaryUrl = doiUrl || arxivUrl || externalUrls[0] || fallbackUrl;
    const authors = content ? extractAuthorsFromContent(content) : [];
    const richParse = content
      ? extractAuthorsAndVenuesFromContent(content, labels)
      : { authors: [], venues: [] };
    const authorsRich = richParse.authors;
    const venue = content ? extractVenueFromContent(content) : "";
    const venues = richParse.venues;

    const item: PublicationStructuredEntry = {
      title,
      year: currentYear,
      url: primaryUrl,
      labels,
    };
    if (authors.length > 0) item.authors = authors;
    if (authorsRich.length > 0) item.authorsRich = authorsRich;
    if (externalUrls.length > 0) item.externalUrls = externalUrls;
    if (doiUrl) item.doiUrl = doiUrl;
    if (arxivUrl) item.arxivUrl = arxivUrl;
    if (venue) item.venue = venue;
    if (venues.length > 0) item.venues = venues;
    if (highlights.length > 0) item.highlights = highlights;

    out.push(item);
  });

  return out;
}
