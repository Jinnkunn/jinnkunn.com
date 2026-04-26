import "server-only";

import { Fragment } from "react";
import type { ReactElement } from "react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { compilePostMdx } from "@/lib/posts/compile";

import { postMdxComponents } from "./components";
import { WorksEntry } from "./works-entry";

interface WorksBlockProps {
  /** Optional cap applied to each category (recent / past) independently. */
  limit?: number;
}

interface WorksEntryRecord {
  category: "recent" | "passed";
  role: string;
  affiliation?: string;
  affiliationUrl?: string;
  location?: string;
  period: string;
  body: string;
}

const WORKS_SOURCE_PATH = resolve(
  process.cwd(),
  "content/components/works.mdx",
);

// Match `<WorksEntry ...>...</WorksEntry>` blocks. Same parsing the
// editor's mdx-blocks.ts does, but inline here to avoid importing
// admin-side code into the public bundle. Attribute parser allows any
// order and tolerates extra whitespace.
const WORKS_ENTRY_RE = /<WorksEntry\b([\s\S]*?)>\s*([\s\S]*?)\s*<\/WorksEntry>/g;
const ATTR_RE = /(\w+)\s*=\s*"([^"]*)"/g;

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(ATTR_RE)) {
    out[m[1]] = m[2];
  }
  return out;
}

async function loadEntries(): Promise<WorksEntryRecord[]> {
  let raw = "";
  try {
    raw = await readFile(WORKS_SOURCE_PATH, "utf8");
  } catch {
    return [];
  }
  const body = raw.replace(/^---[\s\S]*?---\s*/m, "");
  const out: WorksEntryRecord[] = [];
  let m: RegExpExecArray | null;
  while ((m = WORKS_ENTRY_RE.exec(body)) !== null) {
    const attrs = parseAttrs(m[1] ?? "");
    const category =
      attrs.category === "passed" ? "passed" : "recent";
    out.push({
      category,
      role: attrs.role ?? "",
      affiliation: attrs.affiliation || undefined,
      affiliationUrl: attrs.affiliationUrl || undefined,
      location: attrs.location || undefined,
      period: attrs.period ?? "",
      body: m[2] ?? "",
    });
  }
  return out;
}

function NotionSpacer() {
  return <div className="notion-text" aria-hidden="true" />;
}

/** Embeddable view over content/components/works.mdx — the dedicated
 * component file edited via the admin Components → Works panel. The
 * /works public route renders intro / note blockquotes from
 * `content/pages/works.mdx` and embeds this block for the
 * categorized entry list. Mirrors the legacy section-iterated
 * rendering with explicit "Recent Works" / "Past Works" headings
 * emitted by the block itself, so the embed always reproduces those
 * section dividers regardless of which page hosts it. */
export async function WorksBlock({ limit }: WorksBlockProps): Promise<ReactElement> {
  const entries = await loadEntries();
  const cap = typeof limit === "number" && limit > 0 ? Math.trunc(limit) : undefined;
  const recent = entries.filter((e) => e.category === "recent");
  const passed = entries.filter((e) => e.category === "passed");
  const recentCapped = cap ? recent.slice(0, cap) : recent;
  const passedCapped = cap ? passed.slice(0, cap) : passed;

  if (recentCapped.length === 0 && passedCapped.length === 0) {
    return (
      <p className="notion-text notion-text__content notion-semantic-string">
        No works yet.
      </p>
    );
  }

  const renderRow = async (entry: WorksEntryRecord, key: string) => {
    const { Content } = entry.body
      ? await compilePostMdx(entry.body)
      : { Content: null };
    return (
      <WorksEntry
        key={key}
        category={entry.category}
        role={entry.role}
        affiliation={entry.affiliation}
        affiliationUrl={entry.affiliationUrl}
        location={entry.location}
        period={entry.period}
      >
        {Content ? <Content components={postMdxComponents} /> : null}
      </WorksEntry>
    );
  };

  const recentNodes = await Promise.all(
    recentCapped.map((entry, i) => renderRow(entry, `recent-${entry.role}-${i}`)),
  );
  const passedNodes = await Promise.all(
    passedCapped.map((entry, i) => renderRow(entry, `passed-${entry.role}-${i}`)),
  );

  return (
    <>
      {recentNodes.length > 0 && (
        <Fragment>
          <span className="notion-heading__anchor" />
          <h1 className="notion-heading notion-semantic-string">Recent Works</h1>
          {recentNodes}
        </Fragment>
      )}
      {passedNodes.length > 0 && (
        <Fragment>
          {recentNodes.length > 0 && <NotionSpacer />}
          <span className="notion-heading__anchor" />
          <h1 className="notion-heading notion-semantic-string">Past Works</h1>
          {passedNodes}
        </Fragment>
      )}
    </>
  );
}
