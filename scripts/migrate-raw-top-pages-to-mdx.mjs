#!/usr/bin/env node
// One-shot migration: convert Notion-synced top-level pages
// (`content/generated/raw/<slug>.html`) into `content/pages/<slug>.mdx`
// so site-admin can edit them and the catch-all route serves them from
// the new MDX pipeline. The public URL stays `/<slug>`.
//
// Scoped to a curated allow-list — `/blog`, `/index`, `/publications`
// (dedicated routes), and any 32-hex UUID-named pages (Notion page-id
// leftovers) are excluded. Idempotent: skips slugs that already exist
// under content/pages/.
//
// Prefer `content/generated/raw/` (CDN-rewritten) as the source of
// truth; `content/raw/` has notion-CDN URLs that 404 after signature
// expiry.

import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import TurndownService from "turndown";

const SOURCE_DIR = "content/generated/raw";
const DEST_DIR = "content/pages";

// Slugs that should NOT be migrated (handled by dedicated routes or
// semantically not "a page" in the admin sense).
const EXCLUDE = new Set([
  "index",         // `/` home page — dedicated route + hero content
  "blog",          // `/blog` landing — dedicated route
  "publications",  // `/publications` — dedicated route w/ custom components
  "blog/list",     // redirect route
]);

function isNotionUuid(slug) {
  return /^[0-9a-f]{32}$/i.test(slug);
}

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

function buildFrontmatter({ title, description, updatedIso }) {
  const lines = ["---", `title: ${escapeYaml(title)}`];
  if (description && description.trim()) {
    lines.push(`description: ${escapeYaml(description.trim())}`);
  }
  if (updatedIso) {
    lines.push(`updated: ${updatedIso}`);
  }
  lines.push("draft: false");
  lines.push("---");
  return lines.join("\n");
}

function trimMd(md) {
  return String(md)
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/g, "");
}

function makeTurndown() {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    bulletListMarker: "-",
    hr: "---",
  });
  td.remove(["svg", "style", "script", "noscript"]);
  td.addRule("dropAnchorSpans", {
    filter: (node) =>
      node.nodeName === "SPAN" &&
      node.getAttribute &&
      String(node.getAttribute("class") || "").includes("notion-heading__anchor"),
    replacement: () => "",
  });
  // Notion wraps images in a .notion-image div with a span[data-full-size].
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

  // Some top-level pages have no "date" property, but may have "updated"
  // or similar. Be defensive: just take whatever's in the Date property
  // if present; else leave blank.
  const dateRaw =
    $(".notion-property__date .date").first().text().trim() ||
    $(".notion-property__date").first().text().trim();
  const updatedIso = parseNotionDate(dateRaw);

  const article = $("article.notion-root").first();
  article.find(".notion-page__properties").remove();
  article.find(".notion-table-of-contents").remove();
  article.find(".notion-breadcrumb").remove();
  article.find(".notion-navbar").remove();
  article.find(".notion-header").remove();
  article.find("#block-root-divider").remove();
  const firstDivider = article.find(".notion-divider").first();
  if (firstDivider.length) firstDivider.remove();

  // Replace KaTeX with placeholders so `$LATEX$` survives turndown.
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

  const firstPara = article.find("p").first().text().trim();
  const description = firstPara.length > 160
    ? firstPara.slice(0, 157).trim() + "…"
    : firstPara;

  return { title, updatedIso, description, bodyHtml, mathMap };
}

function rehydrateMath(md, mathMap) {
  let out = md;
  for (const [id, { tex, isDisplay }] of mathMap.entries()) {
    const wrapped = isDisplay ? `\n\n$$${tex}$$\n\n` : `$${tex}$`;
    out = out.split(id).join(wrapped);
  }
  return out;
}

function escapeMdxBraces(md) {
  let out = "";
  let i = 0;
  let inCodeFence = false;
  const s = String(md);
  while (i < s.length) {
    if ((i === 0 || s[i - 1] === "\n") && s.startsWith("```", i)) {
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
    if (s.startsWith("$$", i)) {
      const end = s.indexOf("$$", i + 2);
      if (end === -1) { out += s.slice(i); break; }
      out += s.slice(i, end + 2);
      i = end + 2;
      continue;
    }
    if (s[i] === "$") {
      let j = i + 1;
      while (j < s.length && s[j] !== "$" && s[j] !== "\n") j += 1;
      if (j < s.length && s[j] === "$") {
        out += s.slice(i, j + 1);
        i = j + 1;
        continue;
      }
    }
    if (s[i] === "`") {
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
    out += (ch === "{" || ch === "}") ? `\\${ch}` : ch;
    i += 1;
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
    if (EXCLUDE.has(slug)) {
      rows.push({ slug, action: "SKIP (excluded)" });
      continue;
    }
    if (isNotionUuid(slug)) {
      rows.push({ slug, action: "SKIP (uuid)" });
      continue;
    }

    const destPath = path.join(DEST_DIR, `${slug}.mdx`);
    try {
      await fs.access(destPath);
      rows.push({ slug, action: "SKIP (exists)" });
      continue;
    } catch {
      // fine
    }

    const html = await fs.readFile(path.join(SOURCE_DIR, file), "utf8");
    const { title, updatedIso, description, bodyHtml, mathMap } = extract(html);
    if (!title) {
      rows.push({ slug, action: "SKIP (no title)" });
      continue;
    }
    const rawMd = trimMd(td.turndown(bodyHtml));
    const withMath = rehydrateMath(rawMd, mathMap);
    const bodyMd = escapeMdxBraces(withMath);
    const frontmatter = buildFrontmatter({ title, description, updatedIso });
    const mdx = `${frontmatter}\n\n${bodyMd}\n`;
    await fs.writeFile(destPath, mdx);
    rows.push({ slug, action: "WRITE", title, updatedIso, bytes: mdx.length });
  }

  for (const row of rows) {
    console.log(
      `${row.action}\t${row.slug}${row.title ? `\t"${row.title}"` : ""}${row.updatedIso ? `\t${row.updatedIso}` : ""}`,
    );
  }
  const written = rows.filter((r) => r.action === "WRITE").length;
  const skipped = rows.filter((r) => String(r.action).startsWith("SKIP")).length;
  console.log(`\nDone. ${written} written, ${skipped} skipped.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
