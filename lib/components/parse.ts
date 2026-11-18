import type { PublicationStructuredEntry } from "../seo/publications-items";
import { readPublicationsDocument, type IdentifiedPublication } from "../../packages/content-core/src/publications.ts";
export { parsePublicationEntryData } from "../../packages/content-core/src/publications.ts";
import { normalizeWorksAffiliation } from "../shared/works-affiliation.ts";
import {
  type SiteComponentName,
  getSiteComponentDefinition,
} from "../site-admin/component-registry.ts";

const ATTR_RE = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/g;
const NEWS_ENTRY_RE = /<NewsEntry\b([\s\S]*?)>\s*([\s\S]*?)\s*<\/NewsEntry>/g;
const WORKS_ENTRY_RE = /<WorksEntry\b([\s\S]*?)>\s*([\s\S]*?)\s*<\/WorksEntry>/g;
const TEACHING_ENTRY_RE = /<TeachingEntry\b([\s\S]*?)\/>/g;

export type NewsComponentEntry = {
  entryId?: string;
  dateIso: string;
  body: string;
};

export type NewsComponentFeedItem =
  | { type: "entry"; entry: NewsComponentEntry }
  | { type: "divider"; id: string };

export type TeachingComponentEntry = {
  entryId?: string;
  term: string;
  period: string;
  role: string;
  courseCode: string;
  courseName: string;
  courseUrl?: string;
  instructor?: string;
};

export type WorksComponentEntry = {
  entryId?: string;
  category: "recent" | "passed";
  role: string;
  affiliation?: string;
  affiliationUrl?: string;
  location?: string;
  period: string;
  body: string;
};

export type ComponentEntrySummaryRow = {
  title: string;
  detail?: string;
  href?: string;
};

export type ComponentEntrySummary = {
  count: number;
  entryLabel: string;
  rows: ComponentEntrySummaryRow[];
};

export type ParsedComponentEntries =
  | { name: "news"; entries: NewsComponentEntry[] }
  | { name: "teaching"; entries: TeachingComponentEntry[] }
  | { name: "publications"; entries: PublicationStructuredEntry[] }
  | { name: "works"; entries: WorksComponentEntry[] };

export function stripMdxFrontmatter(source: string): string {
  return String(source || "")
    .replace(/\r\n/g, "\n")
    .replace(/^---[\s\S]*?---\s*/m, "");
}

export function parseJsxAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of String(raw || "").matchAll(ATTR_RE)) {
    const quoted = match[2] ?? match[3];
    // Decode one layer of the entities emitted by the structured editor.
    attrs[match[1]] = quoted === undefined ? match[4] ?? "" : quoted.replace(
      /&(quot|lt|gt|amp);/g,
      (entity) => ({ "&quot;": '"', "&lt;": "<", "&gt;": ">", "&amp;": "&" })[entity] || entity,
    );
  }
  return attrs;
}

export function parseNewsEntries(source: string): NewsComponentEntry[] {
  const entries = parseNewsFeedItems(source)
    .filter((item): item is Extract<NewsComponentFeedItem, { type: "entry" }> => item.type === "entry")
    .map((item) => item.entry);
  entries.sort((a, b) => b.dateIso.localeCompare(a.dateIso));
  return entries;
}

function parseNewsDividers(segment: string, prefix: string): NewsComponentFeedItem[] {
  return String(segment || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line === "---" || line === "***" || /^<hr\s*\/?>$/i.test(line))
    .map(({ index }) => ({ type: "divider" as const, id: `${prefix}-${index}` }));
}

export function parseNewsFeedItems(source: string): NewsComponentFeedItem[] {
  const body = stripMdxFrontmatter(source);
  const items: NewsComponentFeedItem[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = NEWS_ENTRY_RE.exec(body)) !== null) {
    items.push(...parseNewsDividers(body.slice(cursor, match.index), `before-${match.index}`));
    const attrs = parseJsxAttrs(match[1] ?? "");
    const dateIso = attrs.date ?? "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
      const entry = {
        entryId: attrs.entryId || undefined,
        dateIso,
        body: match[2] ?? "",
      };
      items.push({ type: "entry", entry });
    }
    cursor = NEWS_ENTRY_RE.lastIndex;
  }
  items.push(...parseNewsDividers(body.slice(cursor), "after"));
  return items;
}

export function parseTeachingEntries(source: string): TeachingComponentEntry[] {
  const body = stripMdxFrontmatter(source);
  const entries: TeachingComponentEntry[] = [];
  let match: RegExpExecArray | null;
  while ((match = TEACHING_ENTRY_RE.exec(body)) !== null) {
    const attrs = parseJsxAttrs(match[1] ?? "");
    entries.push({
      entryId: attrs.entryId || undefined,
      term: attrs.term ?? "",
      period: attrs.period ?? "",
      role: attrs.role ?? "",
      courseCode: attrs.courseCode ?? "",
      courseName: attrs.courseName ?? "",
      courseUrl: attrs.courseUrl || undefined,
      instructor: attrs.instructor || undefined,
    });
  }
  return entries;
}

export function parsePublicationsEntries(
  source: string,
): IdentifiedPublication[] {
  return readPublicationsDocument(source).entries;
}

export function publicationsDisplayedOnPage(body: string, component: string): IdentifiedPublication[] {
  const inline = parsePublicationsEntries(body);
  const block = /^\s*<PublicationsBlock(?:\s+limit=\{(\d+)\})?\s*\/>\s*$/m.exec(body);
  if (!block) return inline;
  const entries = parsePublicationsEntries(component);
  const limit = Number(block[1] || 0);
  return [...inline, ...(limit > 0 ? entries.slice(0, limit) : entries)];
}

export function parseWorksEntries(source: string): WorksComponentEntry[] {
  const body = stripMdxFrontmatter(source);
  const entries: WorksComponentEntry[] = [];
  let match: RegExpExecArray | null;
  while ((match = WORKS_ENTRY_RE.exec(body)) !== null) {
    const attrs = parseJsxAttrs(match[1] ?? "");
    entries.push({
      entryId: attrs.entryId || undefined,
      category: attrs.category === "passed" ? "passed" : "recent",
      role: attrs.role ?? "",
      affiliation: attrs.affiliation ? normalizeWorksAffiliation(attrs.affiliation) : undefined,
      affiliationUrl: attrs.affiliationUrl || undefined,
      location: attrs.location || undefined,
      period: attrs.period ?? "",
      body: match[2] ?? "",
    });
  }
  return entries;
}

export function parseComponentEntries(
  name: SiteComponentName,
  source: string,
): ParsedComponentEntries {
  if (name === "news") return { name, entries: parseNewsEntries(source) };
  if (name === "teaching") return { name, entries: parseTeachingEntries(source) };
  if (name === "publications") {
    return { name, entries: parsePublicationsEntries(source) };
  }
  return { name, entries: parseWorksEntries(source) };
}

export function summarizeComponentEntries(
  name: SiteComponentName,
  source: string,
): ComponentEntrySummary {
  const definition = getSiteComponentDefinition(name);
  const parsed = parseComponentEntries(name, source);
  if (parsed.name === "news") {
    return {
      count: parsed.entries.length,
      entryLabel: definition.entryLabel,
      rows: parsed.entries.slice(0, 8).map((entry) => ({
        title: entry.dateIso || "Undated item",
        detail: entry.body.replace(/\s+/g, " ").trim().slice(0, 120),
      })),
    };
  }
  if (parsed.name === "teaching") {
    return {
      count: parsed.entries.length,
      entryLabel: definition.entryLabel,
      rows: parsed.entries.slice(0, 8).map((entry) => ({
        title: [entry.courseCode, entry.courseName].filter(Boolean).join(" · ") || "Untitled course",
        detail: [entry.term, entry.role, entry.period].filter(Boolean).join(" · "),
        href: entry.courseUrl,
      })),
    };
  }
  if (parsed.name === "publications") {
    return {
      count: parsed.entries.length,
      entryLabel: definition.entryLabel,
      rows: parsed.entries.slice(0, 8).map((entry) => ({
        title: String(entry.title || "Untitled publication"),
        detail: String(entry.year || ""),
        href: typeof entry.url === "string" ? entry.url : undefined,
      })),
    };
  }
  return {
    count: parsed.entries.length,
    entryLabel: definition.entryLabel,
    rows: parsed.entries.slice(0, 8).map((entry) => ({
      title: entry.role || "Untitled role",
      detail: [entry.affiliation, entry.period, entry.category].filter(Boolean).join(" · "),
      href: entry.affiliationUrl,
    })),
  };
}
