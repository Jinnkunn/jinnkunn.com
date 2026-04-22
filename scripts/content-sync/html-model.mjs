import { parse } from "parse5";

function asChildren(node) {
  const n = node;
  return Array.isArray(n?.childNodes) ? n.childNodes : [];
}

function isElement(node) {
  return Boolean(node) && typeof node === "object" && typeof node.tagName === "string";
}

function getAttr(el, name) {
  const attrs = Array.isArray(el?.attrs) ? el.attrs : [];
  const attr = attrs.find((it) => it?.name === name);
  return String(attr?.value || "");
}

function hasClass(el, className) {
  return getAttr(el, "class")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(className);
}

function walkNodes(root, visit) {
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    visit(cur);
    const children = asChildren(cur);
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
  }
}

function decodeEntities(s) {
  return String(s || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'");
}

function nodeText(node) {
  if (!node || typeof node !== "object") return "";
  if (node.nodeName === "#text") return String(node.value || "");
  return asChildren(node).map((child) => nodeText(child)).join("");
}

function normalizeText(value) {
  return decodeEntities(String(value || "").replace(/\s+/g, " ")).trim();
}

export function extractTitleFromMainHtml(mainHtml, fallback = "Untitled") {
  const match = String(mainHtml || "").match(
    /<h1\b[^>]*class="notion-header__title"[^>]*>([\s\S]*?)<\/h1>/i,
  );
  const title = normalizeText(String(match?.[1] || "").replace(/<[^>]+>/g, ""));
  return title || fallback;
}

export function buildSearchIndexFieldsFromMainHtml(mainHtml, maxChars = 8000) {
  const doc = parse(String(mainHtml || ""));
  const headings = [];
  const textChunks = [];

  walkNodes(doc, (node) => {
    if (!isElement(node)) return;

    if (/^h[1-3]$/i.test(node.tagName)) {
      const text = normalizeText(nodeText(node));
      if (text) headings.push(text);
    }

    if (
      node.tagName === "p" ||
      node.tagName === "li" ||
      /^h[1-6]$/i.test(node.tagName) ||
      node.tagName === "blockquote" ||
      node.tagName === "figcaption"
    ) {
      const text = normalizeText(nodeText(node));
      if (text) textChunks.push(text);
    }

    if (
      (node.tagName === "div" && hasClass(node, "notion-page__property")) ||
      (node.tagName === "div" && hasClass(node, "notion-page")) ||
      (node.tagName === "a" && hasClass(node, "notion-page"))
    ) {
      const text = normalizeText(nodeText(node));
      if (text) textChunks.push(text);
    }
  });

  const text = textChunks.join("\n").trim();
  return {
    headings,
    text: text.length > maxChars ? text.slice(0, maxChars).trim() : text,
  };
}
