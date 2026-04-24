import "server-only";

import type { ReactElement } from "react";

import { compilePostMdx } from "@/lib/posts/compile";
import { postMdxComponents } from "@/components/posts-mdx/components";
import type {
  SiteAdminWorksData,
  WorksEntryDTO,
} from "@/lib/site-admin/api-types";

async function renderMarkdown(source: string): Promise<ReactElement | null> {
  if (!source?.trim()) return null;
  const { Content } = await compilePostMdx(source);
  return <Content components={postMdxComponents} />;
}

function WorksEntryCard({
  entry,
  body,
}: {
  entry: WorksEntryDTO;
  body: ReactElement | null;
}) {
  const aff = entry.affiliation;
  const affNode = aff
    ? entry.affiliationUrl
      ? (
          <a
            href={entry.affiliationUrl}
            className="notion-link link"
            {...(/^https?:\/\//.test(entry.affiliationUrl)
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
          >
            <strong>{aff}</strong>
          </a>
        )
      : <strong>{aff}</strong>
    : null;

  return (
    <li className="works-item">
      <div className="works-item__header">
        <strong>{entry.role}</strong>
        {affNode && (
          <>
            {" "}
            {affNode}
          </>
        )}
        {entry.location && (
          <span className="works-item__location"> · {entry.location}</span>
        )}
        {entry.period && (
          <span className="works-item__period"> · {entry.period}</span>
        )}
      </div>
      {body && <div className="works-item__body mdx-post__body">{body}</div>}
    </li>
  );
}

export async function WorksView({
  data,
}: {
  data: SiteAdminWorksData;
}): Promise<ReactElement> {
  const Intro = data.intro ? await renderMarkdown(data.intro) : null;
  const Note = data.note ? await renderMarkdown(data.note) : null;

  const recent = data.entries.filter((e) => e.category === "recent");
  const passed = data.entries.filter((e) => e.category === "passed");

  const recentRendered = await Promise.all(
    recent.map(async (entry) => ({
      entry,
      body: entry.description ? await renderMarkdown(entry.description) : null,
    })),
  );
  const passedRendered = await Promise.all(
    passed.map(async (entry) => ({
      entry,
      body: entry.description ? await renderMarkdown(entry.description) : null,
    })),
  );

  return (
    <main
      id="main-content"
      className="super-content page__works parent-page__index"
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
        {Intro && (
          <blockquote className="notion-quote works-intro">{Intro}</blockquote>
        )}

        {recent.length > 0 && (
          <>
            <h2 className="notion-heading notion-semantic-string">
              Recent Works
            </h2>
            <ul className="works-list">
              {recentRendered.map((r, i) => (
                <WorksEntryCard
                  key={`recent-${r.entry.role}-${i}`}
                  entry={r.entry}
                  body={r.body}
                />
              ))}
            </ul>
          </>
        )}

        {passed.length > 0 && (
          <>
            <h2 className="notion-heading notion-semantic-string">
              Passed Works
            </h2>
            <ul className="works-list">
              {passedRendered.map((r, i) => (
                <WorksEntryCard
                  key={`passed-${r.entry.role}-${i}`}
                  entry={r.entry}
                  body={r.body}
                />
              ))}
            </ul>
          </>
        )}

        {Note && (
          <blockquote className="notion-quote works-note">{Note}</blockquote>
        )}
      </article>
    </main>
  );
}
