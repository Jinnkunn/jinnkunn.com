import "server-only";

import type { ReactElement } from "react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parsePublicationsEntries } from "@/lib/components/parse";
import { PublicationList } from "@/components/publications/publication-list";
import { getSiteComponentDefinition } from "@/lib/site-admin/component-registry";

interface PublicationsBlockProps {
  /** Cap rendered entries (newest first). Omit for all entries. */
  limit?: number;
}

const PUBLICATIONS_SOURCE_PATH = resolve(
  process.cwd(),
  getSiteComponentDefinition("publications").sourcePath,
);

async function loadEntries() {
  let raw = "";
  try {
    raw = await readFile(PUBLICATIONS_SOURCE_PATH, "utf8");
  } catch {
    return [];
  }
  return parsePublicationsEntries(raw);
}

/** Embeddable publications-list view. The /publications route itself
 * keeps a custom page.tsx (so it can emit JSON-LD), but everywhere
 * else can drop `<PublicationsBlock />` into an MDX page to get the
 * year-grouped toggle list. Reads from
 * `content/components/publications.mdx` — the dedicated component
 * file edited via the admin Components → Publications panel — so the
 * source of truth stays single. */
export async function PublicationsBlock({
  limit,
}: PublicationsBlockProps): Promise<ReactElement> {
  const entries = await loadEntries();
  const cap = typeof limit === "number" && limit > 0 ? Math.trunc(limit) : undefined;
  const visible = cap ? entries.slice(0, cap) : entries;

  if (visible.length === 0) {
    return (
      <p className="notion-text notion-text__content notion-semantic-string">
        No publications yet.
      </p>
    );
  }

  return <PublicationList entries={visible} />;
}
