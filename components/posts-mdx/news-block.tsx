import "server-only";

import { Fragment } from "react";
import type { ReactElement } from "react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseNewsEntries } from "@/lib/components/parse";
import { compilePostMdx } from "@/lib/posts/compile";
import { getSiteComponentDefinition } from "@/lib/site-admin/component-registry";

import { postMdxComponents } from "./components";
import { NewsEntry } from "./news-entry";

interface NewsBlockProps {
  /** Cap rendered entries (most recent first). Omit for all entries. */
  limit?: number;
}

const NEWS_SOURCE_PATH = resolve(
  process.cwd(),
  getSiteComponentDefinition("news").sourcePath,
);

async function loadEntries() {
  let raw = "";
  try {
    raw = await readFile(NEWS_SOURCE_PATH, "utf8");
  } catch {
    return [];
  }
  return parseNewsEntries(raw);
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
