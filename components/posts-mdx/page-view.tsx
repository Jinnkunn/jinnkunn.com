import "server-only";

import { Fragment } from "react";
import Link from "next/link";

import { ClassicPageShell } from "@/components/classic/classic-page-shell";
import { getPageEntry } from "@/lib/pages/index";
import type { PageEntry } from "@/lib/pages/types";
import { compilePostMdx } from "@/lib/posts/compile";
import { postMdxComponents } from "./components";

interface BreadcrumbItem {
  label: string;
  /** Public URL of this trail item, or null if this segment doesn't
   * correspond to an existing MDX page (intermediate folder). Null
   * items render as plain text instead of a link. */
  href: string | null;
}

/** Build a breadcrumb trail from a page's slug. For
 * `teaching/archive/2024-25-fall/csci3141`, this looks up
 * `/teaching`, `/teaching/archive`, `/teaching/archive/2024-25-fall`
 * each as a page entry, taking each one's title when present and
 * falling back to the raw segment when there's no MDX file at that
 * prefix (folder-only level). The final item is the current page. */
async function buildBreadcrumbTrail(entry: PageEntry): Promise<BreadcrumbItem[]> {
  const segments = entry.slug.split("/").filter(Boolean);
  const trail: BreadcrumbItem[] = [];
  // Resolve each parent (every segment except the last) in parallel —
  // each call is one filesystem read for the parent's MDX file.
  const parentSlugs = segments.slice(0, -1).map((_, i) =>
    segments.slice(0, i + 1).join("/"),
  );
  const parentEntries = await Promise.all(
    parentSlugs.map((slug) => getPageEntry(slug)),
  );
  parentSlugs.forEach((slug, i) => {
    const parent = parentEntries[i];
    trail.push({
      label: parent?.title || segments[i],
      href: parent ? `/${slug}` : null,
    });
  });
  trail.push({ label: entry.title, href: `/${entry.slug}` });
  return trail;
}

export async function PageView({
  entry,
  source,
}: {
  entry: PageEntry;
  source: string;
}) {
  const [{ Content }, trail] = await Promise.all([
    compilePostMdx(source),
    buildBreadcrumbTrail(entry),
  ]);

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
            {trail.map((item, index) => (
              <Fragment key={`${item.href ?? "noref"}-${index}`}>
                <span className="notion-breadcrumb__divider">/</span>
                {item.href ? (
                  <Link
                    href={item.href}
                    className="notion-link notion-breadcrumb__item"
                  >
                    <div className="notion-navbar__title notion-breadcrumb__title">
                      {item.label}
                    </div>
                  </Link>
                ) : (
                  <div className="notion-breadcrumb__item notion-breadcrumb__item--placeholder">
                    <div className="notion-navbar__title notion-breadcrumb__title">
                      {item.label}
                    </div>
                  </div>
                )}
              </Fragment>
            ))}
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
