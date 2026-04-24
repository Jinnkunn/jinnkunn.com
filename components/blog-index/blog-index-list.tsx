import Link from "next/link";

import type { BlogPostIndexItem } from "@/lib/blog";

function blockId(entry: BlogPostIndexItem): string {
  return `block-list-${entry.slug.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}`;
}

function PageIcon() {
  return (
    <svg
      className="notion-icon notion-icon__page"
      viewBox="0 0 16 16"
      width="18"
      height="18"
      style={{ width: 18, height: 18, fontSize: 18, fill: "var(--color-text-default-light)" }}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4.35645 15.4678H11.6367C13.0996 15.4678 13.8584 14.6953 13.8584 13.2256V7.02539C13.8584 6.0752 13.7354 5.6377 13.1406 5.03613L9.55176 1.38574C8.97754 0.804688 8.50586 0.667969 7.65137 0.667969H4.35645C2.89355 0.667969 2.13477 1.44043 2.13477 2.91016V13.2256C2.13477 14.7021 2.89355 15.4678 4.35645 15.4678ZM4.46582 14.1279C3.80273 14.1279 3.47461 13.7793 3.47461 13.1436V2.99219C3.47461 2.36328 3.80273 2.00781 4.46582 2.00781H7.37793V5.75391C7.37793 6.73145 7.86328 7.20312 8.83398 7.20312H12.5186V13.1436C12.5186 13.7793 12.1836 14.1279 11.5205 14.1279H4.46582ZM8.95703 6.02734C8.67676 6.02734 8.56055 5.9043 8.56055 5.62402V2.19238L12.334 6.02734H8.95703ZM10.4336 9.00098H5.42969C5.16992 9.00098 4.98535 9.19238 4.98535 9.43164C4.98535 9.67773 5.16992 9.86914 5.42969 9.86914H10.4336C10.6797 9.86914 10.8643 9.67773 10.8643 9.43164C10.8643 9.19238 10.6797 9.00098 10.4336 9.00098ZM10.4336 11.2979H5.42969C5.16992 11.2979 4.98535 11.4893 4.98535 11.7354C4.98535 11.9746 5.16992 12.1592 5.42969 12.1592H10.4336C10.6797 12.1592 10.8643 11.9746 10.8643 11.7354C10.8643 11.4893 10.6797 11.2979 10.4336 11.2979Z" />
    </svg>
  );
}

export function BlogIndexList({ entries }: { entries: BlogPostIndexItem[] }) {
  return (
    <div className="notion-collection inline">
      <div className="notion-collection__header-wrapper">
        <h3 className="notion-collection__header">
          <a className="notion-anchor" href="#blog-list" />
          <span className="notion-semantic-string">List</span>
        </h3>
      </div>
      <div id="blog-list" className="notion-collection-list">
        {entries.map((entry) => {
          const id = blockId(entry);
          return (
            <div id={id} key={entry.slug} className="notion-collection-list__item ">
              <Link
                id={id}
                href={entry.href}
                className="notion-link notion-collection-list__item-anchor"
                aria-label={entry.title}
              >
                <span className="sr-only">{entry.title}</span>
              </Link>
              <div className="notion-property notion-property__title notion-semantic-string">
                <div className="notion-property__title__icon-wrapper">
                  <PageIcon />
                </div>
                {entry.title}
              </div>
              <div className="notion-collection-list__item-content">
                {entry.dateText && (
                  <div className="notion-property notion-property__date notion-collection-list__item-property notion-semantic-string no-wrap">
                    <span className="date">{entry.dateText}</span>
                  </div>
                )}
                {entry.description && (
                  <div className="notion-property notion-property__text notion-collection-list__item-property notion-semantic-string">
                    {entry.description}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
