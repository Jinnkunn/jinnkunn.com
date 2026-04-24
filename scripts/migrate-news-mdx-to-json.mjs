#!/usr/bin/env node
// One-shot: convert content/pages/news.mdx — which uses `### YYYY/MM/DD`
// headings as date markers — into content/news.json's structured
// {dateIso, body} array. Matches what site-admin's News editor writes
// back, so the two are immediately round-trip compatible.

import fs from "node:fs/promises";
import path from "node:path";

const SOURCE = "content/pages/news.mdx";
const DEST = "content/news.json";

function stripFrontmatter(source) {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/m.exec(source);
  return match ? match[2] : source;
}

// Parse `YYYY/MM/DD` → `YYYY-MM-DD`. Returns "" if no match.
function toIsoDate(raw) {
  const m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(String(raw).trim());
  if (!m) return "";
  const yyyy = m[1];
  const mm = String(m[2]).padStart(2, "0");
  const dd = String(m[3]).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Extract frontmatter title/description without pulling in gray-matter.
function readFrontmatterField(source, key) {
  const match = new RegExp(`^${key}\\s*:\\s*"?([^"\\n]+)"?`, "m").exec(source);
  return match ? match[1].trim() : "";
}

function splitIntoEntries(body) {
  // Heading pattern: `### [**]YYYY/MM/DD[**]` with optional bold markdown.
  // Captures the date string (strip bold markers afterward).
  const parts = body.split(/^###\s+/m);
  const entries = [];
  for (const part of parts) {
    const trimmed = part.trimStart();
    if (!trimmed) continue;

    // First line is the heading text; rest is body.
    const newlineIdx = trimmed.indexOf("\n");
    const rawHead = newlineIdx === -1 ? trimmed : trimmed.slice(0, newlineIdx);
    const bodyText = newlineIdx === -1 ? "" : trimmed.slice(newlineIdx + 1);

    // Strip bold markers around the date.
    const cleanedHead = rawHead.replace(/\*\*/g, "").trim();
    const dateIso = toIsoDate(cleanedHead);
    if (!dateIso) continue;

    entries.push({
      dateIso,
      body: bodyText.trim(),
    });
  }
  return entries;
}

async function main() {
  const raw = await fs.readFile(SOURCE, "utf8").catch((err) => {
    console.error(`Cannot read ${SOURCE}: ${err.message}`);
    process.exit(1);
  });

  const body = stripFrontmatter(raw);
  const title = readFrontmatterField(raw, "title") || "News";
  const description = readFrontmatterField(raw, "description") || undefined;

  const entries = splitIntoEntries(body);
  entries.sort((a, b) =>
    a.dateIso < b.dateIso ? 1 : a.dateIso > b.dateIso ? -1 : 0,
  );

  const data = { title, ...(description ? { description } : {}), entries };
  const outPath = path.resolve(DEST);
  await fs.writeFile(outPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`Wrote ${DEST}: ${entries.length} entries.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
