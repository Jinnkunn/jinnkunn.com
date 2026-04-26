import "server-only";

import { Fragment } from "react";
import type { ReactElement } from "react";

import newsData from "@/content/news.json";
import { compilePostMdx } from "@/lib/posts/compile";
import { normalizeNewsData } from "@/lib/site-admin/news-normalize";

import { postMdxComponents } from "./components";

function formatDateHeading(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[1]}/${m[2]}/${m[3]}`;
}

interface NewsBlockProps {
  /** Cap rendered entries (most recent first). Omit for all entries. */
  limit?: number;
}

/** Server component rendered from MDX as `<NewsBlock />`. Reads the
 * canonical content/news.json data source so any page can embed a feed
 * without duplicating data. Output mirrors the dedicated /news page so
 * existing CSS (`news-entry__body`, `notion-heading`) keeps working. */
export async function NewsBlock({ limit }: NewsBlockProps): Promise<ReactElement> {
  const data = normalizeNewsData(newsData);
  const cap = typeof limit === "number" && limit > 0 ? Math.trunc(limit) : undefined;
  const entries = cap ? data.entries.slice(0, cap) : data.entries;

  if (entries.length === 0) {
    return (
      <p className="notion-text notion-text__content notion-semantic-string">
        No news yet.
      </p>
    );
  }

  const rendered = await Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      Content: (await compilePostMdx(entry.body)).Content,
    })),
  );

  return (
    <div className="news-block">
      {rendered.map((entry) => (
        <Fragment key={entry.dateIso + entry.body.slice(0, 40)}>
          <span className="notion-heading__anchor" />
          <h3 className="notion-heading notion-semantic-string">
            {formatDateHeading(entry.dateIso)}
          </h3>
          <div className="news-entry__body mdx-post__body">
            <entry.Content components={postMdxComponents} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}
