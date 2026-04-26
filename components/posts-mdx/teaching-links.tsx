import "server-only";

import { Fragment } from "react";
import type { ReactElement } from "react";

import { ClassicLink } from "@/components/classic/classic-link";

interface TeachingLink {
  label: string;
  href: string;
}

interface TeachingLinksProps {
  /** `header` (rendered above the entries list — bold labels with
   * `|` dividers) vs. `footer` (below the entries — plain links with
   * ` · ` dividers). Mirrors the legacy LinkLine / FooterLinks
   * branches inside TeachingBlock. */
  variant?: "header" | "footer";
  /** Stringified JSON array of `{label, href}` items. Stringified
   * because MDX JSX can't carry runtime objects without a compile
   * step; the same single-quoted-JSON-attr pattern LinkListBlock /
   * FeaturedPagesBlock use. */
  links?: string;
}

function parseLinks(raw: string | undefined): TeachingLink[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: TeachingLink[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const obj = entry as Record<string, unknown>;
      const label = typeof obj.label === "string" ? obj.label : "";
      const href = typeof obj.href === "string" ? obj.href : "";
      if (!label || !href) continue;
      out.push({ label, href });
    }
    return out;
  } catch {
    return [];
  }
}

/** Pipe / dot-delimited link row used by the teaching page above
 * (header) and below (footer) the entries list. Renders identical
 * markup to the legacy LinkLine / FooterLinks subtrees inside the old
 * TeachingBlock so the existing CSS keeps working. */
export function TeachingLinks({
  variant = "header",
  links,
}: TeachingLinksProps): ReactElement | null {
  const items = parseLinks(links);
  if (items.length === 0) return null;
  if (variant === "footer") {
    return (
      <p className="notion-text notion-text__content notion-semantic-string teaching-footer-links">
        {items.map((link, index) => {
          const isExternal = /^https?:\/\//.test(link.href);
          return (
            <Fragment key={`${link.href}-${index}`}>
              {index > 0 && <span className="teaching-link-divider"> · </span>}
              <ClassicLink
                href={link.href}
                {...(isExternal
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                {link.label}
              </ClassicLink>
            </Fragment>
          );
        })}
      </p>
    );
  }
  return (
    <p className="notion-text notion-text__content notion-semantic-string">
      {items.map((link, index) => {
        const isExternal = /^https?:\/\//.test(link.href);
        return (
          <Fragment key={`${link.href}-${index}`}>
            {index > 0 && <strong className="teaching-link-divider"> | </strong>}
            <strong>
              <ClassicLink
                href={link.href}
                {...(isExternal
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                {link.label}
              </ClassicLink>
            </strong>
          </Fragment>
        );
      })}
    </p>
  );
}
