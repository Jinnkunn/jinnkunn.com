import "server-only";

import type { ReactElement } from "react";

import { ClassicLink } from "@/components/classic/classic-link";

interface LinkItem {
  label: string;
  href: string;
}

interface LinkListBlockProps {
  title?: string;
  /** Default "stack". `inline` lays out as a wrapped row separated by
   * pipes (matches the home-preview-links inline variant). `grid` is a
   * responsive 2-column grid. */
  layout?: "stack" | "grid" | "inline";
  /** Items array. Author-side this comes through MDX as a JSON string;
   * Next/MDX deserializes it into the actual array before passing to
   * the component. */
  items?: LinkItem[];
}

function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href);
}

function asArray(items: unknown): LinkItem[] {
  // Defensive: if MDX hands us a JSON string instead of a parsed array
  // (depending on how the integration evaluates the attribute), parse
  // it here so the public render still works.
  if (Array.isArray(items)) return items as LinkItem[];
  if (typeof items === "string") {
    try {
      const parsed = JSON.parse(items);
      return Array.isArray(parsed) ? (parsed as LinkItem[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Insertable link list lifted from the Home builder's linkList
 * section. Renders into the same `home-preview-links` markup the Home
 * page uses so existing CSS (stack / grid / inline variants) applies
 * wherever the block is dropped. */
export function LinkListBlock({
  title,
  layout = "stack",
  items,
}: LinkListBlockProps): ReactElement | null {
  const list = asArray(items).filter((item) => item.label || item.href);
  if (list.length === 0 && !title) return null;
  return (
    <section
      className={[
        "home-section",
        "home-section--linklist",
        "home-preview-links",
        `home-preview-links--${layout}`,
      ].join(" ")}
    >
      {title ? (
        <h2 className="notion-heading notion-semantic-string">{title}</h2>
      ) : null}
      <ul className="home-preview-links__items">
        {list.map((item, index) => (
          <li key={`${item.href}-${index}`}>
            <ClassicLink
              href={item.href}
              {...(isExternal(item.href)
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
            >
              {item.label || item.href}
            </ClassicLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
