#!/usr/bin/env node
// One-shot migration that ports the workspace's homeSectionsToMdx helper
// (apps/workspace/src/surfaces/site-admin/home-builder/migrate-to-mdx.ts)
// to plain Node so we can run it against `content/home.json` directly.
// Adds `bodyMdx` to the file when missing — leaves `sections` intact so
// the public site keeps rendering the existing layout until someone is
// happy with the new MDX. Idempotent.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const HERO_DEFAULT_IMAGE_POS = "right";
const HERO_DEFAULT_TEXT_ALIGN = "left";
const FEATURED_DEFAULT_COLUMNS = 2;

function escapeJsxAttr(value) {
  return String(value).replace(/"/g, "&quot;");
}

function jsxAttr(name, value) {
  if (value === undefined || value === "") return "";
  return ` ${name}="${escapeJsxAttr(value)}"`;
}

function jsxNumAttr(name, value) {
  if (value === undefined) return "";
  return ` ${name}={${value}}`;
}

function jsxJsonAttr(name, value) {
  if (value === undefined) return "";
  const json = JSON.stringify(value).replace(/'/g, "\\u0027");
  return ` ${name}='${json}'`;
}

function ensureBlankLineBetween(parts) {
  return parts
    .map((part) => String(part).trim())
    .filter((part) => part.length > 0)
    .join("\n\n");
}

function migrateHero(section) {
  const imagePosition =
    section.imagePosition !== HERO_DEFAULT_IMAGE_POS
      ? section.imagePosition
      : undefined;
  const textAlign =
    section.textAlign !== HERO_DEFAULT_TEXT_ALIGN ? section.textAlign : undefined;
  const heroTag =
    "<HeroBlock" +
    jsxAttr("title", section.title || undefined) +
    jsxAttr("imageUrl", section.profileImageUrl) +
    jsxAttr("imageAlt", section.profileImageAlt) +
    jsxAttr("imagePosition", imagePosition) +
    jsxAttr("textAlign", textAlign) +
    " />";
  const body = section.body?.trim() || "";
  const note = body
    ? "Hero body markdown moved to a paragraph block below the HeroBlock — review."
    : null;
  return {
    mdx: ensureBlankLineBetween([heroTag, body]),
    note,
  };
}

function migrateRichText(section) {
  const heading = section.title ? `## ${section.title}` : "";
  const body = section.body?.trim() || "";
  const lossNote =
    section.tone !== "plain" ||
    section.variant !== "standard" ||
    section.textAlign !== "left"
      ? `Rich-text "${section.title || "(untitled)"}": tone/variant/textAlign were not preserved (no MDX equivalent yet).`
      : null;
  return { mdx: ensureBlankLineBetween([heading, body]), note: lossNote };
}

function migrateLinkList(section) {
  const intro = section.body?.trim() || "";
  const items = (section.links || [])
    .filter((link) => link.label || link.href)
    .map((link) => {
      const item = { label: link.label || "", href: link.href || "" };
      if (link.description) item.description = link.description;
      return item;
    });
  const layoutAttr =
    section.layout !== "stack" ? jsxAttr("layout", section.layout) : "";
  const tag =
    "<LinkListBlock" +
    jsxAttr("title", section.title) +
    layoutAttr +
    (items.length > 0 ? jsxJsonAttr("items", items) : "") +
    " />";
  return { mdx: ensureBlankLineBetween([intro, tag]), note: null };
}

function migrateFeatured(section) {
  const intro = section.body?.trim() || "";
  const items = (section.items || [])
    .filter((link) => link.label || link.href)
    .map((link) => {
      const item = { label: link.label || "", href: link.href || "" };
      if (link.description) item.description = link.description;
      return item;
    });
  const columnsAttr =
    section.columns !== FEATURED_DEFAULT_COLUMNS
      ? jsxNumAttr("columns", section.columns)
      : "";
  const tag =
    "<FeaturedPagesBlock" +
    jsxAttr("title", section.title) +
    columnsAttr +
    (items.length > 0 ? jsxJsonAttr("items", items) : "") +
    " />";
  return { mdx: ensureBlankLineBetween([intro, tag]), note: null };
}

function renderLayoutBlock(block) {
  if (block.type === "image") {
    if (!block.url) return "";
    const alt = block.alt || "";
    const caption = block.caption ? `\n\n*${block.caption}*` : "";
    return `![${alt}](${block.url})${caption}`;
  }
  if (block.type === "markdown") {
    const heading = block.title ? `### ${block.title}` : "";
    const body = block.body?.trim() || "";
    return ensureBlankLineBetween([heading, body]);
  }
  return "";
}

function migrateLayout(section) {
  const cols = section.columns >= 1 && section.columns <= 3 ? section.columns : 2;
  // Group blocks by their column index (1-based in the source schema).
  const byColumn = Array.from({ length: cols }, (_, i) => {
    const target = i + 1;
    return (section.blocks || [])
      .filter((block) => block.column === target)
      .map(renderLayoutBlock)
      .filter((mdx) => mdx.length > 0)
      .join("\n\n");
  });

  // 1-column layouts don't need a Columns wrapper — emit the markdown
  // straight through.
  if (cols === 1) {
    const flat = byColumn.filter((c) => c.length > 0).join("\n\n");
    const lines = [];
    if (section.title) lines.push(`## ${section.title}`);
    if (flat) lines.push(flat);
    return { mdx: ensureBlankLineBetween(lines), note: null };
  }

  const variantAttr =
    section.variant === "classicIntro" ? ` variant="classicIntro"` : "";
  const gapAttr =
    section.gap && section.gap !== "standard" ? ` gap="${section.gap}"` : "";
  const alignAttr =
    section.verticalAlign && section.verticalAlign !== "start"
      ? ` align="${section.verticalAlign}"`
      : "";

  const columnTags = byColumn
    .map((columnMdx) => `<Column>\n\n${columnMdx || "&nbsp;"}\n\n</Column>`)
    .join("\n");

  const wrapper =
    `<Columns count={${cols}}${variantAttr}${gapAttr}${alignAttr}>\n` +
    columnTags +
    `\n</Columns>`;

  const lines = [];
  if (section.title) lines.push(`## ${section.title}`);
  lines.push(wrapper);

  return {
    mdx: ensureBlankLineBetween(lines),
    note:
      cols > 1
        ? `Layout "${section.title || "(untitled)"}": preserved as <Columns count={${cols}}${variantAttr}/>. Visual fidelity should match the original.`
        : null,
  };
}

function migrateOne(section) {
  if (!section.enabled) return { mdx: "", note: null };
  if (section.type === "hero") return migrateHero(section);
  if (section.type === "richText") return migrateRichText(section);
  if (section.type === "linkList") return migrateLinkList(section);
  if (section.type === "featuredPages") return migrateFeatured(section);
  if (section.type === "layout") return migrateLayout(section);
  return { mdx: "", note: null };
}

function homeSectionsToMdx(data) {
  const parts = [];
  const notes = [];
  for (const section of data.sections || []) {
    const { mdx, note } = migrateOne(section);
    if (mdx) parts.push(mdx);
    if (note) notes.push(note);
  }
  const body = ensureBlankLineBetween(parts);
  return { mdx: body ? `${body}\n` : "", notes };
}

const file = resolve(process.cwd(), "content/home.json");
const raw = JSON.parse(readFileSync(file, "utf8"));

if (typeof raw.bodyMdx === "string" && raw.bodyMdx.trim()) {
  console.log("[home-migrate-mdx] bodyMdx already populated — leaving as-is.");
  process.exit(0);
}

const { mdx, notes } = homeSectionsToMdx(raw);

if (!mdx) {
  console.log("[home-migrate-mdx] No enabled sections to migrate.");
  process.exit(0);
}

const next = { ...raw, bodyMdx: mdx };
writeFileSync(file, JSON.stringify(next, null, 2) + "\n", "utf8");

console.log(`[home-migrate-mdx] Wrote bodyMdx (${mdx.length} chars) to content/home.json.`);
if (notes.length > 0) {
  console.log("[home-migrate-mdx] Migration notes (review the result):");
  for (const note of notes) console.log(`  - ${note}`);
}
