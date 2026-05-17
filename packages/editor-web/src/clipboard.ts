function textContent(node: Node): string {
  return (node.textContent ?? "").replace(/\u00a0/g, " ");
}

function escapeMarkdownLinkLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

function escapeMarkdownLinkHref(value: string): string {
  return value.replace(/\)/g, "%29");
}

function inlineMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return textContent(node);
  if (!(node instanceof HTMLElement)) return Array.from(node.childNodes).map(inlineMarkdown).join("");

  const inner = Array.from(node.childNodes).map(inlineMarkdown).join("");
  const tag = node.tagName.toLowerCase();
  if (tag === "br") return "\n";
  if (tag === "strong" || tag === "b") return inner ? `**${inner}**` : "";
  if (tag === "em" || tag === "i") return inner ? `*${inner}*` : "";
  if (tag === "u") return inner ? `<u>${inner}</u>` : "";
  if (tag === "s" || tag === "strike" || tag === "del") return inner ? `~~${inner}~~` : "";
  if (tag === "code") return inner ? `\`${inner}\`` : "";
  if (tag === "mark") return inner ? `==${inner}==` : "";
  if (tag === "a") {
    const href = node.getAttribute("href") ?? "";
    return href ? `[${escapeMarkdownLinkLabel(inner || href)}](${escapeMarkdownLinkHref(href)})` : inner;
  }
  if (tag === "span") {
    const attrs = [];
    const linkStyle = node.getAttribute("data-link-style");
    const icon = node.getAttribute("data-link-icon");
    const color = node.getAttribute("data-color");
    const bg = node.getAttribute("data-bg");
    if (linkStyle === "icon") attrs.push(`data-link-style="icon"`);
    if (icon) attrs.push(`data-link-icon="${icon}"`);
    if (color) attrs.push(`data-color="${color}"`);
    if (bg) attrs.push(`data-bg="${bg}"`);
    return attrs.length ? `<span ${attrs.join(" ")}>${inner}</span>` : inner;
  }
  return inner;
}

function hasBlockChildren(node: HTMLElement): boolean {
  return Array.from(node.children).some((child) => {
    const tag = child.tagName.toLowerCase();
    return [
      "blockquote",
      "div",
      "h1",
      "h2",
      "h3",
      "hr",
      "li",
      "ol",
      "p",
      "pre",
      "table",
      "ul",
    ].includes(tag);
  });
}

function blockLines(node: Node): string[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = textContent(node).trim();
    return text ? [text] : [];
  }
  if (!(node instanceof HTMLElement)) return Array.from(node.childNodes).flatMap(blockLines);

  const tag = node.tagName.toLowerCase();
  if (tag === "h1" || tag === "h2" || tag === "h3") {
    return [`${"#".repeat(Number(tag.slice(1)))} ${inlineMarkdown(node).trim()}`];
  }
  if (tag === "blockquote") {
    const nested = Array.from(node.childNodes).flatMap(blockLines);
    const lines = nested.length ? nested : [inlineMarkdown(node).trim()];
    return lines.map((line) => `> ${line}`);
  }
  if (tag === "ul" || tag === "ol") {
    return Array.from(node.children).flatMap((child, index) => {
      if (child.tagName.toLowerCase() !== "li") return [];
      const prefix = tag === "ol" ? `${index + 1}. ` : "- ";
      return [`${prefix}${inlineMarkdown(child).trim()}`];
    });
  }
  if (tag === "pre") {
    const code = node.querySelector("code")?.textContent ?? node.textContent ?? "";
    return ["```", code.replace(/\n$/, ""), "```"];
  }
  if (tag === "hr") return ["---"];
  if (tag === "img") {
    const src = node.getAttribute("src") ?? "";
    const alt = node.getAttribute("alt") ?? "";
    return src ? [`![${escapeMarkdownLinkLabel(alt)}](${escapeMarkdownLinkHref(src)})`] : [];
  }
  if (tag === "table") {
    return Array.from(node.querySelectorAll("tr")).map((row) => {
      const cells = Array.from(row.children).map((cell) => inlineMarkdown(cell).trim());
      return `| ${cells.join(" | ")} |`;
    });
  }
  if (tag === "p" || tag === "div" || tag === "section" || tag === "article") {
    if (hasBlockChildren(node)) return Array.from(node.childNodes).flatMap(blockLines);
    const line = inlineMarkdown(node).trim();
    return line ? [line] : [];
  }
  const inline = inlineMarkdown(node).trim();
  return inline ? [inline] : [];
}

export function htmlToMarkdown(html: string, fallbackText = ""): string {
  if (!html.trim() || typeof DOMParser === "undefined") return fallbackText;
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const lines = Array.from(parsed.body.childNodes).flatMap(blockLines);
  return lines.join("\n").trim() || fallbackText;
}

export function clipboardDataToMarkdown(data: DataTransfer): string {
  const plainText = data.getData("text/plain");
  const html = data.getData("text/html");
  if (html.trim()) return htmlToMarkdown(html, plainText);
  return plainText;
}
