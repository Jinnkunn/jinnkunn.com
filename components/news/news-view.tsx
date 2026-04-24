import "server-only";

import type { ReactElement } from "react";

import { compilePostMdx } from "@/lib/posts/compile";
import { postMdxComponents } from "@/components/posts-mdx/components";
import type { SiteAdminNewsData } from "@/lib/site-admin/api-types";

function formatDateLabel(iso: string): string {
  // Accepts YYYY-MM-DD; returns "Month D, YYYY" in UTC to stay stable
  // across build environments.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month, day));
  if (!Number.isFinite(d.valueOf())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function groupByYear(
  entries: SiteAdminNewsData["entries"],
): { year: string; items: SiteAdminNewsData["entries"] }[] {
  const map = new Map<string, SiteAdminNewsData["entries"]>();
  for (const entry of entries) {
    const year = entry.dateIso.slice(0, 4) || "—";
    const list = map.get(year) ?? [];
    list.push(entry);
    map.set(year, list);
  }
  const sortedYears = Array.from(map.keys()).sort((a, b) =>
    a < b ? 1 : a > b ? -1 : 0,
  );
  return sortedYears.map((year) => ({ year, items: map.get(year)! }));
}

export async function NewsView({
  data,
}: {
  data: SiteAdminNewsData;
}): Promise<ReactElement> {
  const groups = groupByYear(data.entries);
  // Pre-compile each entry's markdown body once — `force-static` means
  // this happens at build time per entry.
  const rendered = await Promise.all(
    groups.map(async (group) => ({
      ...group,
      items: await Promise.all(
        group.items.map(async (entry) => ({
          ...entry,
          Content: (await compilePostMdx(entry.body)).Content,
        })),
      ),
    })),
  );

  return (
    <main
      id="main-content"
      className="super-content page__news parent-page__index"
    >
      <div className="notion-header page">
        <div className="notion-header__cover no-cover no-icon" />
        <div className="notion-header__content max-width no-cover no-icon">
          <div className="notion-header__title-wrapper">
            <h1 className="notion-header__title">{data.title}</h1>
          </div>
        </div>
      </div>
      <article className="notion-root max-width has-footer">
        {data.entries.length === 0 ? (
          <p className="notion-text notion-text__content notion-semantic-string">
            No news yet.
          </p>
        ) : (
          <div className="news-timeline">
            {rendered.map((group) => (
              <section key={group.year} aria-label={`News from ${group.year}`}>
                <h2 className="notion-heading notion-semantic-string">
                  {group.year}
                </h2>
                <ul className="news-timeline__list">
                  {group.items.map((entry) => (
                    <li key={entry.dateIso + entry.body.slice(0, 40)} className="news-timeline__item">
                      <time
                        className="news-timeline__date"
                        dateTime={entry.dateIso}
                      >
                        {formatDateLabel(entry.dateIso)}
                      </time>
                      <div className="news-timeline__body mdx-post__body">
                        <entry.Content components={postMdxComponents} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </article>
    </main>
  );
}
