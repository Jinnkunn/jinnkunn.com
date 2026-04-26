import "server-only";

import { Fragment } from "react";
import type { ReactElement } from "react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { compilePostMdx } from "@/lib/posts/compile";

import { postMdxComponents } from "./components";
import { NewsEntry } from "./news-entry";

interface NewsBlockProps {
  /** Cap rendered entries (most recent first). Omit for all entries. */
  limit?: number;
}

interface NewsEntryRecord {
  dateIso: string;
  body: string;
}

const NEWS_SOURCE_PATH = resolve(
  process.cwd(),
  "content/components/news.mdx",
);

// Match `<NewsEntry date="...">…</NewsEntry>` blocks in the news
// component file. Content between the opening tag and `</NewsEntry>`
// is the entry's markdown body — compiled by `compilePostMdx` per
// entry on the public site. Same shape the editor's parser produces
// (apps/workspace/.../mdx-blocks.ts), so nothing diverges as long as
// both stay in sync.
const NEWS_ENTRY_RE =
  /<NewsEntry\s+date="([^"]*)"[^>]*>\s*([\s\S]*?)\s*<\/NewsEntry>/g;

async function loadEntries(): Promise<NewsEntryRecord[]> {
  let raw = "";
  try {
    raw = await readFile(NEWS_SOURCE_PATH, "utf8");
  } catch {
    return [];
  }
  // Strip leading frontmatter so the regex doesn't trip on something
  // weird in the YAML.
  const body = raw.replace(/^---[\s\S]*?---\s*/m, "");
  const out: NewsEntryRecord[] = [];
  let m: RegExpExecArray | null;
  while ((m = NEWS_ENTRY_RE.exec(body)) !== null) {
    const dateIso = m[1] ?? "";
    const entryBody = m[2] ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) continue;
    out.push({ dateIso, body: entryBody });
  }
  // Newest first — same order normalizeNewsData used to apply against
  // the legacy news.json shape.
  out.sort((a, b) => b.dateIso.localeCompare(a.dateIso));
  return out;
}

/** Server component for `<NewsBlock />` in MDX. Reads the canonical
 * news data from `content/components/news.mdx` — the dedicated
 * component file edited via the admin Components → News panel. Any
 * page (including `content/pages/news.mdx`) can drop `<NewsBlock />`
 * to render the feed; the rendered output mirrors what the legacy
 * inline-entries layout produced (`news-entry__body` + `notion-heading`
 * markup the existing CSS already styles). */
export async function NewsBlock({ limit }: NewsBlockProps): Promise<ReactElement> {
  const entries = await loadEntries();
  const cap = typeof limit === "number" && limit > 0 ? Math.trunc(limit) : undefined;
  const visible = cap ? entries.slice(0, cap) : entries;

  if (visible.length === 0) {
    return (
      <p className="notion-text notion-text__content notion-semantic-string">
        No news yet.
      </p>
    );
  }

  const rendered = await Promise.all(
    visible.map(async (entry) => ({
      ...entry,
      Content: (await compilePostMdx(entry.body)).Content,
    })),
  );

  return (
    <div className="news-block">
      {rendered.map((entry) => (
        <Fragment key={entry.dateIso + entry.body.slice(0, 40)}>
          <NewsEntry date={entry.dateIso}>
            <entry.Content components={postMdxComponents} />
          </NewsEntry>
        </Fragment>
      ))}
    </div>
  );
}
