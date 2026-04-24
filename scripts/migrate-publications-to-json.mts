#!/usr/bin/env node
// One-shot migration: parse `content/raw/publications.html` with the
// existing structured extractors and write the result to
// `content/publications.json`. The /publications page becomes a thin
// reader over that JSON file — no more runtime HTML parsing.
//
// This prepares the data layer for a dedicated Tauri admin editor
// (next session): the editor writes the same JSON, the page reads it,
// structured-data (JSON-LD) stays consistent.
//
// Idempotent: overwrites the JSON every run. Safe to re-run after
// edits to publications.html to regenerate.

import fs from "node:fs/promises";
import path from "node:path";
import {
  extractProfileLinks,
} from "../lib/publications/extract.ts";
import {
  extractPublicationStructuredEntries,
} from "../lib/seo/publications-items.ts";

const SOURCE = "content/raw/publications.html";
const DEST = "content/publications.json";

async function main() {
  const html = await fs.readFile(SOURCE, "utf8").catch((err) => {
    console.error(`Cannot read ${SOURCE}: ${err.message}`);
    process.exit(1);
  });

  const profileLinks = extractProfileLinks(html);
  const entries = extractPublicationStructuredEntries(html);

  // Shape: the content component (PublicationsView) already accepts
  // `{title, profileLinks, entries}`. We omit `title` — callers default
  // to "Publications" or derive from the JSON file later.
  const data = {
    title: "Publications",
    profileLinks,
    entries,
  };

  const outPath = path.resolve(DEST);
  await fs.writeFile(outPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(
    `Wrote ${DEST}: ${entries.length} entries, ${profileLinks.length} profile links.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
