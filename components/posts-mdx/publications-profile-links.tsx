import "server-only";

import { Fragment } from "react";
import type { ReactElement } from "react";

import { ClassicLink } from "@/components/classic/classic-link";

interface ProfileLink {
  label: string;
  href: string;
  hostname?: string;
}

interface PublicationsProfileLinksProps {
  /** JSON-encoded array of `{label, href, hostname?}` items — same
   * single-quoted-attr pattern other data entries use. */
  links?: string;
}

function parseLinks(raw: string | undefined): ProfileLink[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: ProfileLink[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const obj = entry as Record<string, unknown>;
      const label = typeof obj.label === "string" ? obj.label : "";
      const href = typeof obj.href === "string" ? obj.href : "";
      if (!label || !href) continue;
      const hostname = typeof obj.hostname === "string" ? obj.hostname : undefined;
      out.push({ label, href, hostname });
    }
    return out;
  } catch {
    return [];
  }
}

/** Pipe-delimited profile-link row above the publication list — same
 * markup the legacy PublicationsBlock emitted for its profileLinks
 * section. Yellow-highlight bg, bold links. */
export function PublicationsProfileLinks({
  links,
}: PublicationsProfileLinksProps): ReactElement | null {
  const items = parseLinks(links);
  if (items.length === 0) return null;
  return (
    <p className="notion-text notion-text__content notion-semantic-string">
      {items.map((link, index) => {
        const isExternal = /^https?:\/\//.test(link.href);
        return (
          <Fragment key={`${link.href}-${index}`}>
            {index > 0 && <strong className="teaching-link-divider"> | </strong>}
            <span className="highlighted-background bg-yellow">
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
            </span>
          </Fragment>
        );
      })}
    </p>
  );
}
