// One-shot, best-effort converter from the typed home.json `sections`
// array into a Notion-style markdown body that uses the new HeroBlock /
// LinkListBlock / FeaturedPagesBlock primitives shipped in Phase 3.
// Lossy by design — `width`, `variant`, `tone`, layout-section columns
// don't all map to the new blocks. The user previews the result inside
// HomePanel's Notion mode and edits.

import type {
  HomeData,
  HomeSection,
  HomeFeaturedPagesSection,
  HomeHeroSection,
  HomeLink,
  HomeLinkListSection,
  HomeLayoutSection,
  HomeRichTextSection,
} from "../types";

interface MigrationResult {
  /** Rendered MDX body, ready to paste into bodyMdx. Empty string when
   * there are no enabled sections. */
  mdx: string;
  /** Human-readable per-section notes — what mapped cleanly, what was
   * dropped, what was simplified. Surface to the user so they can spot
   * losses before saving. */
  notes: string[];
}

const HERO_DEFAULT_IMAGE_POS = "right";
const HERO_DEFAULT_TEXT_ALIGN = "left";
const FEATURED_DEFAULT_COLUMNS = 2;

function escapeJsxAttr(value: string): string {
  return value.replace(/"/g, "&quot;");
}

function jsxAttr(name: string, value: string | undefined): string {
  if (value === undefined || value === "") return "";
  return ` ${name}="${escapeJsxAttr(value)}"`;
}

function jsxNumAttr(name: string, value: number | undefined): string {
  if (value === undefined) return "";
  return ` ${name}={${value}}`;
}

function jsxJsonAttr(name: string, value: unknown): string {
  if (value === undefined) return "";
  // Mirrors `jsonAttr` from mdx-blocks.ts — single-quoted attribute
  // with `'` escaped as the JSON unicode escape so apostrophes survive.
  const json = JSON.stringify(value).replace(/'/g, "\\u0027");
  return ` ${name}='${json}'`;
}

function ensureBlankLineBetween(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n\n");
}

function migrateHero(section: HomeHeroSection): { mdx: string; note?: string } {
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
    : undefined;
  return {
    mdx: ensureBlankLineBetween([heroTag, body]),
    note,
  };
}

function migrateRichText(section: HomeRichTextSection): {
  mdx: string;
  note?: string;
} {
  const heading = section.title ? `## ${section.title}` : "";
  const body = section.body?.trim() || "";
  const lossNote =
    section.tone !== "plain" || section.variant !== "standard" || section.textAlign !== "left"
      ? `Rich-text "${section.title || "(untitled)"}": tone/variant/textAlign were not preserved (no MDX equivalent yet).`
      : undefined;
  return {
    mdx: ensureBlankLineBetween([heading, body]),
    note: lossNote,
  };
}

function migrateLinkList(section: HomeLinkListSection): {
  mdx: string;
  note?: string;
} {
  const intro = section.body?.trim() || "";
  // HomeLinkList items are HomeLink (label, href, description?). The
  // LinkListBlock schema mirrors the same {label, href, description?}.
  const items = section.links
    .filter((link) => link.label || link.href)
    .map((link) => {
      const item: { label: string; href: string; description?: string } = {
        label: link.label || "",
        href: link.href || "",
      };
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
  return { mdx: ensureBlankLineBetween([intro, tag]) };
}

function migrateFeatured(section: HomeFeaturedPagesSection): {
  mdx: string;
  note?: string;
} {
  const intro = section.body?.trim() || "";
  const items = section.items
    .filter((link: HomeLink) => link.label || link.href)
    .map((link: HomeLink) => {
      const item: { label: string; href: string; description?: string } = {
        label: link.label || "",
        href: link.href || "",
      };
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
  return { mdx: ensureBlankLineBetween([intro, tag]) };
}

function migrateLayout(section: HomeLayoutSection): {
  mdx: string;
  note?: string;
} {
  // Layout sections are 1–3 columns of mixed markdown / image blocks.
  // No multi-column container exists in the new block set, so we
  // linearize: emit each block in column order. Lossy on layout, not
  // on content.
  const lines: string[] = [];
  if (section.title) lines.push(`## ${section.title}`);
  for (const block of section.blocks) {
    if (block.type === "markdown") {
      const heading = block.title ? `### ${block.title}` : "";
      const body = block.body?.trim() || "";
      const merged = ensureBlankLineBetween([heading, body]);
      if (merged) lines.push(merged);
    } else if (block.type === "image") {
      if (!block.url) continue;
      const alt = block.alt || "";
      lines.push(`![${alt}](${block.url})`);
      if (block.caption) lines.push(`*${block.caption}*`);
    }
  }
  const note =
    section.blocks.length > 0
      ? `Layout "${section.title || "(untitled)"}": multi-column structure flattened to a single column.`
      : undefined;
  return { mdx: ensureBlankLineBetween(lines), note };
}

function migrateOne(section: HomeSection): { mdx: string; note?: string } {
  if (!section.enabled) return { mdx: "" };
  if (section.type === "hero") return migrateHero(section);
  if (section.type === "richText") return migrateRichText(section);
  if (section.type === "linkList") return migrateLinkList(section);
  if (section.type === "featuredPages") return migrateFeatured(section);
  if (section.type === "layout") return migrateLayout(section);
  // Exhaustive fallback in case the union grows. Intentionally no-op.
  return { mdx: "" };
}

/** Convert a HomeData's typed sections into MDX usable in `bodyMdx`.
 * Disabled sections are skipped silently; per-section caveats are
 * returned in `notes`. The result trims trailing whitespace and ends
 * with a single newline, matching the convention serializeMdxBlocks
 * uses elsewhere. */
export function homeSectionsToMdx(data: HomeData): MigrationResult {
  const parts: string[] = [];
  const notes: string[] = [];
  for (const section of data.sections) {
    const { mdx, note } = migrateOne(section);
    if (mdx) parts.push(mdx);
    if (note) notes.push(note);
  }
  const body = ensureBlankLineBetween(parts);
  return {
    mdx: body ? `${body}\n` : "",
    notes,
  };
}
