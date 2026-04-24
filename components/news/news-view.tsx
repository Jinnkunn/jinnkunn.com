import "server-only";

import { Fragment } from "react";
import type { ReactElement } from "react";

import { ClassicPageShell } from "@/components/classic/classic-page-shell";
import { compilePostMdx } from "@/lib/posts/compile";
import { postMdxComponents } from "@/components/posts-mdx/components";
import type { SiteAdminNewsData } from "@/lib/site-admin/api-types";

function formatDateHeading(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[1]}/${m[2]}/${m[3]}`;
}

export async function NewsView({
  data,
}: {
  data: SiteAdminNewsData;
}): Promise<ReactElement> {
  const rendered = await Promise.all(
    data.entries.map(async (entry) => ({
      ...entry,
      Content: (await compilePostMdx(entry.body)).Content,
    })),
  );

  return (
    <ClassicPageShell
      title={data.title}
      className="super-content page__news parent-page__index"
      breadcrumbs={[
        { href: "/", label: "Home" },
        { href: "/news", label: data.title },
      ]}
    >
      {data.entries.length === 0 ? (
        <p className="notion-text notion-text__content notion-semantic-string">
          No news yet.
        </p>
      ) : (
        rendered.map((entry) => (
          <Fragment key={entry.dateIso + entry.body.slice(0, 40)}>
            <span className="notion-heading__anchor" />
            <h3 className="notion-heading notion-semantic-string">
              {formatDateHeading(entry.dateIso)}
            </h3>
            <div className="news-entry__body mdx-post__body">
              <entry.Content components={postMdxComponents} />
            </div>
          </Fragment>
        ))
      )}
    </ClassicPageShell>
  );
}
