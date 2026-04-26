import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { noStoreData, withNoStoreApi } from "@/lib/server/api-response";

export const runtime = "nodejs";

const PUBLICATIONS_SOURCE_PATH = resolve(
  process.cwd(),
  "content/components/publications.mdx",
);

const ENTRY_RE = /<PublicationsEntry\s+data='([^']*)'\s*\/>/g;

function unescapeJsonAttr(raw: string): string {
  return raw.replace(/\\u0027/g, "'");
}

async function loadEntries(): Promise<unknown[]> {
  let raw = "";
  try {
    raw = await readFile(PUBLICATIONS_SOURCE_PATH, "utf8");
  } catch {
    return [];
  }
  const body = raw.replace(/^---[\s\S]*?---\s*/m, "");
  const out: unknown[] = [];
  let m: RegExpExecArray | null;
  while ((m = ENTRY_RE.exec(body)) !== null) {
    try {
      const parsed = JSON.parse(unescapeJsonAttr(m[1] ?? ""));
      if (parsed && typeof parsed === "object") {
        out.push(parsed);
      }
    } catch {
      // skip rows that fail to parse
    }
  }
  return out;
}

/** Public read-only feed for publications. Used by external scrapers.
 * After the components migration the source of truth is
 * `content/components/publications.mdx` (each row is a self-closing
 * `<PublicationsEntry data='...' />` JSX block, edited via the admin
 * Components → Publications panel); we re-extract entries here so the
 * JSON-API contract stays unchanged. */
export async function GET() {
  return withNoStoreApi(async () => {
    const items = await loadEntries();
    return noStoreData({ count: items.length, items });
  });
}
