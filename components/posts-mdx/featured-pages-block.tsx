import "server-only";

import type { ReactElement } from "react";

import { ClassicLink } from "@/components/classic/classic-link";

interface FeaturedItem {
  label: string;
  href: string;
  description?: string;
}

interface FeaturedPagesBlockProps {
  title?: string;
  /** Cards per row. Default 2. */
  columns?: 2 | 3;
  /** Cards. As with LinkListBlock the runtime may hand us a JSON
   * string instead of a parsed array depending on the MDX integration;
   * `asArray` covers both. */
  items?: FeaturedItem[];
}

function asArray(items: unknown): FeaturedItem[] {
  if (Array.isArray(items)) return items as FeaturedItem[];
  if (typeof items === "string") {
    try {
      const parsed = JSON.parse(items);
      return Array.isArray(parsed) ? (parsed as FeaturedItem[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href);
}

/** Insertable card grid lifted from the Home builder's featuredPages
 * section. Renders into the same `home-preview-featured` markup as
 * the Home page so existing CSS column variants apply. */
export function FeaturedPagesBlock({
  title,
  columns = 2,
  items,
}: FeaturedPagesBlockProps): ReactElement | null {
  const list = asArray(items).filter((item) => item.label || item.href);
  if (list.length === 0 && !title) return null;
  return (
    <section
      className={[
        "home-section",
        "home-section--featuredpages",
        "home-preview-featured",
        `home-preview-featured--cols-${columns}`,
      ].join(" ")}
    >
      {title ? (
        <h2 className="notion-heading notion-semantic-string">{title}</h2>
      ) : null}
      <div className="home-preview-featured__items">
        {list.map((item, index) => (
          <article
            className="home-preview-featured__item"
            key={`${item.href}-${index}`}
          >
            <ClassicLink
              href={item.href}
              {...(isExternal(item.href)
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
            >
              <strong>{item.label || item.href}</strong>
            </ClassicLink>
            {item.description ? (
              <p className="home-preview-featured__description">
                {item.description}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
