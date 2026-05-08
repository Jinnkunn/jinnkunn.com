import "server-only";

import { Fragment } from "react";
import type { ReactElement } from "react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseNewsFeedItems, type NewsComponentFeedItem } from "@/lib/components/parse";
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
  return parseNewsFeedItems(raw);
}

function capFeedItems(
  items: NewsComponentFeedItem[],
  limit: number | undefined,
): NewsComponentFeedItem[] {
  if (!limit) return items;
  const visible: NewsComponentFeedItem[] = [];
  let entryCount = 0;
  for (const item of items) {
    if (item.type === "entry") {
      if (entryCount >= limit) break;
      visible.push(item);
      entryCount += 1;
      continue;
    }
    if (entryCount > 0 && entryCount < limit) visible.push(item);
  }
  while (visible.at(-1)?.type === "divider") visible.pop();
  return visible;
}

/** Server component for `<NewsBlock />` in MDX. Reads the canonical
 * news data from `content/components/news.mdx` — the dedicated
 * component file edited via the admin Components → News panel. Any
 * page (including `content/pages/news.mdx`) can drop `<NewsBlock />`
 * to render the feed; the rendered output mirrors what the legacy
 * inline-entries layout produced (`news-entry__body` + `notion-heading`
 * markup the existing CSS already styles). */
export async function NewsBlock({ limit }: NewsBlockProps): Promise<ReactElement> {
  const items = await loadEntries();
  const cap = typeof limit === "number" && limit > 0 ? Math.trunc(limit) : undefined;
  const visible = capFeedItems(items, cap);
  const entries = visible.filter(
    (item): item is Extract<NewsComponentFeedItem, { type: "entry" }> =>
      item.type === "entry",
  );

  if (entries.length === 0) {
    return (
      <p className="notion-text notion-text__content notion-semantic-string">
        No news yet.
      </p>
    );
  }

  const rendered = await Promise.all(
    entries.map(async (item) => ({
      ...item.entry,
      Content: (await compilePostMdx(item.entry.body)).Content,
    })),
  );
  let renderedIndex = 0;

  return (
    <div className="news-block">
      {visible.map((item, index) => {
        if (item.type === "divider") {
          return <hr aria-hidden="true" className="news-block__divider" key={item.id} />;
        }
        const entry = rendered[renderedIndex++];
        if (!entry) return null;
        return (
          <Fragment key={`${entry.dateIso}-${index}`}>
            <NewsEntry date={entry.dateIso}>
              <entry.Content components={postMdxComponents} />
            </NewsEntry>
          </Fragment>
        );
      })}
    </div>
  );
}
