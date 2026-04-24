#!/usr/bin/env node
// One-shot migration: convert Notion-synced `content/generated/raw/blog/list/*.html`
// into the new MDX system (`content/posts/*.mdx`) so they show up in site-admin.
//
// Source HTML is the "generated" version (CDN-rewritten URLs like
// cdn.jinkunchen.com/...) — raw/ has Notion-CDN URLs that 404 after signed-URL
// expiry, so we prefer generated/. Run after `npm run sync:raw` if generated/
// is out of date.
//
// Idempotent: skips slugs that already exist in content/posts/. Safe to re-run.

import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import TurndownService from "turndown";

const SOURCE_DIR = "content/generated/raw/blog/list";
const DEST_DIR = "content/posts";

// Notion emits dates like "January 5, 2026". Return YYYY-MM-DD or "".
function parseNotionDate(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const d = new Date(raw);
  if (!Number.isFinite(d.valueOf())) return "";
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function escapeYaml(s) {
  return `"${String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")}"`;
}

function buildFrontmatter({ title, dateIso, description }) {
  const lines = ["---", `title: ${escapeYaml(title)}`, `date: ${dateIso}`];
  if (description && description.trim()) {
    lines.push(`description: ${escapeYaml(description.trim())}`);
  }
  lines.push("draft: false");
  lines.push("---");
  return lines.join("\n");
}

function trimMd(md) {
  // Collapse 3+ blank lines, trim leading/trailing blanks.
  return String(md)
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/g, "");
}

// Safety net: escape `{` / `}` outside of math (`$...$` / `$$...$$`) and
// code (`` ` `` inline or fenced) because MDX would parse them as JSX
// expression braces and blow up. Math spans are already delimited with
// `$` by the KaTeX extraction above, so remark-math swallows them first.
function escapeMdxBraces(md) {
  let out = "";
  let i = 0;
  let inMath = false; // toggle on $
  let inDisplayMath = false; // toggle on $$
  let inCodeFence = false; // toggle on ``` at line start
  let inInlineCode = false; // toggle on single/double/triple backtick inline
  const s = String(md);

  while (i < s.length) {
    // Fenced code block on its own line.
    if (
      (i === 0 || s[i - 1] === "\n") &&
      s.startsWith("```", i)
    ) {
      // Walk to end of line.
      const eol = s.indexOf("\n", i);
      const chunk = eol === -1 ? s.slice(i) : s.slice(i, eol + 1);
      out += chunk;
      i += chunk.length;
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) {
      out += s[i];
      i += 1;
      continue;
    }
    // Display math `$$...$$` — greedy match through the closing `$$`.
    if (!inMath && !inInlineCode && s.startsWith("$$", i)) {
      // Find closing $$
      const end = s.indexOf("$$", i + 2);
      if (end === -1) {
        out += s.slice(i);
        break;
      }
      out += s.slice(i, end + 2);
      i = end + 2;
      inDisplayMath = false;
      continue;
    }
    // Inline math `$...$`.
    if (!inDisplayMath && !inInlineCode && s[i] === "$") {
      // Take text up to the next un-escaped `$` on the same line.
      let j = i + 1;
      while (j < s.length && s[j] !== "$" && s[j] !== "\n") j += 1;
      if (j < s.length && s[j] === "$") {
        out += s.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      // Unclosed — treat as literal.
    }
    // Inline code (single or multi-backtick).
    if (!inDisplayMath && !inMath && s[i] === "`") {
      // Count consecutive backticks.
      let n = 0;
      while (s[i + n] === "`") n += 1;
      const closer = "`".repeat(n);
      const end = s.indexOf(closer, i + n);
      if (end !== -1) {
        out += s.slice(i, end + n);
        i = end + n;
        continue;
      }
    }
    const ch = s[i];
    if (ch === "{" || ch === "}") {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
    i += 1;
  }
  return out;
}

function makeTurndown() {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    bulletListMarker: "-",
    hr: "---",
  });
  // Strip icons + scripts + style blobs.
  td.remove(["svg", "style", "script", "noscript"]);
  // Drop Notion heading anchor <span> siblings.
  td.addRule("dropAnchorSpans", {
    filter: (node) =>
      node.nodeName === "SPAN" &&
      node.getAttribute &&
      String(node.getAttribute("class") || "").includes("notion-heading__anchor"),
    replacement: () => "",
  });
  // Notion wraps images in a <span data-full-size="..."> — use the src
  // attribute of the inner <img> (the best-quality src).
  td.addRule("notionImage", {
    filter: (node) =>
      node.nodeName === "DIV" &&
      String(node.getAttribute("class") || "").includes("notion-image"),
    replacement: (_content, node) => {
      const img = node.querySelector("img");
      if (!img) return "";
      const src =
        img.getAttribute("data-full-size") ||
        img.getAttribute("src") ||
        "";
      const alt = img.getAttribute("alt") || "";
      if (!src) return "";
      return `\n\n![${alt}](${src})\n\n`;
    },
  });
  return td;
}

function extract(html) {
  const $ = cheerio.load(html);

  const title = $(".notion-header__title").first().text().trim();
  const dateRaw = $(".notion-property__date .date").first().text().trim();
  const dateIso = parseNotionDate(dateRaw);

  const article = $("article.notion-root").first();
  // Drop the elements that aren't body content.
  article.find(".notion-page__properties").remove();
  article.find(".notion-table-of-contents").remove();
  article.find(".notion-breadcrumb").remove();
  article.find(".notion-navbar").remove();
  article.find(".notion-header").remove();
  article.find("#block-root-divider").remove();
  // Notion sometimes renders a leading divider right after the TOC.
  const firstDivider = article.find(".notion-divider").first();
  if (firstDivider.length) firstDivider.remove();

  // Extract KaTeX math + replace with a placeholder token that turndown
  // won't touch (all-letter sentinels). After turndown runs we'll swap
  // the tokens back for `$LATEX$` / `$$LATEX$$`. Source of truth is the
  // <annotation encoding="application/x-tex"> inside .katex-mathml.
  const mathMap = new Map();
  let counter = 0;
  article.find("span.katex").each((_i, el) => {
    const node = $(el);
    const tex = node
      .find("annotation[encoding='application/x-tex']")
      .first()
      .text()
      .trim();
    if (!tex) {
      node.remove();
      return;
    }
    const isDisplay =
      node.parent().hasClass("katex-display") ||
      node.hasClass("katex-display");
    const id = `XXMATH${counter++}XXMATHEND`;
    mathMap.set(id, { tex, isDisplay });
    node.replaceWith(id);
  });

  const bodyHtml = article.html() ?? "";

  // Description: first meaningful paragraph text, trimmed to ~160 chars.
  const firstPara = article.find("p").first().text().trim();
  const description = firstPara.length > 160
    ? firstPara.slice(0, 157).trim() + "…"
    : firstPara;

  return { title, dateIso, description, bodyHtml, mathMap };
}

// Substitute math placeholders back after turndown processing.
function rehydrateMath(md, mathMap) {
  let out = md;
  for (const [id, { tex, isDisplay }] of mathMap.entries()) {
    const wrapped = isDisplay ? `\n\n$$${tex}$$\n\n` : `$${tex}$`;
    out = out.split(id).join(wrapped);
  }
  return out;
}

async function main() {
  const td = makeTurndown();
  let files;
  try {
    files = await fs.readdir(SOURCE_DIR);
  } catch (err) {
    console.error(`Cannot read source dir ${SOURCE_DIR}:`, err.message);
    process.exit(1);
  }
  await fs.mkdir(DEST_DIR, { recursive: true });

  const rows = [];
  for (const file of files.sort()) {
    if (!file.endsWith(".html")) continue;
    const slug = file.replace(/\.html$/, "");
    const destPath = path.join(DEST_DIR, `${slug}.mdx`);

    let existed = false;
    try {
      await fs.access(destPath);
      existed = true;
    } catch {
      // fine
    }
    if (existed) {
      rows.push({ slug, action: "SKIP (exists)" });
      continue;
    }

    const html = await fs.readFile(path.join(SOURCE_DIR, file), "utf8");
    const { title, dateIso, description, bodyHtml, mathMap } = extract(html);
    if (!title) {
      rows.push({ slug, action: "SKIP (no title)" });
      continue;
    }
    const rawMd = trimMd(td.turndown(bodyHtml));
    const withMath = rehydrateMath(rawMd, mathMap);
    const bodyMd = escapeMdxBraces(withMath);
    const frontmatter = buildFrontmatter({ title, dateIso, description });
    const mdx = `${frontmatter}\n\n${bodyMd}\n`;
    await fs.writeFile(destPath, mdx);
    rows.push({ slug, action: "WRITE", title, dateIso, bytes: mdx.length });
  }

  for (const row of rows) {
    console.log(`${row.action}\t${row.slug}${row.title ? `\t"${row.title}"` : ""}${row.dateIso ? `\t${row.dateIso}` : ""}`);
  }
  console.log(`\nDone. ${rows.filter((r) => r.action === "WRITE").length} written, ${rows.filter((r) => String(r.action).startsWith("SKIP")).length} skipped.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
