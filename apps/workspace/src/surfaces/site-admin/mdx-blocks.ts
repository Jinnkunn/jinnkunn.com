export type MdxBlockType =
  | "paragraph"
  | "heading"
  | "image"
  | "quote"
  | "list"
  | "divider"
  | "callout"
  | "code"
  | "raw"
  | "todo"
  | "toggle"
  | "table"
  | "bookmark"
  | "embed"
  | "file"
  | "page-link"
  // Data-source blocks: insertable views over the typed JSON files in
  // `content/`. The block stores only the query (limit, layout, …); the
  // entries live in their canonical JSON file and are rendered by a
  // matching server component on the public site.
  | "news-block"
  | "publications-block"
  | "works-block"
  | "teaching-block"
  // Layout / structural blocks lifted from the Home builder so a hero
  // section can be dropped into any page (`<HeroBlock title="…" />`).
  // Inline-config (no external data source); all fields live on the
  // tag itself.
  | "hero-block"
  | "link-list-block"
  | "featured-pages-block"
  // Notion-style multi-column layout. `columns` is the parent (always
  // children-of-`column` only); `column` is the child wrapper whose
  // own `children` carry the actual blocks. Renders as a side-by-side
  // grid in both editor and public site (`<Columns>`/`<Column>` MDX
  // components).
  | "columns"
  | "column"
  // Per-entry blocks for the data pages (news / works / teaching /
  // publications). Each lives as a child block inside the corresponding
  // page MDX (`content/pages/news.mdx`, etc.) and renders via a matching
  // server component on the public site. Replaces the old separate-JSON
  // model where all entries lived in `content/{name}.json`.
  | "news-entry";

/** Single entry in a LinkListBlock / FeaturedPagesBlock items array. */
export interface MdxLinkItem {
  label: string;
  href: string;
  description?: string;
}

export type MdxEmbedKind = "youtube" | "vimeo" | "iframe" | "video";

export interface MdxTableData {
  align?: ("left" | "center" | "right")[];
  headerRow?: boolean;
  rows: string[][];
}

export type MdxBlockColor =
  | "default"
  | "gray"
  | "brown"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "red";

export const MDX_BLOCK_COLORS: MdxBlockColor[] = [
  "default",
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
];

export interface MdxBlock {
  alt?: string;
  blankLinesBefore?: number;
  caption?: string;
  checkedLines?: number[];
  children?: MdxBlock[];
  // Optional background color tag. When set and not "default", the block
  // serializes wrapped in a <Color bg="..."> JSX element so the rendered
  // page can apply a matching background.
  color?: MdxBlockColor;
  description?: string;
  embedKind?: MdxEmbedKind;
  filename?: string;
  id: string;
  image?: string;
  language?: string;
  level?: 1 | 2 | 3;
  // For FeaturedPagesBlock: how many cards to show per row.
  // Also reused by `columns` block for the column count.
  // (FeaturedPages uses 2|3, Columns uses 2|3 — Notion-style)
  columns?: 2 | 3;
  // For `columns` block: gap between columns.
  columnsGap?: "compact" | "standard" | "loose";
  // For `columns` block: vertical alignment of the column tracks within
  // the grid. Maps to `align-items: start | center` on the grid.
  columnsAlign?: "start" | "center";
  // For `columns` block: optional variant key (currently only
  // `classicIntro` exists, applies the home-layout--variant-classicIntro
  // CSS used by the classic-intro hero).
  columnsVariant?: "classicIntro";
  // For HeroBlock: position of the profile image relative to the body.
  imagePosition?: "left" | "right" | "top" | "none";
  // For data-source blocks (news-block, …): cap the number of entries
  // rendered. `undefined` means "show all".
  limit?: number;
  // For `news-entry` blocks: the entry's date in YYYY-MM-DD form. Drives
  // both the rendered heading on the public site and the chronological
  // sort order when the news page is read by the embed component.
  dateIso?: string;
  // For LinkListBlock / FeaturedPagesBlock: how the items array is laid
  // out. linkList accepts stack/grid/inline; featuredPages tweaks columns
  // separately, so this is intentionally narrow.
  linkLayout?: "stack" | "grid" | "inline";
  // For LinkListBlock / FeaturedPagesBlock: the items array, serialized
  // as a JSON string in a single-quoted JSX attribute.
  linkItems?: MdxLinkItem[];
  // For HeroBlock: optional sub-line shown under the title.
  subtitle?: string;
  // For HeroBlock: text alignment within the hero body.
  textAlign?: "left" | "center" | "right";
  listStyle?: "bulleted" | "numbered";
  markers?: string[];
  mimeType?: string;
  open?: boolean;
  pageSlug?: string;
  provider?: string;
  size?: number;
  tableData?: MdxTableData;
  text: string;
  title?: string;
  type: MdxBlockType;
  url?: string;
}

function nextBlockId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `mdx-block-${crypto.randomUUID()}`;
  }
  return `mdx-block-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export function createMdxBlock(type: MdxBlockType): MdxBlock {
  const id = nextBlockId();
  if (type === "heading") {
    return { id, type, level: 2, text: "Heading" };
  }
  if (type === "image") {
    return { id, type, alt: "", caption: "", text: "", url: "" };
  }
  if (type === "code") {
    return { id, type, language: "", text: "" };
  }
  if (type === "list") {
    return { id, type, listStyle: "bulleted", text: "" };
  }
  if (type === "divider") {
    return { id, type, text: "" };
  }
  if (type === "callout") {
    return { id, type, text: "" };
  }
  if (type === "todo") {
    return { id, type, text: "", checkedLines: [] };
  }
  if (type === "toggle") {
    return { id, type, text: "Toggle", open: false, children: [] };
  }
  if (type === "table") {
    return {
      id,
      type,
      text: "",
      tableData: {
        headerRow: true,
        rows: [
          ["", ""],
          ["", ""],
        ],
      },
    };
  }
  if (type === "bookmark") {
    return { id, type, text: "", url: "" };
  }
  if (type === "embed") {
    return { id, type, text: "", url: "", embedKind: "iframe" };
  }
  if (type === "file") {
    return { id, type, text: "", url: "", filename: "" };
  }
  if (type === "page-link") {
    return { id, type, text: "", pageSlug: "" };
  }
  if (
    type === "news-block" ||
    type === "publications-block" ||
    type === "works-block" ||
    type === "teaching-block"
  ) {
    return { id, type, text: "" };
  }
  if (type === "hero-block") {
    return {
      id,
      type,
      text: "",
      title: "",
      imagePosition: "right",
      textAlign: "left",
    };
  }
  if (type === "link-list-block") {
    return {
      id,
      type,
      text: "",
      title: "",
      linkLayout: "stack",
      linkItems: [],
    };
  }
  if (type === "featured-pages-block") {
    return {
      id,
      type,
      text: "",
      title: "",
      columns: 2,
      linkItems: [],
    };
  }
  if (type === "columns") {
    // Default to a 2-column layout with one empty paragraph per column
    // so a freshly inserted Columns block has somewhere to type into.
    return {
      id,
      type,
      text: "",
      columns: 2,
      children: [
        createMdxBlock("column"),
        createMdxBlock("column"),
      ],
    };
  }
  if (type === "column") {
    return {
      id,
      type,
      text: "",
      children: [createMdxBlock("paragraph")],
    };
  }
  if (type === "news-entry") {
    // Default to today's date so a freshly inserted entry has a
    // reasonable starting point. Body is one empty paragraph the user
    // can immediately type into.
    const today = new Date();
    const yyyy = String(today.getFullYear()).padStart(4, "0");
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    return {
      id,
      type,
      text: "",
      dateIso: `${yyyy}-${mm}-${dd}`,
      children: [createMdxBlock("paragraph")],
    };
  }
  return { id, type, text: "" };
}

function makeBlock(type: MdxBlockType, patch: Partial<MdxBlock> = {}): MdxBlock {
  return { ...createMdxBlock(type), ...patch };
}

export function duplicateMdxBlock(block: MdxBlock): MdxBlock {
  const copy: MdxBlock = { ...block, id: nextBlockId() };
  if (block.children) {
    copy.children = block.children.map((child) => duplicateMdxBlock(child));
  }
  if (block.markers) {
    copy.markers = [...block.markers];
  }
  if (block.checkedLines) {
    copy.checkedLines = [...block.checkedLines];
  }
  if (block.tableData) {
    copy.tableData = {
      ...block.tableData,
      align: block.tableData.align ? [...block.tableData.align] : undefined,
      rows: block.tableData.rows.map((row) => [...row]),
    };
  }
  return copy;
}

function isRawMdxParagraph(lines: string[]): boolean {
  return lines.some((line) => {
    const trimmed = line.trim();
    return (
      trimmed.startsWith("|") ||
      trimmed.startsWith("<") ||
      trimmed.startsWith("</") ||
      trimmed.startsWith("import ") ||
      trimmed.startsWith("export ") ||
      /^\{.*\}$/.test(trimmed)
    );
  });
}

export function parseMdxBlocks(source: string): MdxBlock[] {
  return parseBlocksAtDepth(source, 0);
}

const DETAILS_OPEN_RE = /^<details(\s+open)?>$/;
const SUMMARY_RE = /^<summary>([\s\S]*?)<\/summary>$/;
const COLOR_OPEN_RE = /^<Color\s+bg="(\w+)">$/;
// `<Columns count={N} variant="…" gap="…" align="…">` opener (attrs all
// optional). Captures the attribute list verbatim for `parseAttrs`.
const COLUMNS_OPEN_RE = /^<Columns\b([\s\S]*?)>$/;
// `<NewsEntry date="YYYY-MM-DD">` opener — followed (after a blank
// line) by markdown body content that gets recursively parsed at
// depth + 1, then closed by `</NewsEntry>`. The matching counterpart
// to columns / toggle on the entry-block axis.
const NEWS_ENTRY_OPEN_RE = /^<NewsEntry\b([\s\S]*?)>$/;
const COLUMN_OPEN_RE = /^<Column>$/;
const COLUMN_CLOSE_RE = /^<\/Column>$/;
// Allow tabs / spaces around the marker to support indented checklists nested
// inside toggle bodies.
const TODO_LINE_RE = /^(?:\s*)- \[([ xX])\]\s*(.*)$/;
const TABLE_DIVIDER_RE = /^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|\s*$/;
const SELF_CLOSING_TAG_RE = /^<(\w+)([\s\S]*?)\/>$/;
// JSX attribute values: double-quoted string, single-quoted string, or
// `{N}` numeric literal. Single-quoted form lets data-bearing attributes
// (e.g. JSON arrays) embed double-quotes without escaping.
const ATTR_RE = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{(\d+)\})/g;

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of raw.matchAll(ATTR_RE)) {
    const name = match[1];
    out[name] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return out;
}

/** Decode a JSON-attribute value into a typed link items array. Bad
 * JSON or missing label/href silently yields an empty list — the user
 * sees an empty editor card and can rebuild the items, but a corrupt
 * source line never crashes the editor. */
function parseLinkItems(raw: string | undefined): MdxLinkItem[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: MdxLinkItem[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const label = typeof obj.label === "string" ? obj.label : "";
    const href = typeof obj.href === "string" ? obj.href : "";
    if (!label && !href) continue;
    const item: MdxLinkItem = { label, href };
    if (typeof obj.description === "string" && obj.description.trim()) {
      item.description = obj.description;
    }
    out.push(item);
  }
  return out;
}

function parseTableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function parseTableAlign(divider: string): ("left" | "center" | "right")[] {
  return parseTableCells(divider).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, "&quot;");
}

/** Sentinel that flags an attribute value as JSON. The serializer
 * single-quotes it (no escape pass) so the JSON's own double-quotes
 * don't need to become `&quot;`. The parser already accepts
 * single-quoted attribute values, so the round-trip stays exact. */
type JsonAttr = { kind: "json"; value: string };

function jsonAttr(value: unknown): JsonAttr {
  // The serialized JSON sits inside a single-quoted JSX attribute, so a
  // literal `'` in any value (e.g. "Don't") would terminate the attr
  // mid-stream. Encode it as the JSON unicode escape — JSON.parse turns
  // `'` back into a real single quote on the way out.
  return {
    kind: "json",
    value: JSON.stringify(value).replace(/'/g, "\\u0027"),
  };
}

function serializeAttrs(
  entries: Array<[string, string | number | JsonAttr | undefined]>,
): string {
  return entries
    .filter(([, value]) => value !== undefined && value !== "" && value !== null)
    .map(([key, value]) => {
      if (typeof value === "number") return `${key}={${value}}`;
      if (typeof value === "object" && value !== null && (value as JsonAttr).kind === "json") {
        return `${key}='${(value as JsonAttr).value}'`;
      }
      return `${key}="${escapeAttr(String(value))}"`;
    })
    .join(" ");
}

function parseBlocksAtDepth(source: string, depth: number): MdxBlock[] {
  const blocks: MdxBlock[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  let blankLinesBefore = 0;

  const pushBlock = (block: MdxBlock) => {
    blocks.push({
      ...block,
      blankLinesBefore: blocks.length === 0 ? 0 : blankLinesBefore,
    });
    blankLinesBefore = 0;
  };

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      index += 1;
      blankLinesBefore += 1;
      continue;
    }

    if (trimmedLine.startsWith("```")) {
      const language = trimmedLine.replace(/^```/, "").trim();
      const bodyLines: string[] = [];
      index += 1;
      while (index < lines.length && (lines[index] ?? "").trim() !== "```") {
        bodyLines.push(lines[index] ?? "");
        index += 1;
      }
      if ((lines[index] ?? "").trim() === "```") index += 1;
      pushBlock(makeBlock("code", { language, text: bodyLines.join("\n") }));
      continue;
    }

    // <Color bg="..."> wraps a single inner block (paragraph / heading /
    // list / etc). Recognized at every depth. The wrapper is stripped and
    // the color is attached to the inner block.
    const colorMatch = COLOR_OPEN_RE.exec(trimmedLine);
    if (colorMatch) {
      const color = colorMatch[1] as MdxBlockColor;
      const innerLines: string[] = [];
      index += 1;
      let foundClose = false;
      while (index < lines.length) {
        const probe = (lines[index] ?? "").trim();
        if (probe === "</Color>") {
          foundClose = true;
          index += 1;
          break;
        }
        innerLines.push(lines[index] ?? "");
        index += 1;
      }
      if (foundClose) {
        const innerSource = innerLines.join("\n").replace(/^\n+|\n+$/g, "");
        const innerBlocks = parseBlocksAtDepth(innerSource, depth);
        if (innerBlocks.length > 0) {
          // Attach the color to the first parsed inner block; subsequent
          // inner blocks (rare; <Color> is meant to wrap one block at a
          // time) are pushed unwrapped.
          pushBlock({ ...innerBlocks[0], color });
          for (let i = 1; i < innerBlocks.length; i += 1) pushBlock(innerBlocks[i]);
          continue;
        }
      }
      // Fall through to raw if unclosed or empty.
      pushBlock(makeBlock("raw", { text: [trimmedLine, ...innerLines].join("\n") }));
      continue;
    }

    // Toggle: <details>...</details>. Only recognized at the top level
    // (depth === 0). Nested <details> falls through to the raw paragraph
    // handler so the data model never exceeds depth 1.
    const detailsMatch = depth === 0 ? DETAILS_OPEN_RE.exec(trimmedLine) : null;
    if (detailsMatch) {
      const isOpen = Boolean(detailsMatch[1]);
      const innerLines: string[] = [];
      index += 1;
      let foundClose = false;
      while (index < lines.length) {
        const probe = (lines[index] ?? "").trim();
        if (probe === "</details>") {
          foundClose = true;
          index += 1;
          break;
        }
        innerLines.push(lines[index] ?? "");
        index += 1;
      }
      if (!foundClose) {
        // Unclosed <details>: treat the consumed lines as raw to avoid
        // silently swallowing arbitrary markdown.
        pushBlock(
          makeBlock("raw", {
            text: [trimmedLine, ...innerLines].join("\n"),
          }),
        );
        continue;
      }
      // Strip a leading <summary>…</summary> line, then drop the blank
      // separator line MDX needs after the JSX summary tag.
      let summaryText = "";
      let bodyStart = 0;
      while (bodyStart < innerLines.length && !innerLines[bodyStart]?.trim()) {
        bodyStart += 1;
      }
      const firstInner = innerLines[bodyStart]?.trim() ?? "";
      const summaryMatch = SUMMARY_RE.exec(firstInner);
      if (summaryMatch) {
        summaryText = summaryMatch[1];
        bodyStart += 1;
        while (bodyStart < innerLines.length && !innerLines[bodyStart]?.trim()) {
          bodyStart += 1;
        }
      }
      const bodySource = innerLines.slice(bodyStart).join("\n").replace(/\n+$/, "");
      const children = bodySource ? parseBlocksAtDepth(bodySource, depth + 1) : [];
      pushBlock(
        makeBlock("toggle", {
          children,
          open: isOpen,
          text: summaryText,
        }),
      );
      continue;
    }

    // Multi-column layout: `<Columns count={N} variant="…" gap="…"
    // align="…">` … `<Column>` … `</Column>` … `</Columns>`. Top-level
    // only (depth === 0); nested Columns falls through to raw. Each
    // <Column>'s body is recursively parsed at depth + 2 so its blocks
    // can use the same primitives as the root canvas.
    const columnsMatch = depth === 0 ? COLUMNS_OPEN_RE.exec(trimmedLine) : null;
    if (columnsMatch) {
      const attrs = parseAttrs(columnsMatch[1] ?? "");
      const innerLines: string[] = [];
      index += 1;
      let foundClose = false;
      while (index < lines.length) {
        const probe = (lines[index] ?? "").trim();
        if (probe === "</Columns>") {
          foundClose = true;
          index += 1;
          break;
        }
        innerLines.push(lines[index] ?? "");
        index += 1;
      }
      if (!foundClose) {
        // Unclosed <Columns>: treat as raw to keep round-tripping safe.
        pushBlock(
          makeBlock("raw", {
            text: [trimmedLine, ...innerLines].join("\n"),
          }),
        );
        continue;
      }
      // Walk inner lines and split into per-Column block ranges. Lines
      // outside any <Column> open/close pair are silently dropped (we
      // emit them tightly on serialize so this only happens for
      // hand-edited MDX).
      const columnBodies: string[][] = [];
      let currentColumn: string[] | null = null;
      for (const innerLine of innerLines) {
        const innerTrim = innerLine.trim();
        if (COLUMN_OPEN_RE.test(innerTrim)) {
          currentColumn = [];
          columnBodies.push(currentColumn);
          continue;
        }
        if (COLUMN_CLOSE_RE.test(innerTrim)) {
          currentColumn = null;
          continue;
        }
        if (currentColumn) currentColumn.push(innerLine);
      }
      const columnChildren = columnBodies.map((bodyLines) => {
        const bodySource = bodyLines.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
        const innerBlocks = bodySource
          ? parseBlocksAtDepth(bodySource, depth + 2)
          : [createMdxBlock("paragraph")];
        return makeBlock("column", { children: innerBlocks });
      });
      // Default to 2 columns if the source omitted `count` or had no
      // nested <Column> tags. Clamp to 2|3 (the Columns component's
      // declared range); a stray `count={1}` falls back to 2.
      const declaredCount = Number(attrs.count);
      const fromAttr = Number.isFinite(declaredCount) ? Math.trunc(declaredCount) : 0;
      const fromBodies = columnChildren.length;
      const candidate = fromAttr > 0 ? fromAttr : fromBodies || 2;
      const finalCount: 2 | 3 = candidate >= 3 ? 3 : 2;
      // Pad / truncate so the children array length matches `count`.
      while (columnChildren.length < finalCount) {
        columnChildren.push(makeBlock("column"));
      }
      const gap = attrs.gap;
      const align = attrs.align;
      const variant = attrs.variant;
      pushBlock(
        makeBlock("columns", {
          columns: finalCount,
          children: columnChildren.slice(0, finalCount),
          columnsGap:
            gap === "compact" || gap === "standard" || gap === "loose"
              ? (gap as "compact" | "standard" | "loose")
              : undefined,
          columnsAlign:
            align === "start" || align === "center"
              ? (align as "start" | "center")
              : undefined,
          columnsVariant: variant === "classicIntro" ? "classicIntro" : undefined,
        }),
      );
      continue;
    }

    // News entry: `<NewsEntry date="YYYY-MM-DD">` … `</NewsEntry>` with
    // markdown body inside. Top-level only (depth === 0); a nested
    // <NewsEntry> falls through to raw to keep the data model flat. Body
    // is recursively parsed at depth + 1.
    const newsEntryMatch = depth === 0 ? NEWS_ENTRY_OPEN_RE.exec(trimmedLine) : null;
    if (newsEntryMatch) {
      const attrs = parseAttrs(newsEntryMatch[1] ?? "");
      const innerLines: string[] = [];
      index += 1;
      let foundClose = false;
      while (index < lines.length) {
        const probe = (lines[index] ?? "").trim();
        if (probe === "</NewsEntry>") {
          foundClose = true;
          index += 1;
          break;
        }
        innerLines.push(lines[index] ?? "");
        index += 1;
      }
      if (!foundClose) {
        // Unclosed <NewsEntry>: emit as raw so the user doesn't
        // silently lose content.
        pushBlock(
          makeBlock("raw", { text: [trimmedLine, ...innerLines].join("\n") }),
        );
        continue;
      }
      const bodySource = innerLines.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
      const children = bodySource ? parseBlocksAtDepth(bodySource, depth + 1) : [];
      const date = typeof attrs.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(attrs.date)
        ? attrs.date
        : "";
      pushBlock(
        makeBlock("news-entry", {
          dateIso: date,
          children,
        }),
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && (lines[index] ?? "").trim()) {
      paragraphLines.push(lines[index] ?? "");
      index += 1;
    }
    const paragraph = paragraphLines.join("\n").trim();

    if (/^---+$/.test(paragraph)) {
      pushBlock(makeBlock("divider"));
      continue;
    }

    const imageMatch = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(paragraph);
    if (imageMatch) {
      pushBlock(
        makeBlock("image", {
          alt: imageMatch[1],
          text: "",
          url: imageMatch[2],
        }),
      );
      continue;
    }

    const htmlImageMatch =
      /^<figure>\s*<img src="([^"]+)" alt="([^"]*)" \/>\s*<figcaption>([\s\S]*?)<\/figcaption>\s*<\/figure>$/.exec(
        paragraph,
      );
    if (htmlImageMatch) {
      pushBlock(
        makeBlock("image", {
          alt: htmlImageMatch[2],
          caption: htmlImageMatch[3],
          text: "",
          url: htmlImageMatch[1],
        }),
      );
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(paragraph);
    if (headingMatch) {
      pushBlock(
        makeBlock("heading", {
          level: headingMatch[1].length as 1 | 2 | 3,
          text: headingMatch[2],
        }),
      );
      continue;
    }

    // Todo MUST be checked before the generic list parser, since "- [ ] foo"
    // also matches the bullet pattern.
    const todoMatches = paragraphLines.map((item) => TODO_LINE_RE.exec(item));
    if (todoMatches.every(Boolean)) {
      const items = todoMatches.map((match) => ({
        checked: (match?.[1] ?? "").toLowerCase() === "x",
        text: match?.[2] ?? "",
      }));
      const checkedLines = items
        .map((item, idx) => (item.checked ? idx : -1))
        .filter((idx) => idx >= 0);
      pushBlock(
        makeBlock("todo", {
          checkedLines,
          text: items.map((item) => item.text).join("\n"),
        }),
      );
      continue;
    }

    const listMatches = paragraphLines.map((item) =>
      /^(\s*(?:[-*]|\d+\.)(?:\s+))(.+)$/.exec(item),
    );
    if (listMatches.every(Boolean)) {
      const firstMarker = listMatches[0]?.[1].trim() ?? "-";
      const numbered = /^\d+\.$/.test(firstMarker);
      const compatible = listMatches.every((match) =>
        numbered
          ? /^\d+\.$/.test(match?.[1].trim() ?? "")
          : /^[-*]$/.test(match?.[1].trim() ?? ""),
      );
      if (compatible) {
        pushBlock(
          makeBlock("list", {
            listStyle: numbered ? "numbered" : "bulleted",
            markers: listMatches.map((match) => match?.[1] ?? "- "),
            text: listMatches.map((match) => match?.[2] ?? "").join("\n"),
          }),
        );
        continue;
      }
    }

    if (paragraphLines.every((item) => /^>\s?/.test(item))) {
      const quoteLines = paragraphLines.map((item) => item.replace(/^>\s?/, ""));
      if (/^\[!NOTE\]\s*$/i.test(quoteLines[0] ?? "")) {
        pushBlock(
          makeBlock("callout", {
            text: quoteLines.slice(1).join("\n"),
          }),
        );
        continue;
      }
      pushBlock(
        makeBlock("quote", {
          text: quoteLines.join("\n"),
        }),
      );
      continue;
    }

    // GFM table: every line starts with `|` and the second line is a
    // dashes-and-pipes divider. Must precede the raw-paragraph fallback.
    if (
      paragraphLines.length >= 2 &&
      paragraphLines.every((line) => line.trim().startsWith("|")) &&
      TABLE_DIVIDER_RE.test(paragraphLines[1] ?? "")
    ) {
      const headerCells = parseTableCells(paragraphLines[0] ?? "");
      const align = parseTableAlign(paragraphLines[1] ?? "");
      const bodyRows = paragraphLines.slice(2).map((line) => {
        const cells = parseTableCells(line);
        // Pad / trim to header column count for a rectangular table model.
        while (cells.length < headerCells.length) cells.push("");
        return cells.slice(0, headerCells.length);
      });
      pushBlock(
        makeBlock("table", {
          tableData: {
            align: align.slice(0, headerCells.length),
            headerRow: true,
            rows: [headerCells, ...bodyRows],
          },
        }),
      );
      continue;
    }

    // Self-closing JSX components (Bookmark, Video, Embed, FileLink,
    // PageLink). Single-line tags only. Multi-line / non-self-closing JSX
    // falls through to the raw paragraph handler.
    const jsxMatch = paragraphLines.length === 1 ? SELF_CLOSING_TAG_RE.exec(paragraph) : null;
    if (jsxMatch) {
      const tagName = jsxMatch[1];
      const attrs = parseAttrs(jsxMatch[2] ?? "");
      if (tagName === "Bookmark") {
        pushBlock(
          makeBlock("bookmark", {
            description: attrs.description,
            image: attrs.image,
            provider: attrs.provider,
            text: "",
            title: attrs.title,
            url: attrs.url,
          }),
        );
        continue;
      }
      if (tagName === "Video") {
        const kind =
          attrs.kind === "youtube" || attrs.kind === "vimeo" || attrs.kind === "video"
            ? (attrs.kind as MdxEmbedKind)
            : "iframe";
        pushBlock(
          makeBlock("embed", {
            embedKind: kind,
            text: "",
            url: attrs.url,
          }),
        );
        continue;
      }
      if (tagName === "Embed") {
        pushBlock(
          makeBlock("embed", {
            embedKind: "iframe",
            text: "",
            title: attrs.title,
            url: attrs.src,
          }),
        );
        continue;
      }
      if (tagName === "FileLink") {
        const sizeNum = attrs.size ? Number(attrs.size) : undefined;
        pushBlock(
          makeBlock("file", {
            filename: attrs.filename,
            size: Number.isFinite(sizeNum) ? sizeNum : undefined,
            text: "",
            url: attrs.href,
          }),
        );
        continue;
      }
      if (tagName === "PageLink") {
        pushBlock(
          makeBlock("page-link", {
            pageSlug: attrs.slug,
            text: "",
          }),
        );
        continue;
      }
      if (tagName === "NewsBlock") {
        const limitNum = attrs.limit ? Number(attrs.limit) : undefined;
        pushBlock(
          makeBlock("news-block", {
            limit: Number.isFinite(limitNum) && limitNum! > 0 ? limitNum : undefined,
            text: "",
          }),
        );
        continue;
      }
      if (tagName === "PublicationsBlock") {
        const limitNum = attrs.limit ? Number(attrs.limit) : undefined;
        pushBlock(
          makeBlock("publications-block", {
            limit: Number.isFinite(limitNum) && limitNum! > 0 ? limitNum : undefined,
            text: "",
          }),
        );
        continue;
      }
      if (tagName === "WorksBlock") {
        const limitNum = attrs.limit ? Number(attrs.limit) : undefined;
        pushBlock(
          makeBlock("works-block", {
            limit: Number.isFinite(limitNum) && limitNum! > 0 ? limitNum : undefined,
            text: "",
          }),
        );
        continue;
      }
      if (tagName === "TeachingBlock") {
        const limitNum = attrs.limit ? Number(attrs.limit) : undefined;
        pushBlock(
          makeBlock("teaching-block", {
            limit: Number.isFinite(limitNum) && limitNum! > 0 ? limitNum : undefined,
            text: "",
          }),
        );
        continue;
      }
      if (tagName === "HeroBlock") {
        const imagePos = (attrs.imagePosition || "").toLowerCase();
        const align = (attrs.textAlign || "").toLowerCase();
        pushBlock(
          makeBlock("hero-block", {
            text: "",
            title: attrs.title,
            subtitle: attrs.subtitle,
            url: attrs.imageUrl,
            alt: attrs.imageAlt,
            imagePosition:
              imagePos === "left" || imagePos === "right" || imagePos === "top" || imagePos === "none"
                ? (imagePos as "left" | "right" | "top" | "none")
                : "right",
            textAlign:
              align === "left" || align === "center" || align === "right"
                ? (align as "left" | "center" | "right")
                : "left",
          }),
        );
        continue;
      }
      if (tagName === "LinkListBlock") {
        const layout = (attrs.layout || "").toLowerCase();
        pushBlock(
          makeBlock("link-list-block", {
            text: "",
            title: attrs.title,
            linkLayout:
              layout === "stack" || layout === "grid" || layout === "inline"
                ? (layout as "stack" | "grid" | "inline")
                : "stack",
            linkItems: parseLinkItems(attrs.items),
          }),
        );
        continue;
      }
      if (tagName === "FeaturedPagesBlock") {
        const cols = Number(attrs.columns);
        pushBlock(
          makeBlock("featured-pages-block", {
            text: "",
            title: attrs.title,
            columns: cols === 3 ? 3 : 2,
            linkItems: parseLinkItems(attrs.items),
          }),
        );
        continue;
      }
    }

    if (isRawMdxParagraph(paragraphLines)) {
      pushBlock(makeBlock("raw", { text: paragraph }));
      continue;
    }

    pushBlock(makeBlock("paragraph", { text: paragraph }));
  }

  if (blocks.length > 0) return blocks;
  // The root canvas needs at least one editable block; nested levels can be
  // empty (an empty toggle body, etc).
  return depth === 0 ? [createMdxBlock("paragraph")] : [];
}

function serializeBlock(block: MdxBlock, depth: number): string {
  const text = block.text.trim();
  if (block.type === "heading") {
    if (!text) return "";
    return `${"#".repeat(block.level ?? 2)} ${text}`;
  }
  if (block.type === "image") {
    const url = (block.url ?? "").trim();
    if (!url) return "";
    const alt = (block.alt ?? "").trim();
    const caption = (block.caption ?? "").trim();
    if (caption) {
      return `<figure><img src="${url}" alt="${alt}" /><figcaption>${caption}</figcaption></figure>`;
    }
    return `![${alt}](${url})`;
  }
  if (block.type === "quote") {
    if (!text) return "";
    return text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  }
  if (block.type === "callout") {
    if (!text) return "> [!NOTE]";
    return ["> [!NOTE]", ...text.split("\n").map((line) => `> ${line}`)].join("\n");
  }
  if (block.type === "list") {
    if (!text) return "";
    return text
      .split("\n")
      .map((line, index) => {
        const marker =
          block.markers?.[index] ??
          (block.listStyle === "numbered" ? `${index + 1}. ` : "- ");
        return `${marker}${line}`;
      })
      .join("\n");
  }
  if (block.type === "divider") {
    return "---";
  }
  if (block.type === "code") {
    if (!block.text.trim()) return "";
    return `\`\`\`${(block.language ?? "").trim()}\n${block.text.replace(/\n+$/, "")}\n\`\`\``;
  }
  if (block.type === "raw") {
    return block.text.trim();
  }
  if (block.type === "todo") {
    const lines = block.text.split("\n");
    const checked = new Set(block.checkedLines ?? []);
    return lines
      .map((line, idx) => `- [${checked.has(idx) ? "x" : " "}] ${line}`)
      .join("\n");
  }
  if (block.type === "toggle") {
    const summary = block.text.trim() || "Toggle";
    const inner = block.children?.length
      ? serializeBlocksWithDepth(block.children, depth + 1).replace(/\n+$/, "")
      : "";
    const opener = `<details${block.open ? " open" : ""}>`;
    if (!inner) {
      return `${opener}\n<summary>${summary}</summary>\n</details>`;
    }
    return [opener, `<summary>${summary}</summary>`, "", inner, "", "</details>"].join(
      "\n",
    );
  }
  if (block.type === "columns") {
    const declared = block.columns ?? (block.children?.length ?? 2);
    const count: 2 | 3 = declared >= 3 ? 3 : 2;
    const variant = block.columnsVariant;
    const gap = block.columnsGap;
    const align = block.columnsAlign;
    const attrs = serializeAttrs([
      ["count", count],
      ["variant", variant],
      ["gap", gap && gap !== "standard" ? gap : undefined],
      ["align", align && align !== "start" ? align : undefined],
    ]);
    const opener = attrs ? `<Columns ${attrs}>` : `<Columns>`;
    const childColumns = (block.children ?? []).slice(0, count);
    const columnLines: string[] = [];
    for (const col of childColumns) {
      const inner = col.children?.length
        ? serializeBlocksWithDepth(col.children, depth + 2).replace(/\n+$/, "")
        : "";
      columnLines.push("<Column>");
      if (inner) {
        columnLines.push("");
        columnLines.push(inner);
        columnLines.push("");
      }
      columnLines.push("</Column>");
    }
    return [opener, ...columnLines, "</Columns>"].join("\n");
  }
  if (block.type === "column") {
    // Bare `<Column>` blocks should never round-trip outside a `columns`
    // parent — but if they leak (defensive), emit a minimal wrapper so
    // the public site still parses cleanly.
    const inner = block.children?.length
      ? serializeBlocksWithDepth(block.children, depth + 1).replace(/\n+$/, "")
      : "";
    return inner
      ? ["<Column>", "", inner, "", "</Column>"].join("\n")
      : "<Column>\n</Column>";
  }
  if (block.type === "news-entry") {
    // News entries always carry a date; if the user hasn't set one,
    // emit an empty `date=""` rather than dropping the attr — round-trip
    // remains explicit and the editor card highlights the missing date.
    const date = block.dateIso ?? "";
    const opener = `<NewsEntry date="${escapeAttr(date)}">`;
    const inner = block.children?.length
      ? serializeBlocksWithDepth(block.children, depth + 1).replace(/\n+$/, "")
      : "";
    if (!inner) {
      return [opener, "</NewsEntry>"].join("\n");
    }
    return [opener, "", inner, "", "</NewsEntry>"].join("\n");
  }
  if (block.type === "table") {
    const data = block.tableData;
    if (!data || !data.rows.length) return "";
    const colCount = data.rows[0].length;
    const align = (data.align ?? []).slice(0, colCount);
    const dividerCells: string[] = [];
    for (let i = 0; i < colCount; i += 1) {
      const a = align[i] ?? "left";
      if (a === "center") dividerCells.push(":---:");
      else if (a === "right") dividerCells.push("---:");
      else dividerCells.push("---");
    }
    const lines: string[] = [];
    data.rows.forEach((row, idx) => {
      const cells = row.slice(0, colCount);
      while (cells.length < colCount) cells.push("");
      lines.push(`| ${cells.join(" | ")} |`);
      if (idx === 0) {
        lines.push(`| ${dividerCells.join(" | ")} |`);
      }
    });
    return lines.join("\n");
  }
  if (block.type === "bookmark") {
    const url = (block.url ?? "").trim();
    if (!url) return "";
    const attrs = serializeAttrs([
      ["url", url],
      ["title", block.title],
      ["description", block.description],
      ["image", block.image],
      ["provider", block.provider],
    ]);
    return `<Bookmark ${attrs} />`;
  }
  if (block.type === "embed") {
    const url = (block.url ?? "").trim();
    if (!url) return "";
    const kind = block.embedKind ?? "iframe";
    if (kind === "iframe") {
      const attrs = serializeAttrs([
        ["src", url],
        ["title", block.title || "Embedded content"],
      ]);
      return `<Embed ${attrs} />`;
    }
    const attrs = serializeAttrs([
      ["kind", kind],
      ["url", url],
    ]);
    return `<Video ${attrs} />`;
  }
  if (block.type === "file") {
    const url = (block.url ?? "").trim();
    if (!url) return "";
    const attrs = serializeAttrs([
      ["href", url],
      ["filename", block.filename],
      ["size", block.size],
    ]);
    return `<FileLink ${attrs} />`;
  }
  if (block.type === "page-link") {
    const slug = (block.pageSlug ?? "").trim();
    if (!slug) return "";
    return `<PageLink ${serializeAttrs([["slug", slug]])} />`;
  }
  if (block.type === "news-block") {
    const attrs = serializeAttrs([["limit", block.limit]]);
    return attrs ? `<NewsBlock ${attrs} />` : "<NewsBlock />";
  }
  if (block.type === "publications-block") {
    const attrs = serializeAttrs([["limit", block.limit]]);
    return attrs ? `<PublicationsBlock ${attrs} />` : "<PublicationsBlock />";
  }
  if (block.type === "works-block") {
    const attrs = serializeAttrs([["limit", block.limit]]);
    return attrs ? `<WorksBlock ${attrs} />` : "<WorksBlock />";
  }
  if (block.type === "teaching-block") {
    const attrs = serializeAttrs([["limit", block.limit]]);
    return attrs ? `<TeachingBlock ${attrs} />` : "<TeachingBlock />";
  }
  if (block.type === "hero-block") {
    // Skip default values to keep the serialized form short and stable.
    const imagePosition =
      block.imagePosition && block.imagePosition !== "right"
        ? block.imagePosition
        : undefined;
    const textAlign =
      block.textAlign && block.textAlign !== "left" ? block.textAlign : undefined;
    const attrs = serializeAttrs([
      ["title", block.title],
      ["subtitle", block.subtitle],
      ["imageUrl", block.url],
      ["imageAlt", block.alt],
      ["imagePosition", imagePosition],
      ["textAlign", textAlign],
    ]);
    return attrs ? `<HeroBlock ${attrs} />` : "<HeroBlock />";
  }
  if (block.type === "link-list-block") {
    const layout =
      block.linkLayout && block.linkLayout !== "stack" ? block.linkLayout : undefined;
    const items = block.linkItems && block.linkItems.length > 0 ? block.linkItems : undefined;
    const attrs = serializeAttrs([
      ["title", block.title],
      ["layout", layout],
      // Items go in via single-quoted JSON so the inner double-quotes
      // need no escaping. parseLinkItems is the inverse.
      ["items", items ? jsonAttr(items) : undefined],
    ]);
    return attrs ? `<LinkListBlock ${attrs} />` : "<LinkListBlock />";
  }
  if (block.type === "featured-pages-block") {
    // Skip default columns=2.
    const columns = block.columns && block.columns !== 2 ? block.columns : undefined;
    const items = block.linkItems && block.linkItems.length > 0 ? block.linkItems : undefined;
    const attrs = serializeAttrs([
      ["title", block.title],
      ["columns", columns],
      ["items", items ? jsonAttr(items) : undefined],
    ]);
    return attrs ? `<FeaturedPagesBlock ${attrs} />` : "<FeaturedPagesBlock />";
  }
  return text;
}

function wrapColor(serialized: string, color: MdxBlockColor | undefined): string {
  if (!color || color === "default") return serialized;
  if (!serialized) return serialized;
  return `<Color bg="${color}">\n\n${serialized}\n\n</Color>`;
}

function serializeBlocksWithDepth(blocks: MdxBlock[], depth: number): string {
  const parts: string[] = [];
  for (const block of blocks) {
    const serialized = wrapColor(serializeBlock(block, depth), block.color);
    if (!serialized) continue;
    if (parts.length > 0) {
      parts.push("\n".repeat((block.blankLinesBefore ?? 1) + 1));
    }
    parts.push(serialized);
  }
  const source = parts.join("");
  if (!source) return "";
  return depth === 0 ? `${source}\n` : source;
}

export function serializeMdxBlocks(blocks: MdxBlock[]): string {
  return serializeBlocksWithDepth(blocks, 0);
}
