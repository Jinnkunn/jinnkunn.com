import type { PublicationStructuredEntry } from "../seo/publications-items";
import {
  type SiteComponentName,
  getSiteComponentDefinition,
} from "../site-admin/component-registry.ts";

const ATTR_RE = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/g;
const NEWS_ENTRY_RE = /<NewsEntry\b([\s\S]*?)>\s*([\s\S]*?)\s*<\/NewsEntry>/g;
const WORKS_ENTRY_RE = /<WorksEntry\b([\s\S]*?)>\s*([\s\S]*?)\s*<\/WorksEntry>/g;
const TEACHING_ENTRY_RE = /<TeachingEntry\b([\s\S]*?)\/>/g;
const PUBLICATIONS_ENTRY_RE = /<PublicationsEntry\b([\s\S]*?)\/>/g;

export type NewsComponentEntry = {
  dateIso: string;
  body: string;
};

export type TeachingComponentEntry = {
  term: string;
  period: string;
  role: string;
  courseCode: string;
  courseName: string;
  courseUrl?: string;
  instructor?: string;
};

export type WorksComponentEntry = {
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
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function unescapeJsonAttr(raw: string): string {
  return raw.replace(/\\u0027/g, "'");
}

export function parseNewsEntries(source: string): NewsComponentEntry[] {
  const body = stripMdxFrontmatter(source);
  const entries: NewsComponentEntry[] = [];
  let match: RegExpExecArray | null;
  while ((match = NEWS_ENTRY_RE.exec(body)) !== null) {
    const attrs = parseJsxAttrs(match[1] ?? "");
    const dateIso = attrs.date ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) continue;
    entries.push({ dateIso, body: match[2] ?? "" });
  }
  entries.sort((a, b) => b.dateIso.localeCompare(a.dateIso));
  return entries;
}

export function parseTeachingEntries(source: string): TeachingComponentEntry[] {
  const body = stripMdxFrontmatter(source);
  const entries: TeachingComponentEntry[] = [];
  let match: RegExpExecArray | null;
  while ((match = TEACHING_ENTRY_RE.exec(body)) !== null) {
    const attrs = parseJsxAttrs(match[1] ?? "");
    entries.push({
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
): PublicationStructuredEntry[] {
  const body = stripMdxFrontmatter(source);
  const entries: PublicationStructuredEntry[] = [];
  let match: RegExpExecArray | null;
  while ((match = PUBLICATIONS_ENTRY_RE.exec(body)) !== null) {
    const attrs = parseJsxAttrs(match[1] ?? "");
    const rawData = attrs.data ?? "";
    if (!rawData) continue;
    try {
      const parsed = JSON.parse(unescapeJsonAttr(rawData));
      if (parsed && typeof parsed === "object") {
        entries.push(parsed as PublicationStructuredEntry);
      }
    } catch {
      // Skip malformed rows so one bad entry does not break the page.
    }
  }
  return entries;
}

export function parseWorksEntries(source: string): WorksComponentEntry[] {
  const body = stripMdxFrontmatter(source);
  const entries: WorksComponentEntry[] = [];
  let match: RegExpExecArray | null;
  while ((match = WORKS_ENTRY_RE.exec(body)) !== null) {
    const attrs = parseJsxAttrs(match[1] ?? "");
    entries.push({
      category: attrs.category === "passed" ? "passed" : "recent",
      role: attrs.role ?? "",
      affiliation: attrs.affiliation || undefined,
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
