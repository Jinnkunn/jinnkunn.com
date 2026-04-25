import "server-only";

import Link from "next/link";

import { ClassicPageShell } from "@/components/classic/classic-page-shell";
import type { PageEntry } from "@/lib/pages/types";
import { compilePostMdx } from "@/lib/posts/compile";
import { postMdxComponents } from "./components";

export async function PageView({
  entry,
  source,
}: {
  entry: PageEntry;
  source: string;
}) {
  const { Content } = await compilePostMdx(source);

  return (
    <ClassicPageShell
      title={entry.title}
      className="super-content page__mdx-page parent-page__mdx-page"
      beforeHeader={
        <div className="super-navbar__breadcrumbs">
          <div className="notion-breadcrumb">
            <Link href="/" className="notion-link notion-breadcrumb__item">
              <div className="notion-navbar__title notion-breadcrumb__title">Home</div>
            </Link>
            <span className="notion-breadcrumb__divider">/</span>
            <Link href={entry.href} className="notion-link notion-breadcrumb__item">
              <div className="notion-navbar__title notion-breadcrumb__title">
                {entry.title}
              </div>
            </Link>
          </div>
        </div>
      }
    >
      {entry.updatedIso && (
        <div className="notion-page__properties">
          <div className="notion-page__property">
            <div className="notion-property notion-property__date notion-semantic-string">
              <span className="date">Updated {entry.updatedIso}</span>
            </div>
          </div>
        </div>
      )}
      <div className="mdx-post__body">
        <Content components={postMdxComponents} />
      </div>
    </ClassicPageShell>
  );
}
