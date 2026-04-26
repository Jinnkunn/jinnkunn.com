import "server-only";

import type { ReactElement } from "react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PublicationList } from "@/components/publications/publication-list";
import type { PublicationStructuredEntry } from "@/lib/seo/publications-items";

interface PublicationsBlockProps {
  /** Cap rendered entries (newest first). Omit for all entries. */
  limit?: number;
}

const PUBLICATIONS_PAGE_PATH = resolve(
  process.cwd(),
  "content/pages/publications.mdx",
);

const ENTRY_RE = /<PublicationsEntry\s+data='([^']*)'\s*\/>/g;

function unescapeJsonAttr(raw: string): string {
  return raw.replace(/\\u0027/g, "'");
}

async function loadEntries(): Promise<PublicationStructuredEntry[]> {
  let raw = "";
  try {
    raw = await readFile(PUBLICATIONS_PAGE_PATH, "utf8");
  } catch {
    return [];
  }
  const body = raw.replace(/^---[\s\S]*?---\s*/m, "");
  const out: PublicationStructuredEntry[] = [];
  let m: RegExpExecArray | null;
  while ((m = ENTRY_RE.exec(body)) !== null) {
    try {
      const parsed = JSON.parse(unescapeJsonAttr(m[1] ?? ""));
      if (parsed && typeof parsed === "object") {
        out.push(parsed as PublicationStructuredEntry);
      }
    } catch {
      // ignore
    }
  }
  return out;
}

/** Embeddable publications-list view. The /publications route itself
 * keeps a custom page.tsx (so it can emit JSON-LD), but everywhere
 * else can drop `<PublicationsBlock />` into an MDX page to get the
 * year-grouped toggle list. Reads from content/pages/publications.mdx
 * so the source of truth stays single. */
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
