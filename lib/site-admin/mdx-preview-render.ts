import type { SiteAdminHomeData } from "./api-types";

const ATTR_RE = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/g;

type RenderRangeResult = {
  html: string;
  nextIndex: number;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function stripFrontmatter(source: string): string {
  const normalized = String(source || "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if ((lines[0] || "").trim() !== "---") return normalized;
  for (let index = 1; index < lines.length; index += 1) {
    if ((lines[index] || "").trim() === "---") {
      return lines.slice(index + 1).join("\n").replace(/^\n+/, "");
    }
  }
  return normalized;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(ATTR_RE)) {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function safeUrl(raw: string): string {
  const value = String(raw || "").trim();
  if (
    value.startsWith("/") ||
    value.startsWith("#") ||
    /^https?:\/\//i.test(value) ||
    /^mailto:/i.test(value)
  ) {
    return value;
  }
  return "";
}

function renderInline(raw: string): string {
  let html = escapeHtml(raw);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
    const url = safeUrl(String(href));
    const target =
      /^https?:\/\//i.test(url) && !url.includes("jinkunchen.com")
        ? ' target="_blank" rel="noopener noreferrer"'
        : "";
    return `<a href="${escapeAttr(url)}" class="notion-link link"${target}>${label}</a>`;
  });
  return html;
}

function isBlockStart(trimmed: string): boolean {
  return (
    trimmed.startsWith("```") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("![") ||
    trimmed.startsWith(">") ||
    trimmed.startsWith("<Columns") ||
    trimmed.startsWith("<details") ||
    trimmed.startsWith("<blockquote") ||
    /^<\/?[A-Z][\w]*\b/.test(trimmed) ||
    /^[-*]\s+/.test(trimmed) ||
    /^\d+\.\s+/.test(trimmed) ||
    /^---+$/.test(trimmed)
  );
}

function findClosingTag(lines: string[], startIndex: number, tagName: string): number {
  const close = `</${tagName}>`;
  for (let index = startIndex; index < lines.length; index += 1) {
    if ((lines[index] || "").trim() === close) return index;
  }
  return -1;
}

function renderImage(alt: string, src: string): string {
  const url = safeUrl(src);
  if (!url) return "";
  return `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" />`;
}

function renderList(lines: string[]): string {
  const numbered = /^\d+\.\s+/.test((lines[0] || "").trim());
  const tag = numbered ? "ol" : "ul";
  const items = lines
    .map((line) =>
      line
        .trim()
        .replace(/^[-*]\s+/, "")
        .replace(/^\d+\.\s+/, ""),
    )
    .map((item) => `<li class="notion-list-item notion-semantic-string">${renderInline(item)}</li>`)
    .join("");
  return `<${tag} class="notion-${numbered ? "numbered" : "bulleted"}-list">${items}</${tag}>`;
}

function renderColumns(lines: string[], index: number): RenderRangeResult {
  const opener = lines[index] || "";
  const attrs = parseAttrs(opener.replace(/^<Columns\b/, "").replace(/>$/, ""));
  const closeIndex = findClosingTag(lines, index + 1, "Columns");
  if (closeIndex === -1) {
    return {
      html: `<pre class="notion-code mdx-code"><code>${escapeHtml(opener)}</code></pre>`,
      nextIndex: index + 1,
    };
  }

  const columnSources: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines.slice(index + 1, closeIndex)) {
    const trimmed = line.trim();
    if (trimmed === "<Column>") {
      current = [];
      columnSources.push(current);
      continue;
    }
    if (trimmed === "</Column>") {
      current = null;
      continue;
    }
    if (current) current.push(line);
  }

  const declaredCount = Number(attrs.count);
  const count = declaredCount >= 3 ? 3 : 2;
  const gap = attrs.gap === "compact" || attrs.gap === "loose" ? attrs.gap : "standard";
  const align = attrs.align === "center" ? "center" : "start";
  const variant = attrs.variant === "classicIntro" ? " home-layout--variant-classicIntro" : "";
  const columns = columnSources
    .slice(0, count)
    .map((source) => `<div class="home-layout__column">${renderMdxPreviewHtml(source.join("\n"))}</div>`)
    .join("");

  return {
    html: `<section class="home-layout home-layout--cols-${count}${variant} home-layout--gap-${gap} home-layout--align-${align}"><div class="home-layout__grid">${columns}</div></section>`,
    nextIndex: closeIndex + 1,
  };
}

function renderDetails(lines: string[], index: number): RenderRangeResult {
  const opener = lines[index] || "";
  const closeIndex = findClosingTag(lines, index + 1, "details");
  if (closeIndex === -1) {
    return {
      html: `<pre class="notion-code mdx-code"><code>${escapeHtml(opener)}</code></pre>`,
      nextIndex: index + 1,
    };
  }
  const open = /\sopen\b/.test(opener) ? " open" : "";
  const inner = lines.slice(index + 1, closeIndex);
  const summaryIndex = inner.findIndex((line) => line.trim().startsWith("<summary>"));
  let summary = "Toggle";
  let bodyLines = inner;
  if (summaryIndex >= 0) {
    const summaryLine = inner[summaryIndex]?.trim() || "";
    summary = summaryLine.replace(/^<summary>/, "").replace(/<\/summary>$/, "");
    bodyLines = inner.slice(summaryIndex + 1);
  }
  return {
    html: `<details class="notion-toggle mdx-toggle"${open}><summary>${renderInline(summary)}</summary><div class="notion-toggle__content">${renderMdxPreviewHtml(bodyLines.join("\n"))}</div></details>`,
    nextIndex: closeIndex + 1,
  };
}

function renderJsxBlockquote(lines: string[], index: number): RenderRangeResult {
  const opener = lines[index] || "";
  const attrs = parseAttrs(opener.replace(/^<blockquote\b/, "").replace(/>$/, ""));
  const closeIndex = findClosingTag(lines, index + 1, "blockquote");
  if (closeIndex === -1) {
    return {
      html: `<blockquote class="notion-quote">${renderInline(opener)}</blockquote>`,
      nextIndex: index + 1,
    };
  }
  const className = attrs.className || "notion-quote";
  const body = lines.slice(index + 1, closeIndex).join("\n").trim();
  return {
    html: `<blockquote class="${escapeAttr(className)}">${renderMdxPreviewHtml(body)}</blockquote>`,
    nextIndex: closeIndex + 1,
  };
}

function renderNewsEntry(lines: string[], index: number): RenderRangeResult {
  const opener = lines[index] || "";
  const attrs = parseAttrs(opener.replace(/^<NewsEntry\b/, "").replace(/>$/, ""));
  const closeIndex = findClosingTag(lines, index + 1, "NewsEntry");
  if (closeIndex === -1) {
    return {
      html: `<pre class="notion-code mdx-code"><code>${escapeHtml(opener)}</code></pre>`,
      nextIndex: index + 1,
    };
  }
  const body = lines.slice(index + 1, closeIndex).join("\n").trim();
  return {
    html: `<section class="mdx-preview-entry mdx-preview-entry--news"><h2 class="notion-heading notion-semantic-string">${renderInline(attrs.date || "Undated")}</h2><div class="news-entry__body">${renderMdxPreviewHtml(body)}</div></section>`,
    nextIndex: closeIndex + 1,
  };
}

function renderWorksEntry(lines: string[], index: number): RenderRangeResult {
  const opener = lines[index] || "";
  const attrs = parseAttrs(opener.replace(/^<WorksEntry\b/, "").replace(/>$/, ""));
  const closeIndex = findClosingTag(lines, index + 1, "WorksEntry");
  if (closeIndex === -1) {
    return {
      html: `<pre class="notion-code mdx-code"><code>${escapeHtml(opener)}</code></pre>`,
      nextIndex: index + 1,
    };
  }
  const body = lines.slice(index + 1, closeIndex).join("\n").trim();
  const title = attrs.role || "Untitled role";
  const detail = [attrs.affiliation, attrs.period, attrs.location]
    .filter(Boolean)
    .join(" · ");
  return {
    html: `<section class="mdx-preview-entry mdx-preview-entry--works"><h2 class="notion-heading notion-semantic-string">${renderInline(title)}</h2>${detail ? `<p class="notion-text notion-text__content notion-semantic-string">${renderInline(detail)}</p>` : ""}${body ? renderMdxPreviewHtml(body) : ""}</section>`,
    nextIndex: closeIndex + 1,
  };
}

function renderSelfClosingJsx(trimmed: string): string {
  const match = /^<([A-Z][\w]*)([\s\S]*?)\/>$/.exec(trimmed);
  if (!match) return `<pre class="notion-code mdx-code"><code>${escapeHtml(trimmed)}</code></pre>`;

  const tag = match[1];
  const attrs = parseAttrs(match[2] || "");
  if (tag === "Bookmark") {
    const title = attrs.title || attrs.url || "Bookmark";
    const url = safeUrl(attrs.url || "");
    return `<a class="notion-bookmark mdx-bookmark" href="${escapeAttr(url)}"><strong>${renderInline(title)}</strong>${attrs.description ? `<span>${renderInline(attrs.description)}</span>` : ""}</a>`;
  }
  if (tag === "PageLink") {
    const slug = attrs.slug || "";
    const href = safeUrl(slug.startsWith("/") ? slug : `/${slug}`);
    return `<p class="notion-text notion-text__content notion-semantic-string"><a class="notion-link link" href="${escapeAttr(href)}">${renderInline(attrs.title || slug || "Page")}</a></p>`;
  }
  if (tag === "HeroBlock") {
    const title = attrs.title || "";
    const subtitle = attrs.subtitle || "";
    const img = attrs.imageUrl ? renderImage(attrs.imageAlt || title, attrs.imageUrl) : "";
    return `<section class="home-hero-block mdx-preview-hero">${img}<div>${title ? `<h2 class="notion-heading notion-semantic-string">${renderInline(title)}</h2>` : ""}${subtitle ? `<p class="notion-text notion-text__content notion-semantic-string">${renderInline(subtitle)}</p>` : ""}</div></section>`;
  }
  if (tag === "LinkListBlock" || tag === "FeaturedPagesBlock") {
    const title = attrs.title || (tag === "FeaturedPagesBlock" ? "Featured pages" : "Links");
    return `<section class="notion-callout mdx-preview-card"><strong>${renderInline(title)}</strong></section>`;
  }
  if (
    tag === "NewsBlock" ||
    tag === "PublicationsBlock" ||
    tag === "WorksBlock" ||
    tag === "TeachingBlock"
  ) {
    return `<div class="notion-callout mdx-preview-card">${escapeHtml(tag.replace(/Block$/, ""))}</div>`;
  }
  if (tag === "FileLink") {
    const href = safeUrl(attrs.href || "");
    return `<p class="notion-text notion-text__content notion-semantic-string"><a class="notion-link link" href="${escapeAttr(href)}">${renderInline(attrs.filename || href || "File")}</a></p>`;
  }
  if (tag === "Embed" || tag === "Video") {
    const url = safeUrl(attrs.src || attrs.url || "");
    return `<p class="notion-text notion-text__content notion-semantic-string"><a class="notion-link link" href="${escapeAttr(url)}">${renderInline(attrs.title || url || tag)}</a></p>`;
  }
  if (tag === "TeachingEntry") {
    const title = [attrs.courseCode, attrs.courseName].filter(Boolean).join(" · ") || "Untitled course";
    const detail = [attrs.term, attrs.role, attrs.period, attrs.instructor]
      .filter(Boolean)
      .join(" · ");
    const href = safeUrl(attrs.courseUrl || "");
    const titleHtml = href
      ? `<a class="notion-link link" href="${escapeAttr(href)}">${renderInline(title)}</a>`
      : renderInline(title);
    return `<p class="notion-text notion-text__content notion-semantic-string"><strong>${titleHtml}</strong>${detail ? `<br /><span>${renderInline(detail)}</span>` : ""}</p>`;
  }
  if (tag === "PublicationsEntry") {
    let entry: Record<string, unknown> = {};
    try {
      entry = JSON.parse((attrs.data || "{}").replace(/\\u0027/g, "'"));
    } catch {
      entry = {};
    }
    const title = typeof entry.title === "string" ? entry.title : "Untitled publication";
    const year = typeof entry.year === "string" ? entry.year : "";
    const url = typeof entry.url === "string" ? safeUrl(entry.url) : "";
    const titleHtml = url
      ? `<a class="notion-link link" href="${escapeAttr(url)}">${renderInline(title)}</a>`
      : renderInline(title);
    return `<p class="notion-text notion-text__content notion-semantic-string"><strong>${titleHtml}</strong>${year ? ` <span>${renderInline(year)}</span>` : ""}</p>`;
  }
  return `<pre class="notion-code mdx-code"><code>${escapeHtml(trimmed)}</code></pre>`;
}

function renderRange(lines: string[], startIndex = 0): RenderRangeResult {
  const html: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] || "";
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const language = trimmed.replace(/^```/, "").trim();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && (lines[index] || "").trim() !== "```") {
        body.push(lines[index] || "");
        index += 1;
      }
      if ((lines[index] || "").trim() === "```") index += 1;
      html.push(
        `<pre class="notion-code mdx-code language-${escapeAttr(language)}"><code>${escapeHtml(body.join("\n"))}</code></pre>`,
      );
      continue;
    }

    if (trimmed.startsWith("<Columns")) {
      const result = renderColumns(lines, index);
      html.push(result.html);
      index = result.nextIndex;
      continue;
    }

    if (trimmed.startsWith("<details")) {
      const result = renderDetails(lines, index);
      html.push(result.html);
      index = result.nextIndex;
      continue;
    }

    if (trimmed.startsWith("<blockquote")) {
      const result = renderJsxBlockquote(lines, index);
      html.push(result.html);
      index = result.nextIndex;
      continue;
    }

    if (trimmed.startsWith("<NewsEntry")) {
      const result = renderNewsEntry(lines, index);
      html.push(result.html);
      index = result.nextIndex;
      continue;
    }

    if (trimmed.startsWith("<WorksEntry")) {
      const result = renderWorksEntry(lines, index);
      html.push(result.html);
      index = result.nextIndex;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      html.push('<hr class="notion-hr" />');
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const level = Math.min(6, heading[1].length);
      html.push(
        `<h${level} class="notion-heading notion-semantic-string">${renderInline(heading[2])}</h${level}>`,
      );
      index += 1;
      continue;
    }

    const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(trimmed);
    if (image) {
      html.push(renderImage(image[1], image[2]));
      index += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const body: string[] = [];
      while (index < lines.length && (lines[index] || "").trim().startsWith(">")) {
        body.push((lines[index] || "").replace(/^>\s?/, ""));
        index += 1;
      }
      html.push(`<blockquote class="notion-quote">${renderMdxPreviewHtml(body.join("\n"))}</blockquote>`);
      continue;
    }

    if (/^(?:[-*]|\d+\.)\s+/.test(trimmed)) {
      const listLines: string[] = [];
      while (index < lines.length && /^(?:[-*]|\d+\.)\s+/.test((lines[index] || "").trim())) {
        listLines.push(lines[index] || "");
        index += 1;
      }
      html.push(renderList(listLines));
      continue;
    }

    if (/^<[A-Z][\w]*\b[\s\S]*\/>$/.test(trimmed)) {
      html.push(renderSelfClosingJsx(trimmed));
      index += 1;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] || "";
      const currentTrimmed = current.trim();
      if (!currentTrimmed) break;
      if (paragraph.length > 0 && isBlockStart(currentTrimmed)) break;
      paragraph.push(current);
      index += 1;
    }
    html.push(
      `<p class="notion-text notion-text__content notion-semantic-string">${renderInline(paragraph.join("\n"))}</p>`,
    );
  }

  return { html: html.join(""), nextIndex: index };
}

export function renderMdxPreviewHtml(source: string): string {
  const body = stripFrontmatter(source);
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  return renderRange(lines).html;
}

export function renderHomePreviewShellHtml(data: SiteAdminHomeData): string {
  const title = data.title || "Hi there!";
  const body = renderMdxPreviewHtml(data.bodyMdx || "");
  return [
    '<main id="main-content" class="super-content page__index parent-page__index">',
    '<div class="notion-header page">',
    '<div class="notion-header__cover no-cover no-icon"></div>',
    '<div class="notion-header__content max-width no-cover no-icon">',
    '<div class="notion-header__title-wrapper">',
    `<h1 class="notion-header__title">${renderInline(title)}</h1>`,
    "</div></div></div>",
    `<article class="notion-root max-width has-footer"><div class="mdx-post__body">${body}</div></article>`,
    "</main>",
  ].join("");
}

export function isMdxRuntimeCodeGenerationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Code generation from strings disallowed") ||
    message.includes("unsafe-eval") ||
    message.includes("new Function")
  );
}
