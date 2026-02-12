function richTextPlain(richText) {
  return (richText || []).map((x) => x?.plain_text ?? "").join("");
}

/** @typedef {import("../../lib/notion/types").NotionBlock} NotionBlock */

/**
 * @typedef {object} ExtractTextOptions
 * @property {boolean} [includeHeadings]
 * @property {boolean} [includeCode]
 * @property {boolean} [includeTableRows]
 */

/**
 * Extract conservative plain-text from hydrated blocks for a lightweight search index.
 * @param {NotionBlock[]} blocks
 * @param {string[]} out
 * @param {ExtractTextOptions} opts
 * @returns {string[]}
 */
export function extractPlainTextFromBlocks(blocks, out = [], opts = {}) {
  const arr = Array.isArray(blocks) ? blocks : [];
  const includeHeadings = opts.includeHeadings !== false;
  const includeCode = opts.includeCode !== false;
  const includeTableRows = opts.includeTableRows !== false;

  const push = (s) => {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    if (t) out.push(t);
  };

  for (const b of arr) {
    if (!b || !b.type) continue;
    const t = b.type;
    const data = b[t];

    const isHeading = t === "heading_1" || t === "heading_2" || t === "heading_3";
    if (!includeHeadings && isHeading) {
      // skip
    } else if (!includeCode && t === "code") {
      // skip
    } else if (!includeTableRows && t === "table_row") {
      // skip
    } else {
      // Common Notion pattern: most text blocks have `rich_text`.
      if (data && Array.isArray(data.rich_text)) push(richTextPlain(data.rich_text));
    }

    // Common Notion pattern: most text blocks have `rich_text`.
    // Note: handled above to respect opts for headings/code/tables.

    // Headings use `rich_text` too, but keep explicit for clarity.
    if (includeHeadings) {
      if (t === "heading_1") push(richTextPlain(b.heading_1?.rich_text));
      if (t === "heading_2") push(richTextPlain(b.heading_2?.rich_text));
      if (t === "heading_3") push(richTextPlain(b.heading_3?.rich_text));
    }

    // Code blocks.
    if (includeCode && t === "code") push(richTextPlain(b.code?.rich_text));

    // Callouts include both icon and rich text; icon isn't searchable.
    if (t === "callout") push(richTextPlain(b.callout?.rich_text));

    // Bookmark/caption text can be useful.
    if (t === "bookmark") {
      push(richTextPlain(b.bookmark?.caption));
      push(String(b.bookmark?.url || ""));
    }

    // Table rows have cells; keep as plain text.
    if (includeTableRows && t === "table_row") {
      const cells = Array.isArray(b.table_row?.cells) ? b.table_row.cells : [];
      for (const cell of cells) push(richTextPlain(cell));
    }

    // Recurse into hydrated children (toggles, lists, columns, etc.).
    if (Array.isArray(b.__children) && b.__children.length) {
      extractPlainTextFromBlocks(b.__children, out, opts);
    }
  }

  return out;
}

/**
 * Extract heading-only text for better matching with less index bloat.
 * @param {NotionBlock[]} blocks
 * @param {string[]} out
 * @returns {string[]}
 */
export function extractHeadingTextFromBlocks(blocks, out = []) {
  const arr = Array.isArray(blocks) ? blocks : [];
  const push = (s) => {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    if (t) out.push(t);
  };

  for (const b of arr) {
    if (!b || !b.type) continue;
    const t = b.type;
    if (t === "heading_1") push(richTextPlain(b.heading_1?.rich_text));
    if (t === "heading_2") push(richTextPlain(b.heading_2?.rich_text));
    if (t === "heading_3") push(richTextPlain(b.heading_3?.rich_text));

    if (Array.isArray(b.__children) && b.__children.length) {
      extractHeadingTextFromBlocks(b.__children, out);
    }
  }

  return out;
}

/**
 * De-dupe and cap extracted search text to keep `search-index.json` compact.
 * @param {string[]} lines
 * @returns {string}
 */
export function buildSearchTextFromLines(lines) {
  const arr = Array.isArray(lines) ? lines : [];
  const out = [];
  const seen = new Set();

  // Keep the index small: we only need enough text to produce decent snippets.
  // Bigger sites can otherwise balloon `search-index.json` and slow cold-start parsing.
  const maxLines = 220;
  const maxChars = 3_200;

  let total = 0;
  for (const s0 of arr) {
    const s = String(s0 || "").replace(/\s+/g, " ").trim();
    if (!s) continue;
    // Skip very short fragments that add noise but little search value.
    if (s.length < 2) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push(s);
    total += s.length + 1;
    if (out.length >= maxLines) break;
    if (total >= maxChars) break;
  }

  let joined = out.join("\n").trim();
  if (joined.length > maxChars) joined = joined.slice(0, maxChars).trim();
  return joined;
}

/**
 * Build compact search-index fields from hydrated blocks.
 * - `headings`: helps matching section titles without needing full body text.
 * - `text`: body-ish text used for snippets (excludes headings, tables, and code by default).
 *
 * @param {NotionBlock[]} blocks
 * @returns {{headings: string[], text: string}}
 */
export function buildSearchIndexFieldsFromBlocks(blocks) {
  const headingsLines = extractHeadingTextFromBlocks(blocks);
  const headings = [];
  const seen = new Set();
  let headingChars = 0;
  const maxHeadingChars = 420;
  const maxHeadings = 18;
  for (const s0 of headingsLines) {
    const s = String(s0 || "").replace(/\s+/g, " ").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    headings.push(s);
    headingChars += s.length + 1;
    if (headings.length >= maxHeadings) break;
    if (headingChars >= maxHeadingChars) break;
  }

  // Body text: focus on readable content; skip heavy/noisy blocks.
  const bodyLines = extractPlainTextFromBlocks(blocks, [], {
    includeHeadings: false,
    includeCode: false,
    includeTableRows: false,
  });

  // Slightly smaller cap than the generic builder since we also ship headings.
  const text = buildSearchTextFromLines(bodyLines).slice(0, 1600).trim();
  return { headings, text };
}
