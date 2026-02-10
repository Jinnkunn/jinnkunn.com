function richTextPlain(richText) {
  return (richText || []).map((x) => x?.plain_text ?? "").join("");
}

/**
 * Extract conservative plain-text from hydrated blocks for a lightweight search index.
 * @param {any[]} blocks
 * @param {string[]} out
 * @returns {string[]}
 */
export function extractPlainTextFromBlocks(blocks, out = []) {
  const arr = Array.isArray(blocks) ? blocks : [];

  const push = (s) => {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    if (t) out.push(t);
  };

  for (const b of arr) {
    if (!b || !b.type) continue;
    const t = b.type;
    const data = b[t];

    // Common Notion pattern: most text blocks have `rich_text`.
    if (data && Array.isArray(data.rich_text)) push(richTextPlain(data.rich_text));

    // Headings use `rich_text` too, but keep explicit for clarity.
    if (t === "heading_1") push(richTextPlain(b.heading_1?.rich_text));
    if (t === "heading_2") push(richTextPlain(b.heading_2?.rich_text));
    if (t === "heading_3") push(richTextPlain(b.heading_3?.rich_text));

    // Code blocks.
    if (t === "code") push(richTextPlain(b.code?.rich_text));

    // Callouts include both icon and rich text; icon isn't searchable.
    if (t === "callout") push(richTextPlain(b.callout?.rich_text));

    // Bookmark/caption text can be useful.
    if (t === "bookmark") {
      push(richTextPlain(b.bookmark?.caption));
      push(String(b.bookmark?.url || ""));
    }

    // Table rows have cells; keep as plain text.
    if (t === "table_row") {
      const cells = Array.isArray(b.table_row?.cells) ? b.table_row.cells : [];
      for (const cell of cells) push(richTextPlain(cell));
    }

    // Recurse into hydrated children (toggles, lists, columns, etc.).
    if (Array.isArray(b.__children) && b.__children.length) {
      extractPlainTextFromBlocks(b.__children, out);
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

  const maxLines = 320;
  const maxChars = 8_000;

  let total = 0;
  for (const s0 of arr) {
    const s = String(s0 || "").replace(/\s+/g, " ").trim();
    if (!s) continue;
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

